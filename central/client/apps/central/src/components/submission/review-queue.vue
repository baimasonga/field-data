<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="review-queue" aria-labelledby="review-queue-title">
    <h2 id="review-queue-title">Claim review queue</h2>
    <p>Submissions flagged for review appear here. A flag is a question, not a finding of fraud.</p>
    <submission-review-metrics ref="workload" :project-id="projectId" :xml-form-id="xmlFormId"/>
    <div class="btn-group" role="group" aria-label="Review case status">
      <button v-for="value of ['open', 'in-review', 'resolved', 'superseded']" :key="value" type="button"
        class="btn btn-default" :class="{ active: status === value }"
        :aria-pressed="status === value" @click="status = value">
        {{ value === 'in-review' ? 'In review' : value === 'open' ? 'Open' : value === 'resolved' ? 'Resolved' : 'Superseded' }}
      </button>
    </div>
    <button type="button" class="btn btn-default" :disabled="loading" @click="load()">Refresh cases</button>
    <p v-if="loading && items.length === 0">Loading review cases…</p>
    <div v-else-if="error" role="alert">
      Review cases could not be loaded.
      <button type="button" class="btn btn-default" @click="load(nextCursor)">
        Try again
      </button>
    </div>
    <p v-else-if="items.length === 0">No {{ status }} claim review cases for this form.</p>
    <ul v-else class="list-group">
      <li v-for="item of items" :key="`${item.id}:${item.revision}`" class="list-group-item">
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
          <p v-if="inspecting[item.id]">Loading case evidence…</p>
          <p v-else-if="inspectionError[item.id]" role="alert">
            Evidence could not be loaded. Close and reopen to retry.
          </p>
          <template v-else-if="inspections[item.id]">
            <h3>Claim provenance</h3>
            <button type="button" class="btn btn-default" @click="emit('asset-source', item.claimVersionId)">Use as asset observation source</button>
            <dl v-if="inspections[item.id].claim.provenance">
              <dt>Origin</dt><dd>{{ inspections[item.id].claim.provenance.origin }}</dd>
              <dt>Captured</dt><dd>{{ inspections[item.id].claim.provenance.capturedAt || 'Unknown' }}</dd>
              <dt>Received</dt><dd>{{ inspections[item.id].claim.provenance.receivedAt || 'Unknown' }}</dd>
              <dt>Integrity hash</dt><dd>{{ inspections[item.id].claim.provenance.integrityHash || 'Unknown' }}</dd>
            </dl>
            <p v-else>Provenance was not recorded for this claim version.</p>
            <p v-if="inspections[item.id].claim.degraded || inspections[item.id].claim.provenance?.degraded">
              Provenance has limitations:
              {{ inspections[item.id].claim.degraded || inspections[item.id].claim.provenance.degraded }}
            </p>
            <p>Linked originals and their integrity at the time of inspection:</p>
            <ul>
              <li v-for="entry of inspections[item.id].evidence" :key="entry.id">
                {{ entry.sourceKind }} · {{ entry.integrityStatus }} ·
                <a :href="entry.downloadUrl">Download original</a>
              </li>
            </ul>
            <p v-if="inspections[item.id].evidence.length === 0">No linked evidence.</p>
            <submission-evidence-graph :key="`${item.id}:${item.revision}`" :claim-version-id="item.claimVersionId"/>
            <p>Prior decisions:</p>
            <ul>
              <li v-for="decision of inspections[item.id].decisions" :key="decision.id">
                {{ decision.override ? 'Supervisor override · ' : '' }}{{ decision.outcome }} · {{ decision.reasonCode }} · {{ decision.note }}
                · Reviewer {{ decision.reviewerId }} · {{ decision.createdAt }}
              </li>
            </ul>
            <p v-if="inspections[item.id].decisions.length === 0">No prior decisions.</p>
            <h3>Back-checks</h3>
            <button type="button" class="btn btn-default" :disabled="backcheckRefreshing[item.id]"
              @click="reloadBackchecks(item)">
Refresh back-checks
</button>
            <p v-if="backcheckRefreshError[item.id]" role="alert">Back-check updates could not be loaded. Retry refresh.</p>
            <p v-if="inspections[item.id].backchecks.length === 0">No back-check requested.</p>
            <ul v-else>
              <li v-for="backcheck of inspections[item.id].backchecks" :key="backcheck.id">
                <strong>{{ backcheck.status }}</strong> · {{ backcheck.assigneeName }} ·
                {{ backcheck.question }} · Form: {{ backcheck.responseXmlFormId || xmlFormId }}
                <span v-if="backcheck.dueAt"> · Due {{ backcheck.dueAt }}</span>
                <p>App User acknowledgment: {{ backcheck.seenAt || 'Not yet acknowledged' }}</p>
                <p v-if="backcheck.status === 'cancelled'">
                  Cancellation reason: {{ backcheck.cancellationReason || 'Not recorded' }}
                </p>
                <div v-if="backcheck.responseInstanceId">
                  Original: <router-link :to="submissionPath(item.claim.rootInstanceId)">
                    {{ item.claim.rootInstanceId }}
                  </router-link>
                  · Back-check: <router-link :to="submissionPath(backcheck.responseInstanceId, backcheck.responseXmlFormId)">
                    {{ backcheck.responseInstanceId }}
                  </router-link>
                  · Capture time: {{ backcheck.responseCapturedAt || 'unknown' }}
                  · Provenance: {{ backcheck.responseDegraded == null ? 'recorded' : 'degraded' }}
                  <submission-backcheck-comparison :case-id="item.id" :backcheck-id="backcheck.id"/>
                </div>
                <div v-else-if="backcheck.status === 'requested' && canReview
                  && status === 'in-review' && item.assignedTo === currentUser.id && item.claim.current">
                  <label :for="`backcheck-response-${backcheck.id}`">
                    Synced back-check submission ID
                  </label>
                  <input :id="`backcheck-response-${backcheck.id}`"
                    v-model.trim="responses[backcheck.id]" class="form-control" maxlength="255">
                  <button type="button" class="btn btn-default"
                    :disabled="!responses[backcheck.id] || assigning === item.id"
                    @click="linkBackcheck(item, backcheck)">
Link field result
</button>
                  <label :for="`backcheck-cancel-${backcheck.id}`">Cancellation reason</label>
                  <textarea :id="`backcheck-cancel-${backcheck.id}`"
                    v-model.trim="cancellationReasons[backcheck.id]" class="form-control"
                    maxlength="2000" rows="2"></textarea>
                  <p>
Cancel this request to withdraw it or request a visit from another App User.
                    The original request stays in the case history.
</p>
                  <button type="button" class="btn btn-default"
                    :disabled="!cancellationReasons[backcheck.id] || assigning === item.id"
                    @click="cancelBackcheck(item, backcheck)">
Cancel back-check
</button>
                </div>
              </li>
            </ul>
            <div v-if="canReview && status === 'in-review' && item.assignedTo === currentUser.id
              && item.claim.current && !inspections[item.id].backchecks.some(b => b.status === 'requested')">
              <h4>Request a back-check</h4>
              <p>
The assigned App User collects a submission of the selected form in ODK Collect,
                including offline. Link its instance ID after it syncs.
</p>
              <label :for="`backcheck-form-${item.id}`">Back-check form</label>
              <select :id="`backcheck-form-${item.id}`" class="form-control"
                :value="responseForms[item.id] || xmlFormId"
                @change="responseForms[item.id] = $event.target.value; assigneesSelected[item.id] = null">
                <option v-for="form of inspections[item.id].forms" :key="form.id" :value="form.xmlFormId">
                  {{ form.name || form.xmlFormId }} ({{ form.xmlFormId }})
                </option>
              </select>
              <label :for="`backcheck-assignee-${item.id}`">App User</label>
              <select :id="`backcheck-assignee-${item.id}`" v-model="assigneesSelected[item.id]"
                class="form-control">
                <option :value="null">Choose a different collector</option>
                <option v-for="assignee of (inspections[item.id].forms.find(f => f.xmlFormId === (responseForms[item.id] || xmlFormId))?.assignees || [])" :key="assignee.id"
                  :value="assignee.id">
{{ assignee.name }}
</option>
              </select>
              <label :for="`backcheck-question-${item.id}`">What should they verify?</label>
              <textarea :id="`backcheck-question-${item.id}`" v-model.trim="questions[item.id]"
                class="form-control" maxlength="2000"></textarea>
              <label :for="`backcheck-due-${item.id}`">Due date (optional)</label>
              <input :id="`backcheck-due-${item.id}`" v-model="dueDates[item.id]"
                class="form-control" type="date">
              <button type="button" class="btn btn-primary"
                :disabled="!assigneesSelected[item.id] || !questions[item.id]?.trim()
                  || assigning === item.id" @click="requestBackcheck(item)">
                Request back-check
              </button>
            </div>
            <div v-if="canReview && status === 'in-review' && item.assignedTo === currentUser.id">
              <label :for="`review-reason-${item.id}`">Reason code</label>
              <select :id="`review-reason-${item.id}`" class="form-control"
                :value="selectedReasons[item.id] || item.reasonCodes[0]"
                @change="selectedReasons[item.id] = $event.target.value">
                <option v-for="reason of item.reasonCodes" :key="reason" :value="reason">{{ reason }}</option>
              </select>
              <label :for="`review-note-${item.id}`">Decision reason</label>
              <textarea :id="`review-note-${item.id}`" v-model="notes[item.id]"
                class="form-control" maxlength="4000"></textarea>
              <button type="button" class="btn btn-primary"
                :disabled="!notes[item.id]?.trim() || assigning === item.id || !item.claim.current"
                @click="recordDecision(item, 'needs-evidence')">
                Record needs evidence
              </button>
              <button v-if="!inspections[item.id].reversalRequired" type="button"
                class="btn btn-default"
                :disabled="!notes[item.id]?.trim() || assigning === item.id || !item.claim.current
                  || inspections[item.id].backchecks.some(b => b.status === 'requested')"
                @click="recordDecision(item, 'accepted')">
                Accept claim
              </button>
              <button v-if="!inspections[item.id].reversalRequired" type="button"
                class="btn btn-default"
                :disabled="!notes[item.id]?.trim() || assigning === item.id || !item.claim.current
                  || inspections[item.id].backchecks.some(b => b.status === 'requested')"
                @click="recordDecision(item, 'rejected')">
                Reject claim
              </button>
              <p v-if="inspections[item.id].backchecks.some(b => b.status === 'requested')">
                Link the pending back-check before accepting or rejecting this claim.
              </p>
              <p>Acceptance requires verified linked evidence, intact provenance and no unresolved findings.</p>
              <template v-if="inspections[item.id].overridePolicy?.allowed && !inspections[item.id].reversalRequired">
                <p>
Supervisor acceptance overrides provenance limitations or unresolved findings.
                  Explain your verification in the decision reason. Verified evidence is still required.
</p>
                <button type="button" class="btn btn-default"
                  :disabled="!notes[item.id]?.trim() || assigning === item.id || !item.claim.current
                    || inspections[item.id].backchecks.some(b => b.status === 'requested')"
                  @click="recordDecision(item, 'accepted', true)">
                  Accept with supervisor override
                </button>
              </template>
              <template v-if="inspections[item.id].reversalRequired">
                <p>This reopened case requires a supervisor to replace the earlier terminal decision.</p>
                <template v-if="inspections[item.id].overridePolicy?.allowed">
                  <p>
Replacement acceptance may override provenance limitations or unresolved findings.
                    Explain your verification in the decision reason. Verified evidence is still required.
</p>
                  <button v-for="outcome of ['accepted', 'rejected']" :key="outcome"
                    type="button" class="btn btn-default"
                    :disabled="!notes[item.id]?.trim() || assigning === item.id || !item.claim.current
                      || inspections[item.id].backchecks.some(b => b.status === 'requested')"
                    @click="recordDecision(item, outcome, true, 'reconsidered-decision')">
                    {{ outcome === 'accepted' ? 'Replace decision with acceptance' : 'Replace decision with rejection' }}
                  </button>
                </template>
              </template>
            </div>
            <div v-if="canReview && status === 'resolved' && item.claim.current
              && inspections[item.id].overridePolicy?.allowed">
              <p>Reopen this case for review. Earlier decisions remain in its history.</p>
              <label :for="`reopen-note-${item.id}`">Reason for reopening</label>
              <textarea :id="`reopen-note-${item.id}`" v-model="notes[item.id]"
                class="form-control" maxlength="4000"></textarea>
              <button type="button" class="btn btn-default"
                :disabled="!notes[item.id]?.trim() || assigning === item.id"
                @click="recordDecision(item, 'needs-evidence', true, 'reopen-for-review')">
                Reopen for review
              </button>
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
import { onBeforeUnmount, ref, watch } from 'vue';
import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { useRequestData } from '../../request-data';
import SubmissionReviewMetrics from './review-metrics.vue';
import SubmissionBackcheckComparison from './backcheck-comparison.vue';
import SubmissionEvidenceGraph from './evidence-graph.vue';

defineOptions({ name: 'SubmissionReviewQueue' });
const emit = defineEmits(['asset-source']);
const props = defineProps({
  projectId: { type: String, required: true },
  xmlFormId: { type: String, required: true },
  canReview: { type: Boolean, default: false }
});
const { request } = useRequest();
const { currentUser } = useRequestData();
const items = ref([]);
const workload = ref(null);
const status = ref('open');
const assigning = ref(null);
const inspecting = ref({});
const inspections = ref({});
const inspectionError = ref({});
const notes = ref({});
const selectedReasons = ref({});
const questions = ref({});
const dueDates = ref({});
const responses = ref({});
const cancellationReasons = ref({});
const assigneesSelected = ref({});
const responseForms = ref({});
const backcheckRefreshing = ref({});
const backcheckRefreshError = ref({});
const backcheckRefreshGeneration = new Map();
const nextCursor = ref(null);
const loading = ref(false);
const error = ref(false);
const mutationKeys = new Map();
const retryKey = (operation, item, data) => {
  const signature = JSON.stringify([operation, item.id, item.etag, data]);
  if (!mutationKeys.has(signature)) mutationKeys.set(signature, crypto.randomUUID());
  return mutationKeys.get(signature);
};
const submissionPath = (instanceId, xmlFormId = props.xmlFormId) => `/projects/${props.projectId}/forms/` +
  `${encodeURIComponent(xmlFormId)}/submissions/${encodeURIComponent(instanceId)}`;

let loadGeneration = 0;
let disposed = false;
onBeforeUnmount(() => { disposed = true; loadGeneration += 1; });
const load = async (cursor = null) => {
  loadGeneration += 1;
  const generation = loadGeneration;
  loading.value = true;
  error.value = false;
  try {
    const { data } = await request({
      method: 'GET',
      url: apiPaths.reviewQueue(props.projectId, props.xmlFormId, cursor, status.value),
      alert: false
    });
    if (disposed || generation !== loadGeneration) return;
    for (const item of data.items) {
      if (inspections.value[item.id]?.revision !== item.revision)
        delete inspections.value[item.id];
    }
    items.value = cursor == null ? data.items : [...items.value, ...data.items];
    nextCursor.value = data.nextCursor;
    if (cursor == null) workload.value?.reload();
  } catch {
    if (!disposed && generation === loadGeneration) error.value = true;
  } finally {
    if (!disposed && generation === loadGeneration) loading.value = false;
  }
};
const loadMore = () => load(nextCursor.value);
const inspect = async (event, item) => {
  if (!event.target.open || inspections.value[item.id]) return;
  inspecting.value[item.id] = true;
  inspectionError.value[item.id] = false;
  try {
    const [detail, evidence, backchecks, forms] = await Promise.all([
      request({ method: 'GET', url: apiPaths.reviewCase(item.id), alert: false }),
      request({ method: 'GET', url: apiPaths.claimEvidence(item.claimVersionId), alert: false }),
      request({ method: 'GET', url: apiPaths.reviewCaseBackchecks(item.id), alert: false }),
      props.canReview && item.assignedTo === currentUser.id
        ? request({ method: 'GET', url: apiPaths.reviewCaseBackcheckForms(item.id), alert: false })
        : Promise.resolve({ data: [] })
    ]);
    if (disposed) return;
    inspections.value[item.id] = {
      revision: item.revision,
      claim: detail.data.claim,
      decisions: detail.data.decisions,
      overridePolicy: detail.data.overridePolicy,
      reversalRequired: detail.data.reversalRequired,
      evidence: evidence.data.items,
      backchecks: backchecks.data,
      forms: forms.data
    };
  } catch {
    inspectionError.value[item.id] = true;
  } finally {
    inspecting.value[item.id] = false;
  }
};
const refreshBackchecks = async (item) => {
  const generation = (backcheckRefreshGeneration.get(item.id) || 0) + 1;
  backcheckRefreshGeneration.set(item.id, generation);
  const revision = items.value.find(row => row.id === item.id)?.revision;
  const { data } = await request({ method: 'GET', url: apiPaths.reviewCaseBackchecks(item.id), alert: false });
  if (disposed || generation !== backcheckRefreshGeneration.get(item.id) ||
    revision !== items.value.find(row => row.id === item.id)?.revision) return;
  if (inspections.value[item.id] != null) {
    inspections.value[item.id].backchecks = data;
    inspections.value[item.id].revision = items.value.find(row => row.id === item.id)?.revision;
  }
  workload.value?.reload();
};
const reloadBackchecks = async (item) => {
  backcheckRefreshing.value[item.id] = true;
  backcheckRefreshError.value[item.id] = false;
  try { await refreshBackchecks(item); } catch { backcheckRefreshError.value[item.id] = true; } finally { backcheckRefreshing.value[item.id] = false; }
};
const requestBackcheck = async (item) => {
  const data = {
    responseXmlFormId: responseForms.value[item.id] || props.xmlFormId,
    assignedTo: assigneesSelected.value[item.id], question: questions.value[item.id].trim(),
    dueAt: dueDates.value[item.id] ? `${dueDates.value[item.id]}T23:59:59Z` : null
  };
  assigning.value = item.id;
  try {
    const response = await request({
      method: 'POST', url: apiPaths.reviewCaseBackchecks(item.id),
      headers: { 'If-Match': item.etag },
      data: { ...data, requestId: retryKey('backcheck', item, data) }
    });
    items.value = items.value.map((row) => (row.id === item.id
      ? { ...row, etag: response.headers.etag, revision: row.revision + 1 } : row));
    await refreshBackchecks(item);
    questions.value[item.id] = '';
  } catch {
    await load();
  } finally {
    assigning.value = null;
  }
};
const cancelBackcheck = async (item, backcheck) => {
  const data = { reason: cancellationReasons.value[backcheck.id].trim() };
  assigning.value = item.id;
  try {
    const response = await request({
      method: 'POST', url: apiPaths.reviewCaseBackcheckCancel(item.id, backcheck.id),
      headers: { 'If-Match': item.etag },
      data: { ...data, requestId: retryKey(`cancel-backcheck-${backcheck.id}`, item, data) }
    });
    items.value = items.value.map((row) => (row.id === item.id
      ? { ...row, etag: response.headers.etag, revision: response.data.revision } : row));
    await refreshBackchecks(item);
    delete cancellationReasons.value[backcheck.id];
  } catch {
    await load();
  } finally {
    assigning.value = null;
  }
};
const linkBackcheck = async (item, backcheck) => {
  assigning.value = item.id;
  try {
    const response = await request({
      method: 'POST', url: apiPaths.reviewCaseBackcheckLink(item.id, backcheck.id),
      headers: { 'If-Match': item.etag },
      data: { instanceId: responses.value[backcheck.id].trim() }
    });
    items.value = items.value.map((row) => (row.id === item.id
      ? { ...row, etag: response.headers.etag, revision: row.revision + 1 } : row));
    await refreshBackchecks(item);
  } catch {
    await load();
  } finally {
    assigning.value = null;
  }
};
const recordDecision = async (item, outcome, override = false, overrideReason = 'verified-by-supervisor') => {
  const data = {
    outcome, override, reasonCode: override ? overrideReason
      : selectedReasons.value[item.id] || item.reasonCodes[0],
    note: notes.value[item.id].trim(), evidenceIds: [], integrityFindingIds: []
  };
  assigning.value = item.id;
  try {
    await request({
      method: 'POST',
      url: apiPaths.reviewCaseDecisions(item.id),
      headers: { 'If-Match': item.etag, 'Idempotency-Key': retryKey('decision', item, data) },
      data
    });
    items.value = items.value.filter((row) => row.id !== item.id);
    workload.value?.reload();
    delete inspections.value[item.id];
    delete notes.value[item.id];
  } catch {
    await load();
  } finally {
    assigning.value = null;
  }
};
const assign = async (item, releasing = false) => {
  const data = {
    assignedTo: releasing ? null : currentUser.id, status: releasing ? 'open' : 'in-review'
  };
  assigning.value = item.id;
  try {
    await request({
      method: 'PATCH',
      url: apiPaths.reviewCaseAssignment(item.id),
      headers: { 'If-Match': item.etag, 'Idempotency-Key': retryKey('assignment', item, data) },
      data
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
