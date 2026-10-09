<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="backcheck-comparison" aria-label="Back-check answer comparison">
    <button type="button" class="btn btn-default" :disabled="loading" @click="load">
      {{ failed ? 'Retry answer comparison' : 'Compare answers' }}
    </button>
    <p v-if="loading" role="status">Loading pinned submission answers…</p>
    <p v-else-if="failed" role="alert">Answer comparison could not be loaded. Retry to inspect the linked versions.</p>
    <template v-else-if="comparison">
      <h4>Original and back-check answers</h4>
      <p>Exact recorded versions. Differences do not determine acceptance or rejection.</p>
      <div class="sources">
        <div v-for="kind of ['original', 'backcheck']" :key="kind">
          <h5>{{ kind === 'original' ? 'Original' : 'Back-check' }}</h5>
          <p>Form: {{ comparison[kind].xmlFormId || 'Unknown' }} · Version: {{ comparison[kind].instanceId }} · Form version: {{ comparison[kind].formVersion || 'Unknown' }}</p>
          <p v-if="!comparison[kind].current">Historical version; newer edits are not included.</p>
          <p>
Origin: {{ comparison[kind].provenance.origin || 'Unknown' }} ·
            Captured: {{ comparison[kind].provenance.capturedAt || 'Unknown' }} ·
            Integrity: {{ comparison[kind].integrityStatus }}
</p>
          <p v-if="comparison[kind].provenance.degraded">
            Provenance limitations: {{ JSON.stringify(comparison[kind].provenance.degraded) }}
          </p>
          <a :href="comparison[kind].xmlDownloadUrl">Download {{ kind === 'original' ? 'original' : 'back-check' }} version XML</a>
        </div>
      </div>
      <p v-if="comparison.original.xmlFormId !== comparison.backcheck.xmlFormId">
        Different forms: matching field paths do not establish equivalent questions or answers.
      </p>
      <p v-if="comparison.original.formVersion !== comparison.backcheck.formVersion">
        Form versions differ; field paths or answer meanings may have changed.
      </p>
      <p v-if="comparison.unavailableReason" role="status">{{ unavailableText(comparison.unavailableReason) }}</p>
      <template v-else>
        <p>
Same: {{ comparison.summary.same }} · Changed: {{ comparison.summary.changed }} ·
          Missing from original: {{ comparison.summary.missingOriginal }} ·
          Missing from back-check: {{ comparison.summary.missingBackcheck }}
</p>
        <p>
Repeats align by position, not person or identity. Reordered entries may appear changed.
          Text is compared exactly; metadata and attachment contents are excluded.
</p>
        <p v-if="comparison.rows.length === 0">No answer fields are present in these versions.</p>
        <div v-else class="table-container">
          <table class="table">
            <caption>Answer text from the original and linked back-check versions</caption>
            <thead><tr><th scope="col">Field / repeat position</th><th scope="col">Original</th><th scope="col">Back-check</th><th scope="col">Comparison</th></tr></thead>
            <tbody>
              <tr v-for="row of comparison.rows" :key="row.path">
                <th scope="row">{{ row.path }}</th>
                <td>{{ answerText(row.original) }}</td><td>{{ answerText(row.backcheck) }}</td>
                <td>{{ statusText(row.status) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </section>
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from 'vue';
import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';

defineOptions({ name: 'SubmissionBackcheckComparison' });
const props = defineProps({ caseId: { type: String, required: true }, backcheckId: { type: String, required: true } });
const { request } = useRequest();
const loading = ref(false);
const failed = ref(false);
const comparison = ref(null);
let generation = 0;
onBeforeUnmount(() => { generation += 1; });
watch(() => [props.caseId, props.backcheckId], () => {
  generation += 1;
  loading.value = false;
  failed.value = false;
  comparison.value = null;
});
const answerText = value => (value === null ? 'Not present' : value === '' ? 'Empty answer' : value);
const statusText = status => ({
  same: 'Same', changed: 'Changed',
  missingOriginal: 'Missing from original', missingBackcheck: 'Missing from back-check'
})[status] || status;
const unavailableText = reason => ({
  'source-integrity': 'Comparison unavailable: source integrity could not be verified. Inspect the source versions.',
  'size-limit': 'Comparison unavailable: these answers exceed the comparison limits. Inspect the source versions.',
  'unsupported-xml': 'Comparison unavailable: the XML structure is unsupported. Inspect the source versions.'
})[reason] || 'Comparison unavailable. Inspect the source versions.';
const load = async () => {
  generation += 1;
  const current = generation;
  loading.value = true;
  failed.value = false;
  comparison.value = null;
  try {
    const { data } = await request({
      method: 'GET',
      url: apiPaths.reviewCaseBackcheckComparison(props.caseId, props.backcheckId), alert: false
    });
    if (current === generation) comparison.value = data;
  } catch {
    if (current === generation) failed.value = true;
  } finally {
    if (current === generation) loading.value = false;
  }
};
</script>

<style scoped>
.backcheck-comparison { margin-top: 12px; overflow-wrap: anywhere; }
.sources { display: flex; flex-wrap: wrap; gap: 16px; }
.sources > div { flex: 1 1 220px; min-width: 0; }
.table-container { max-width: 100%; overflow-x: auto; }
table { width: 100%; table-layout: fixed; }
th, td { overflow-wrap: anywhere; white-space: pre-wrap; }
</style>
