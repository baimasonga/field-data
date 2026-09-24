<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="review-queue" aria-labelledby="review-queue-title">
    <h2 id="review-queue-title">Claim review queue</h2>
    <p>Submissions flagged for review appear here. A flag is a question, not a finding of fraud.</p>
    <div class="btn-group" role="group" aria-label="Review case status">
      <button v-for="value of ['open', 'in-review', 'resolved']" :key="value" type="button"
        class="btn btn-default" :class="{ active: status === value }"
        :aria-pressed="status === value" @click="status = value">
        {{ value === 'in-review' ? 'In review' : value === 'open' ? 'Open' : 'Resolved' }}
      </button>
    </div>
    <p v-if="loading && items.length === 0">Loading review cases…</p>
    <div v-else-if="error" role="alert">
      Review cases could not be loaded.
      <button type="button" class="btn btn-default" @click="load(nextCursor)">
        Try again
      </button>
    </div>
    <p v-else-if="items.length === 0">No {{ status }} claim review cases for this form.</p>
    <ul v-else class="list-group">
      <li v-for="item of items" :key="item.id" class="list-group-item">
        <router-link :to="submissionPath(item.claim.rootInstanceId)">
          {{ item.claim.rootInstanceId }}
        </router-link>
        <span> · Claim version {{ item.claim.ordinal }} · {{ item.priority }} priority</span>
        <span v-if="item.claim.current === false" class="text-warning"> · Superseded version</span>
        <span> · Reason: {{ item.reasonCodes.join(', ') }}</span>
        <span v-if="item.assignedTo != null"> · Assigned to reviewer {{ item.assignedTo }}</span>
        <button v-if="canReview && status === 'open' && item.assignedTo == null"
          type="button" class="btn btn-default" :disabled="assigning === item.id"
          @click="assign(item)">
          {{ assigning === item.id ? 'Assigning…' : 'Assign to me' }}
        </button>
        <button v-if="canReview && status === 'in-review' && item.assignedTo === currentUser.id"
          type="button" class="btn btn-default" :disabled="assigning === item.id"
          @click="assign(item, true)">
          {{ assigning === item.id ? 'Releasing…' : 'Release case' }}
        </button>
        <details @toggle="inspect($event, item)">
          <summary>Inspect evidence and decision history</summary>
          <p v-if="inspecting === item.id">Loading case evidence…</p>
          <p v-else-if="inspectionError[item.id]" role="alert">
            Evidence could not be loaded. Close and reopen to retry.
          </p>
          <template v-else-if="inspections[item.id]">
            <p>Linked originals and their integrity at the time of inspection:</p>
            <ul>
              <li v-for="entry of inspections[item.id].evidence" :key="entry.id">
                {{ entry.sourceKind }} · {{ entry.integrityStatus }} ·
                <a :href="entry.downloadUrl">Download original</a>
              </li>
            </ul>
            <p v-if="inspections[item.id].evidence.length === 0">No linked evidence.</p>
            <p>Prior decisions:</p>
            <ul>
              <li v-for="decision of inspections[item.id].decisions" :key="decision.id">
                {{ decision.outcome }} · {{ decision.reasonCode }} · {{ decision.note }}
              </li>
            </ul>
            <p v-if="inspections[item.id].decisions.length === 0">No prior decisions.</p>
            <div v-if="canReview && status === 'in-review' && item.assignedTo === currentUser.id">
              <label :for="`review-note-${item.id}`">Decision reason</label>
              <textarea :id="`review-note-${item.id}`" v-model="notes[item.id]"
                class="form-control" maxlength="4000"></textarea>
              <button type="button" class="btn btn-primary"
                :disabled="!notes[item.id]?.trim() || assigning === item.id || !item.claim.current"
                @click="recordDecision(item, 'needs-evidence')">
                Record needs evidence
              </button>
              <button type="button" class="btn btn-default"
                :disabled="!notes[item.id]?.trim() || assigning === item.id || !item.claim.current"
                @click="recordDecision(item, 'accepted')">
                Accept claim
              </button>
              <button type="button" class="btn btn-default"
                :disabled="!notes[item.id]?.trim() || assigning === item.id || !item.claim.current"
                @click="recordDecision(item, 'rejected')">
                Reject claim
              </button>
              <p>Acceptance requires verified linked evidence, intact provenance and no unresolved findings.</p>
            </div>
          </template>
        </details>
      </li>
    </ul>
    <button v-if="nextCursor != null && !error" type="button" class="btn btn-default"
      :disabled="loading" @click="loadMore">
      Load more cases
    </button>
  </section>
</template>

<script setup>
import { ref, watch } from 'vue';
import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { useRequestData } from '../../request-data';

defineOptions({ name: 'SubmissionReviewQueue' });
const props = defineProps({
  projectId: { type: String, required: true },
  xmlFormId: { type: String, required: true },
  canReview: { type: Boolean, default: false }
});
const { request } = useRequest();
const { currentUser } = useRequestData();
const items = ref([]);
const status = ref('open');
const assigning = ref(null);
const inspecting = ref(null);
const inspections = ref({});
const inspectionError = ref({});
const notes = ref({});
const nextCursor = ref(null);
const loading = ref(false);
const error = ref(false);
const submissionPath = (instanceId) => `/projects/${props.projectId}/forms/` +
  `${encodeURIComponent(props.xmlFormId)}/submissions/${encodeURIComponent(instanceId)}`;

const load = async (cursor = null) => {
  loading.value = true;
  error.value = false;
  try {
    const { data } = await request({
      method: 'GET',
      url: apiPaths.reviewQueue(props.projectId, props.xmlFormId, cursor, status.value),
      alert: false
    });
    items.value = cursor == null ? data.items : [...items.value, ...data.items];
    nextCursor.value = data.nextCursor;
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
};
const loadMore = () => load(nextCursor.value);
const inspect = async (event, item) => {
  if (!event.target.open || inspections.value[item.id]) return;
  inspecting.value = item.id;
  inspectionError.value[item.id] = false;
  try {
    const [detail, evidence] = await Promise.all([
      request({ method: 'GET', url: apiPaths.reviewCase(item.id), alert: false }),
      request({ method: 'GET', url: apiPaths.claimEvidence(item.claimVersionId), alert: false })
    ]);
    inspections.value[item.id] = {
      decisions: detail.data.decisions,
      evidence: evidence.data.items
    };
  } catch {
    inspectionError.value[item.id] = true;
  } finally {
    inspecting.value = null;
  }
};
const recordDecision = async (item, outcome) => {
  assigning.value = item.id;
  try {
    await request({
      method: 'POST',
      url: apiPaths.reviewCaseDecisions(item.id),
      headers: { 'If-Match': item.etag, 'Idempotency-Key': crypto.randomUUID() },
      data: {
        outcome, override: false,
        reasonCode: item.reasonCodes[0], note: notes.value[item.id].trim(),
        evidenceIds: [], integrityFindingIds: []
      }
    });
    items.value = items.value.filter((row) => row.id !== item.id);
    delete inspections.value[item.id];
    delete notes.value[item.id];
  } catch {
    await load();
  } finally {
    assigning.value = null;
  }
};
const assign = async (item, releasing = false) => {
  assigning.value = item.id;
  try {
    await request({
      method: 'PATCH',
      url: apiPaths.reviewCaseAssignment(item.id),
      headers: { 'If-Match': item.etag, 'Idempotency-Key': crypto.randomUUID() },
      data: {
        assignedTo: releasing ? null : currentUser.id,
        status: releasing ? 'open' : 'in-review'
      }
    });
    items.value = items.value.filter((row) => row.id !== item.id);
  } catch {
    await load();
  } finally {
    assigning.value = null;
  }
};
watch(() => [props.projectId, props.xmlFormId, status.value], () => {
  items.value = [];
  nextCursor.value = null;
  inspections.value = {};
  notes.value = {};
  load();
}, { immediate: true });
</script>
