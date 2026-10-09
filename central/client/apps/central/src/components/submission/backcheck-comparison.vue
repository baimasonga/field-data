<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="backcheck-comparison" aria-label="Back-check answer comparison">
    <button type="button" class="btn btn-default" :disabled="loading || saving" @click="load">
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
        Different forms: a supervisor must select equivalent fields before their answers are compared.
      </p>
      <p v-if="comparison.original.formVersion !== comparison.backcheck.formVersion">
        Form versions differ; field paths or answer meanings may have changed.
      </p>
      <p v-if="comparison.unavailableReason" role="status">{{ unavailableText(comparison.unavailableReason) }}</p>
      <template v-else>
        <p v-if="comparison.comparisonMode === 'unmapped'">No field mapping has been saved. All answers are unmapped.</p>
        <template v-if="comparison.mapping">
          <p>Field mapping revision: {{ comparison.mapping.revision }}</p>
          <details v-if="comparison.mapping.history.length">
            <summary>Mapping history (latest 100 revisions)</summary>
            <div v-for="version of comparison.mapping.history" :key="version.id">
              <p>Revision {{ version.revision }} · {{ version.actorName || version.actorId }} · {{ version.createdAt }}: {{ version.note }}</p>
              <ul><li v-for="pair of version.pairs" :key="pair.originalPath">{{ pair.label }}: {{ pair.originalPath }} → {{ pair.backcheckPath }}</li></ul>
            </div>
          </details>
          <details v-if="comparison.mapping.allowed">
            <summary>Configure field mapping</summary>
            <p>Select equivalent questions from these pinned versions. Use exact paths with repeat positions. A path may be absent on one side if the other side is present; it will be shown as missing. Unselected fields remain unmapped. Saving an empty mapping marks every field unmapped.</p>
            <form @submit.prevent="saveMapping">
              <fieldset :disabled="saving">
                <datalist :id="`original-paths-${backcheckId}`"><option v-for="path of comparison.availablePaths.original" :key="path" :value="path"></option></datalist>
                <datalist :id="`backcheck-paths-${backcheckId}`"><option v-for="path of comparison.availablePaths.backcheck" :key="path" :value="path"></option></datalist>
                <div v-for="(pair, index) of pairs" :key="index" class="mapping-pair">
                  <label>Label <input v-model="pair.label" class="form-control" maxlength="100"></label>
                  <label>Original field path <input v-model="pair.originalPath" class="form-control" :list="`original-paths-${backcheckId}`" required></label>
                  <label>Back-check field path <input v-model="pair.backcheckPath" class="form-control" :list="`backcheck-paths-${backcheckId}`" required></label>
                  <button class="btn btn-default" type="button" :aria-label="`Remove field pair ${index + 1}`" @click="pairs.splice(index, 1)">Remove pair</button>
                  <p v-if="!comparison.availablePaths.original.includes(pair.originalPath) || !comparison.availablePaths.backcheck.includes(pair.backcheckPath)">At least one path is not present in these answers. Check spelling and repeat position.</p>
                </div>
                <button class="btn btn-default" type="button" :disabled="pairs.length >= 100" @click="pairs.push({ label: '', originalPath: '', backcheckPath: '' })">Add field pair</button>
                <label class="mapping-note">Reason for mapping change <textarea v-model="mappingNote" class="form-control" required maxlength="2000"></textarea></label>
                <button class="btn btn-primary" type="submit">{{ saving ? 'Saving…' : 'Save field mapping' }}</button>
              </fieldset>
            </form>
          </details>
        </template>
        <p v-if="mappingError" role="alert">{{ mappingError }}</p>
        <p v-if="mappingSaved" role="status">Field mapping saved. Review decisions are unchanged.</p>
        <p>
Same: {{ comparison.summary.same }} · Changed: {{ comparison.summary.changed }} ·
          Missing from original: {{ comparison.summary.missingOriginal }} ·
          Missing from back-check: {{ comparison.summary.missingBackcheck }}
</p>
        <p v-if="comparison.summary.unmappedOriginal != null">Unmapped original: {{ comparison.summary.unmappedOriginal }} · Unmapped back-check: {{ comparison.summary.unmappedBackcheck }}</p>
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
                <th scope="row"><template v-if="row.originalPath !== undefined">{{ row.label || 'Field' }}<br>Original: {{ row.originalPath || 'Unmapped' }}<br>Back-check: {{ row.backcheckPath || 'Unmapped' }}</template><template v-else>{{ row.path }}</template></th>
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
const pairs = ref([]);
const mappingNote = ref('');
const saving = ref(false);
const mappingError = ref('');
const mappingSaved = ref(false);
let retrySignature = null;
let retryId = null;
let generation = 0;
onBeforeUnmount(() => { generation += 1; });
watch(() => [props.caseId, props.backcheckId], () => {
  generation += 1;
  loading.value = false;
  failed.value = false;
  comparison.value = null;
  pairs.value = [];
  mappingNote.value = '';
  saving.value = false;
  mappingError.value = '';
  mappingSaved.value = false;
  retrySignature = null;
  retryId = null;
});
const answerText = value => (value === null ? 'Not present' : value === '' ? 'Empty answer' : value);
const statusText = status => ({
  same: 'Same', changed: 'Changed',
  missingOriginal: 'Missing from original', missingBackcheck: 'Missing from back-check',
  unmappedOriginal: 'Unmapped original', unmappedBackcheck: 'Unmapped back-check'
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
    if (current === generation) {
      comparison.value = data;
      pairs.value = (data.mapping?.history[0]?.pairs ?? []).map(pair => ({ ...pair }));
      mappingNote.value = '';
      mappingError.value = '';
      retrySignature = null;
      retryId = null;
    }
  } catch {
    if (current === generation) failed.value = true;
  } finally {
    if (current === generation) loading.value = false;
  }
};
const saveMapping = async () => {
  if (saving.value || comparison.value?.mapping?.allowed !== true) return;
  const current = generation;
  const { etag } = comparison.value.mapping;
  const data = { pairs: pairs.value.map(pair => ({ ...pair })), note: mappingNote.value };
  const signature = JSON.stringify({ etag, data });
  if (signature !== retrySignature) {
    retrySignature = signature;
    retryId = crypto.randomUUID();
  }
  saving.value = true;
  mappingError.value = '';
  mappingSaved.value = false;
  try {
    await request({
      method: 'POST',
      url: apiPaths.reviewCaseBackcheckMapping(props.caseId, props.backcheckId),
      headers: { 'If-Match': etag }, data: { ...data, requestId: retryId }, alert: false
    });
    if (current === generation) {
      mappingSaved.value = true;
      saving.value = false;
      await load();
    }
  } catch (error) {
    if (current === generation) mappingError.value = [409, 412].includes(error.response?.status)
      ? 'Another supervisor changed this mapping. Reload the comparison and review their mapping before saving.'
      : 'Field mapping could not be saved. Check that paths are literal, unique, and present on at least one side, then retry.';
  } finally {
    if (current === generation) saving.value = false;
  }
};
</script>

<style scoped>
.backcheck-comparison { margin-top: 12px; overflow-wrap: anywhere; }
.mapping-pair { margin: 12px 0; border-bottom: 1px solid #ddd; padding-bottom: 12px; }
.mapping-pair label, .mapping-note { display: block; }
fieldset { min-width: 0; }
.sources { display: flex; flex-wrap: wrap; gap: 16px; }
.sources > div { flex: 1 1 220px; min-width: 0; }
.table-container { max-width: 100%; overflow-x: auto; }
table { width: 100%; table-layout: fixed; }
th, td { overflow-wrap: anywhere; white-space: pre-wrap; }
</style>
