<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="backcheck-weights">
    <h3>Sampling weights</h3>
    <p>Weights expand selected records to this draw's recorded eligible submissions. They use the actual share selected within each collector and answer group after rounding and minimums. They do not adjust for missing backchecks, nonresponse or selection in earlier draws, and are not calibrated estimates or measured error rates.</p>
    <button class="btn btn-default" type="button" :disabled="busy" @click="load">{{ data == null ? 'Show sampling weights' : 'Refresh sampling weights' }}</button>
    <p v-if="busy" role="status">Checking recorded draw membership…</p>
    <p v-if="error" role="alert">Weights could not be loaded. Use Show sampling weights to retry.</p>
    <template v-if="data != null">
      <p v-if="!data.available" role="status">{{ data.reason }}</p>
      <template v-else>
        <p role="status">{{ data.sampled }} selected from {{ data.eligible }} recorded eligible submissions. Inclusion probability = selected ÷ eligible; design weight = eligible ÷ selected, within each stratum. The seed and retained membership have been checked.</p>
        <a class="btn btn-link" :href="download" download="backcheck-sampling-weights.json">Download sampling weights JSON</a>
        <p v-if="data.strata.length === 0">No eligible submissions; there are no weights.</p>
        <div v-else class="backcheck-weights-table">
          <table class="table">
            <caption>Weights by collector{{ data.groupField ? ' and recorded answer group' : '' }}</caption>
            <thead><tr><th scope="col">Collector</th><th v-if="data.groupField" scope="col">Group</th><th scope="col">Eligible</th><th scope="col">Selected</th><th scope="col">Inclusion probability</th><th scope="col">Design weight</th></tr></thead>
            <tbody><tr v-for="(s, index) of data.strata" :key="index">
              <th scope="row">{{ s.submitterId == null ? 'Unknown collector' : `Collector #${s.submitterId}` }}</th>
              <td v-if="data.groupField">{{ s.groupValue == null ? 'Missing answer' : s.groupValue }}</td>
              <td>{{ s.eligible }}</td><td>{{ s.sampled }}</td><td>{{ format(s.inclusionProbability) }}</td><td>{{ format(s.designWeight) }}</td>
            </tr></tbody>
          </table>
        </div>
        <p>Display values are rounded to six decimal places; the JSON includes numerator/denominator counts and each selected record's weight. Collector IDs and group membership come from the retained snapshot, even if a collector or source submission was later deleted.</p>
        <backcheck-estimate :project-id="projectId" :xml-form-id="xmlFormId" :weights="data"/>
      </template>
    </template>
  </section>
</template>
<script setup>
import { computed, ref } from 'vue';
import BackcheckEstimate from './backcheck-estimate.vue';
import useRequest from '../../composables/request';
defineOptions({ name: 'BackcheckWeights' });
const props = defineProps({ projectId: { type: String, required: true }, xmlFormId: { type: String, required: true }, sampleId: { type: String, required: true } });
const { request, awaitingResponse: busy } = useRequest();
const data = ref(null); const error = ref(false);
const load = () => {
  if (busy.value) return;
  error.value = false; data.value = null;
  request({ method: 'GET', url: `/v1/projects/${props.projectId}/forms/${encodeURIComponent(props.xmlFormId)}/backcheck-samples/${props.sampleId}/weights`, alert: false })
    .then(response => { data.value = response.data; })
    .catch(() => { error.value = true; });
};
const download = computed(() => `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(data.value, null, 2))}`);
const format = value => Number(value).toLocaleString(undefined, { maximumFractionDigits: 6 });
</script>
<style lang="scss">
.backcheck-weights { margin: 16px 0; .backcheck-weights-table { overflow-x: auto; } caption { color: inherit; font-weight: bold; } }
</style>
