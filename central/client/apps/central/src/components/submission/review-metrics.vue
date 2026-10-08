<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="review-metrics" aria-label="Review workload">
    <h3>Review workload</h3>
    <p v-if="loading" role="status">Loading review workload…</p>
    <div v-else-if="failed" role="alert">
      Review workload could not be loaded.
      <button type="button" class="btn btn-default" @click="reload">Retry workload</button>
    </div>
    <template v-else-if="metrics">
      <p>All cases for this form. Times measure elapsed time, not staff performance.</p>
      <dl>
        <div><dt>Open</dt><dd>{{ metrics.counts.open }}</dd></div>
        <div><dt>In review</dt><dd>{{ metrics.counts.inReview }}</dd></div>
        <div><dt>Resolved</dt><dd>{{ metrics.counts.resolved }}</dd></div>
        <div><dt>Superseded</dt><dd>{{ metrics.counts.superseded }}</dd></div>
        <div><dt>Oldest active case</dt><dd>{{ duration(metrics.oldestActiveSeconds) }}</dd></div>
        <div><dt>Average time to first assignment</dt><dd>{{ duration(metrics.averageFirstAssignmentSeconds) }}</dd></div>
        <div><dt>Average time to resolution</dt><dd>{{ duration(metrics.averageResolutionSeconds) }}</dd></div>
        <div><dt>Pending back-checks</dt><dd>{{ metrics.backchecks.pending }}</dd></div>
        <div><dt>Overdue back-checks</dt><dd>{{ metrics.backchecks.overdue }}</dd></div>
      </dl>
      <details>
        <summary>Reasons for active cases</summary>
        <p v-if="metrics.activeReasons.length === 0">No active routing reasons.</p>
        <ul v-else>
<li v-for="reason of metrics.activeReasons" :key="reason.reasonCode">
          {{ reason.reasonCode }}: {{ reason.count }}
        </li>
</ul>
        <p>
A case may have several reasons. Assignment average covers {{ metrics.assignedCaseCount }} cases;
          resolution average covers {{ metrics.counts.resolved }} cases.
</p>
      </details>
    </template>
  </section>
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from 'vue';
import { apiPaths } from '../../util/request';
import useRequest from '../../composables/request';

defineOptions({ name: 'SubmissionReviewMetrics' });
const props = defineProps({ projectId: { type: String, required: true }, xmlFormId: { type: String, required: true } });
const { request } = useRequest();
const metrics = ref(null);
const loading = ref(false);
const failed = ref(false);
let generation = 0;
onBeforeUnmount(() => { generation += 1; });
const duration = seconds => {
  if (seconds == null) return 'No data';
  if (seconds < 60) return 'Less than a minute';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr`;
  return `${Math.floor(seconds / 86400)} days`;
};
const reload = async () => {
  generation += 1;
  const current = generation;
  loading.value = true;
  failed.value = false;
  metrics.value = null;
  try {
    const { data } = await request({
      method: 'GET',
      url: apiPaths.reviewQueueMetrics(props.projectId, props.xmlFormId), alert: false
    });
    if (current === generation) metrics.value = data;
  } catch {
    if (current === generation) failed.value = true;
  } finally {
    if (current === generation) loading.value = false;
  }
};
watch(() => [props.projectId, props.xmlFormId], reload, { immediate: true });
defineExpose({ reload });
</script>

<style scoped>
.review-metrics { margin: 16px 0; }
dl { display: flex; flex-wrap: wrap; gap: 16px 24px; }
dl > div { flex: 1 1 150px; }
dd { margin: 4px 0 0; }
</style>
