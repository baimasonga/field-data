<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="backcheck-estimate">
    <h4>Calibrated binary outcome estimate</h4>
    <p>Calibrates reviewed outcomes to the recorded eligible count in each collector/group stratum. This estimates only this draw's eligible frame. It is not a project-wide fraud or error rate. Review outcomes and their meaning are supplied by you; backcheck differences are not automatically errors.</p>
    <a class="btn btn-link" :href="templateDownload" download="backcheck-outcome-template.json">Download outcome template</a>
    <p>Fill each selected record with 0 or 1; leave null for unknown. Keep the sampleId unchanged. Supply what 1 means and the review source/date below or in the file. Inputs and results are not saved on the server; download the result to retain them.</p>
    <form @submit.prevent="calculate">
      <label>Reviewed outcomes JSON<input :disabled="busy || reading" type="file" accept=".json,application/json" @change="upload"></label>
      <label>What does outcome 1 mean?<input v-model="definition" :disabled="busy || reading" class="form-control" maxlength="1000" required @input="result = null"></label>
      <label>Review source and date<input v-model="source" :disabled="busy || reading" class="form-control" maxlength="1000" required @input="result = null"></label>
      <p>{{ outcomes.filter(row => row.value === 0 || row.value === 1).length }} reviewed outcomes supplied for {{ weights.sampled }} selected records.</p>
      <label><input v-model="assumeRandomResponse" :disabled="busy || reading" type="checkbox" @change="result = null"> If selected outcomes are missing, I assume response behaves like a random subsample within every recorded stratum. This assumption is not verified by the system.</label>
      <button class="btn btn-default" type="submit" :disabled="busy || reading || !loaded">Calculate calibrated estimate</button>
    </form>
    <p v-if="reading || busy" role="status">{{ reading ? 'Reading outcome file…' : 'Checking and calculating…' }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-if="result" class="backcheck-estimate-result">
      <p v-if="!result.available" role="status">{{ result.reason }}</p>
      <template v-else>
        <p role="status">Estimated proportion: {{ percentage(result.estimatedProportion) }}. Conservative 95% bound: {{ percentage(result.interval.lower) }} to {{ percentage(result.interval.upper) }}.</p>
        <p>Estimated positive total: {{ number(result.estimatedPositiveTotal) }} of {{ result.eligible }} recorded eligible submissions. Reviewed {{ result.reviewed }} of {{ result.sampled }} selected records; {{ result.missing }} selected outcomes unknown.</p>
        <p v-if="result.responseAssumption === 'random-within-each-stratum'">This estimate and bound depend on your unverified random-response assumption within every stratum. They do not correct outcome misclassification or systematic nonresponse.</p>
        <p>The bound uses the randomized draw model and is deliberately conservative. It can span 0%–100% for small samples. A complete reviewed frame has no sampling uncertainty. No external population benchmarks or accuracy claims are inferred.</p>
      </template>
      <a class="btn btn-link" :href="resultDownload" download="backcheck-calibrated-estimate.json">Download estimate and diagnostics JSON</a>
      <div class="backcheck-estimate-table" v-if="result.strata?.length">
        <table class="table"><caption>Calibration to retained stratum counts</caption>
          <thead><tr><th>Collector</th><th v-if="weights.groupField">Group</th><th>Target eligible</th><th>Selected</th><th>Reviewed</th><th>Positive</th><th>Calibrated weight</th></tr></thead>
          <tbody><tr v-for="(row, index) of result.strata" :key="index"><th scope="row">{{ row.submitterId == null ? 'Unknown' : `#${row.submitterId}` }}</th><td v-if="weights.groupField">{{ row.groupValue == null ? 'Missing answer' : row.groupValue }}</td><td>{{ row.eligible }}</td><td>{{ row.sampled }}</td><td>{{ row.reviewed }}</td><td>{{ row.positive }}</td><td>{{ row.calibratedWeight == null ? 'Unavailable' : number(row.calibratedWeight) }}</td></tr></tbody>
        </table>
      </div>
    </div>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import useRequest from '../../composables/request';
defineOptions({ name: 'BackcheckEstimate' });
const props = defineProps({ projectId: { type: String, required: true }, xmlFormId: { type: String, required: true }, weights: { type: Object, required: true } });
const { request, awaitingResponse: busy } = useRequest();
const outcomes = ref([]); const definition = ref(''); const source = ref(''); const assumeRandomResponse = ref(false);
const result = ref(null); const error = ref(''); const loaded = ref(false); const reading = ref(false);
let version = 0;
onBeforeUnmount(() => { version += 1; });
const upload = async event => {
  const current = ++version; const file = event.target.files?.[0];
  outcomes.value = []; loaded.value = false; result.value = null; error.value = ''; assumeRandomResponse.value = false;
  if (!file) { reading.value = false; return; }
  reading.value = true;
  try {
    if (file.size > 1048576) throw new Error('Use an outcome file no larger than 1 MiB.');
    const data = JSON.parse(await file.text());
    if (data?.sampleId !== props.weights.sampleId || !Array.isArray(data.outcomes) || data.outcomes.length > 500 || data.outcomes.some(row => row == null || typeof row.instanceId !== 'string' || ![0, 1, null].includes(row.value))) throw new Error('Use this sample’s outcome template with at most 500 rows.');
    if (current !== version) return;
    outcomes.value = data.outcomes; definition.value = typeof data.definition === 'string' ? data.definition : ''; source.value = typeof data.source === 'string' ? data.source : ''; loaded.value = true;
  } catch (e) { if (current === version) error.value = e instanceof SyntaxError ? 'This is not valid outcome JSON.' : e.message; }
  finally { if (current === version) reading.value = false; }
};
const calculate = () => {
  if (busy.value || !loaded.value) return;
  result.value = null; error.value = '';
  request({ method: 'POST', url: `/v1/projects/${props.projectId}/forms/${encodeURIComponent(props.xmlFormId)}/backcheck-samples/${props.weights.sampleId}/estimate`,
    data: { sampleId: props.weights.sampleId, definition: definition.value, source: source.value, outcomes: outcomes.value, assumeRandomResponse: assumeRandomResponse.value }, alert: false })
    .then(response => { result.value = response.data; })
    .catch(e => { error.value = e.response?.data?.message || 'The estimate could not be calculated. Check the file and retry.'; });
};
const jsonLink = value => `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(value, null, 2))}`;
const templateDownload = computed(() => jsonLink({ sampleId: props.weights.sampleId, definition: '', source: '', outcomes: props.weights.items.map(item => ({ instanceId: item.instanceId, value: null })) }));
const resultDownload = computed(() => jsonLink(result.value));
const number = value => Number(value).toLocaleString(undefined, { maximumFractionDigits: 6 });
const percentage = value => Number(value).toLocaleString(undefined, { style: 'percent', maximumFractionDigits: 2 });
</script>
<style lang="scss">
.backcheck-estimate { margin: 18px 0; label { display: block; max-width: 100%; margin: 8px 0; } input[type=file] { max-width: 100%; } .backcheck-estimate-table { overflow-x: auto; } }
</style>
