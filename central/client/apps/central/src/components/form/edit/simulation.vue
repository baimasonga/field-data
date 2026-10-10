<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.

Interview simulation (S2): the form's own logic over seeded, simulated
interviews, on request. Evidence, not proof; the Form check proves.
Contract: docs/field-intelligence/S2-survey-simulation.md -->
<template>
  <form-edit-section id="form-edit-simulation">
    <template #title>Simulated interviews</template>
    <template #subtitle>
      Runs the {{ target === 'draft' ? 'Draft' : 'published' }} form's logic over many simulated interviews with random answers,
      to find questions no interview reaches, constraints no answer meets, and how long interviews are.
      What it finds is evidence, not proof: a rare combination of answers may still be missed.
    </template>
    <template #actions>
      <form class="simulation-settings" @submit.prevent="run">
        <label>Interviews
          <input v-model.number="runs" type="number" min="1" max="1000" step="1" required class="form-control input-sm">
        </label>
        <label>Seed (optional)
          <input v-model.trim="seed" type="text" maxlength="64" pattern="[A-Za-z0-9_\-]{1,64}" class="form-control input-sm"
            placeholder="random">
        </label>
        <button type="submit" class="btn btn-default btn-sm" :aria-disabled="awaitingResponse">
          Simulate interviews <spinner :state="awaitingResponse"/>
        </button>
      </form>
    </template>
    <template #body>
      <p v-if="error" role="alert" class="simulation-error">{{ error }}</p>
      <p v-else-if="report == null && !awaitingResponse" class="simulation-idle">Not simulated yet.</p>
      <template v-else-if="report != null">
        <p class="simulation-summary" role="status">
          {{ report.runs }} simulated interviews (seed <code>{{ report.seed }}</code>)<template v-if="report.reducedForBudget">,
          fewer than the {{ report.runsAsked }} asked because the form is large</template>:
          {{ report.length.min }} to {{ report.length.max }} questions shown, {{ report.length.median }} typically.
        </p>
        <p v-if="report.neverShown.length === 0 && report.constraintNeverMet.length === 0" class="simulation-clean">
          Every question was shown in some interview, and every constraint was met.
        </p>

        <details v-if="report.neverShown.length > 0" class="simulation-group simulation-never" open>
          <summary>Never shown ({{ report.neverShown.length }})</summary>
          <p class="simulation-hint">No simulated interview reached these questions. Check the conditions that show them.</p>
          <ul class="simulation-list">
            <li v-for="path of report.neverShown" :key="path">
              <code>{{ path }}</code>{{ labelAfter(path) }}
            </li>
          </ul>
        </details>
        <details v-if="report.constraintNeverMet.length > 0" class="simulation-group simulation-constraint" open>
          <summary>Constraint not met ({{ report.constraintNeverMet.length }})</summary>
          <p class="simulation-hint">In these interviews, none of the simulated answers met the question's constraint, often because it depends on an earlier answer.</p>
          <ul class="simulation-list">
            <li v-for="c of report.constraintNeverMet" :key="c.path">
              <code>{{ c.path }}</code>{{ labelAfter(c.path) }} · {{ c.interviews }} of {{ report.runs }} interviews
            </li>
          </ul>
        </details>
        <details v-if="report.notSimulated.length > 0" class="simulation-group simulation-not-simulated">
          <summary>Not simulated ({{ report.notSimulated.length }})</summary>
          <p class="simulation-hint">These expressions were not evaluated: relevance and constraints counted as true, calculations as blank.</p>
          <ul class="simulation-list">
            <li v-for="n of report.notSimulated" :key="`${n.path} ${n.attribute}`">
              <code>{{ n.path }}</code> {{ n.attribute }}: {{ n.reason }}
            </li>
          </ul>
        </details>
        <details class="simulation-group simulation-all">
          <summary>Every question ({{ report.questions.length }})</summary>
          <table class="table simulation-table">
            <thead><tr><th scope="col">Question</th><th scope="col">Shown</th><th scope="col">Answered</th></tr></thead>
            <tbody>
              <tr v-for="q of report.questions" :key="q.path">
                <th scope="row"><code>{{ q.path }}</code></th>
                <td>{{ q.shown }}</td><td>{{ q.answered }}</td>
              </tr>
            </tbody>
          </table>
        </details>
      </template>
    </template>
  </form-edit-section>
</template>

<script setup>
import { computed, ref, watch } from 'vue';

import FormEditSection from './section.vue';
import Spinner from '../../spinner.vue';

import useRequest from '../../../composables/request';
import { apiPaths } from '../../../util/request';

defineOptions({ name: 'FormEditSimulation' });
const props = defineProps({
  projectId: { type: String, required: true },
  xmlFormId: { type: String, required: true },
  target: { type: String, default: 'draft' },
  // Changes when the definition changes, so an old report is not shown.
  definitionKey: { type: String, default: null }
});
const { request, awaitingResponse } = useRequest();

const runs = ref(200); const seed = ref('');
const report = ref(null); const error = ref('');
watch(() => [props.target, props.definitionKey], () => { report.value = null; error.value = ''; });

const run = () => {
  if (awaitingResponse.value) return Promise.resolve();
  const base = apiPaths.form(props.projectId, props.xmlFormId);
  const params = new URLSearchParams({ runs: String(runs.value) });
  if (seed.value !== '') params.set('seed', seed.value);
  return request({ method: 'GET', url: `${props.target === 'draft' ? `${base}/draft` : base}/simulation?${params}`, alert: false })
    .then(({ data }) => { report.value = data; error.value = ''; })
    .catch((e) => {
      report.value = null;
      error.value = e.response?.data?.message || 'The interviews could not be simulated.';
    });
};

const labels = computed(() => new Map((report.value?.questions ?? []).map((q) => [q.path, q.label])));
const labelAfter = (path) => (labels.value.get(path) ? ` ${labels.value.get(path)}` : '');
</script>

<style lang="scss">
@import '../../../assets/scss/variables';

#form-edit-simulation {
  overflow-wrap: anywhere;

  .simulation-settings {
    align-items: flex-end; display: flex; flex-wrap: wrap; gap: 8px;
    label { display: flex; flex-direction: column; font-weight: normal; font-size: 12px; max-width: 160px; }
  }
  .simulation-summary { margin-bottom: 8px; }
  .simulation-clean { color: $color-success; }
  .simulation-error { color: $color-danger; }
  .simulation-hint, .simulation-idle { color: $color-text-secondary; }
  .simulation-group { margin: 8px 0; summary { cursor: pointer; font-weight: bold; } }
  .simulation-list { margin: 6px 0 0; padding-left: 18px; }
  .simulation-table { max-width: 640px; }
}
</style>
