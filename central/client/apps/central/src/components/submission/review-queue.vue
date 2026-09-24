<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="review-queue" aria-labelledby="review-queue-title">
    <h2 id="review-queue-title">Claim review queue</h2>
    <p>Submissions flagged for review appear here. A flag is a question, not a finding of fraud.</p>
    <p v-if="loading && items.length === 0">Loading review cases…</p>
    <div v-else-if="error" role="alert">
      Review cases could not be loaded.
      <button type="button" class="btn btn-default" @click="load(nextCursor)">
        Try again
      </button>
    </div>
    <p v-else-if="items.length === 0">No open claim review cases for this form.</p>
    <ul v-else class="list-group">
      <li v-for="item of items" :key="item.id" class="list-group-item">
        <router-link :to="submissionPath(item.claim.rootInstanceId)">
          {{ item.claim.rootInstanceId }}
        </router-link>
        <span> · Claim version {{ item.claim.ordinal }} · {{ item.priority }} priority</span>
        <span v-if="item.claim.current === false" class="text-warning"> · Superseded version</span>
        <span> · Reason: {{ item.reasonCodes.join(', ') }}</span>
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

defineOptions({ name: 'SubmissionReviewQueue' });
const props = defineProps({
  projectId: { type: String, required: true },
  xmlFormId: { type: String, required: true }
});
const { request } = useRequest();
const items = ref([]);
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
      url: apiPaths.reviewQueue(props.projectId, props.xmlFormId, cursor),
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
watch(() => [props.projectId, props.xmlFormId], () => {
  items.value = [];
  nextCursor.value = null;
  load();
}, { immediate: true });
</script>
