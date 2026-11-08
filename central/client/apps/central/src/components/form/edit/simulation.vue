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
          <input v-model.number="runs" type="number" min="1" max="1000" step="1" required class="form-control input-sm" :disabled="running">
        </label>
        <label>Seed (optional)
          <input v-model.trim="seed" type="text" maxlength="64" pattern="[A-Za-z0-9_\-]{1,64}" class="form-control input-sm"
            placeholder="random" :disabled="running">
        </label>
        <label v-if="target === 'draft' && publishedHash" class="simulation-compare-toggle">
          <span><input v-model="compare" type="checkbox" :disabled="running" @change="baseline = null"> Compare with published version</span>
        </label>
        <button type="submit" class="btn btn-default btn-sm" :disabled="running">
          Simulate interviews <spinner :state="running"/>
        </button>
      </form>
    </template>
    <template #body>
      <p v-if="error" role="alert" class="simulation-error">{{ error }}</p>
      <p v-else-if="report == null && !running" class="simulation-idle">Not simulated yet.</p>
      <template v-else-if="report != null">
        <div v-if="baseline != null" class="simulation-comparison">
          <h3>Draft compared with published version</h3>
          <p>The same seed and requested number of interviews were used. Different question paths or logic can change random draws, so these are separate simulations, not paired interviews. Differences are evidence to review, not proof of an improvement.</p>
          <p>Published version {{ baseline.formVersion || '(no version string)' }}: {{ baseline.runs }} interviews, typically {{ baseline.length.median }} questions; draft version {{ report.formVersion || '(no version string)' }}: {{ report.runs }} interviews, typically {{ report.length.median }} questions. Published report <code>{{ baseline.reportHash }}</code>; draft report <code>{{ report.reportHash }}</code>.</p>
          <p v-if="baseline.reducedForBudget || report.reducedForBudget">The simulation budget reduced at least one run count; percentages use the actual count for each version.</p>
          <p v-if="baseline.notSimulated.length || report.notSimulated.length">Some expressions were not simulated (published: {{ baseline.notSimulated.length }}, draft: {{ report.notSimulated.length }}). Review both reports before interpreting differences.</p>
          <details v-if="baseline.notSimulated.length" class="simulation-group">
            <summary>Published expressions not simulated ({{ baseline.notSimulated.length }})</summary>
            <ul class="simulation-list"><li v-for="n of baseline.notSimulated" :key="`${n.path} ${n.attribute}`"><code>{{ n.path }}</code> {{ n.attribute }}: {{ n.reason }}</li></ul>
          </details>
          <div class="simulation-comparison-table">
            <table class="table">
              <caption>Share of simulated interviews in which each question was shown</caption>
              <thead><tr><th scope="col">Question path</th><th scope="col">Published</th><th scope="col">Draft</th></tr></thead>
              <tbody><tr v-for="row of comparisonRows" :key="row.path"><th scope="row"><code>{{ row.path }}</code></th><td>{{ row.before }}</td><td>{{ row.after }}</td></tr></tbody>
            </table>
          </div>
          <p>A matching path does not establish that a question's meaning is unchanged. “Not in version” means the path was not in that simulation.</p>
        </div>
        <p class="simulation-summary" role="status">
          {{ report.runs }} simulated interviews (seed <code>{{ report.seed }}</code>)<template v-if="report.reducedForBudget">
,
          fewer than the {{ report.runsAsked }} asked because the form is large
</template>:
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
  definitionKey: { type: String, default: null },
  publishedHash: { type: String, default: null }
});
const { request } = useRequest();

const runs = ref(200); const seed = ref('');
const report = ref(null); const baseline = ref(null); const compare = ref(false); const running = ref(false); const error = ref('');
let generation = 0;
watch(() => [props.projectId, props.xmlFormId, props.target, props.definitionKey, props.publishedHash], () => { generation += 1; report.value = null; baseline.value = null; error.value = ''; });

const run = async () => {
  if (running.value) return;
  const current = generation; const comparing = compare.value && props.target === 'draft' && props.publishedHash != null;
  const draftHash = props.definitionKey; const { publishedHash } = props;
  const base = apiPaths.form(props.projectId, props.xmlFormId);
  const params = new URLSearchParams({ runs: String(runs.value) });
  if (seed.value !== '') params.set('seed', seed.value);
  running.value = true; report.value = null; baseline.value = null; error.value = '';
  try {
    const { data } = await request({ method: 'GET', url: `${props.target === 'draft' ? `${base}/draft` : base}/simulation?${params}`, alert: false });
    if (current !== generation) return;
    if (draftHash && data.hash !== draftHash) throw new Error('The form changed while simulating. Refresh the page and try again.');
    let previous = null;
    if (comparing) {
      params.set('seed', data.seed);
      previous = (await request({ method: 'GET', url: `${base}/simulation?${params}`, alert: false })).data;
      if (current !== generation) return;
      if (previous.hash !== publishedHash || previous.seed !== data.seed || previous.simulatedToday !== data.simulatedToday) throw new Error('The form or simulation date changed. Refresh the page and try again.');
    }
    report.value = data; baseline.value = previous;
  } catch (e) {
    if (current === generation) error.value = e.response?.data?.message || e.message || 'The interviews could not be simulated.';
  } finally { running.value = false; }
};

const labels = computed(() => new Map((report.value?.questions ?? []).map((q) => [q.path, q.label])));
const labelAfter = (path) => (labels.value.get(path) ? ` ${labels.value.get(path)}` : '');
const comparisonRows = computed(() => {
  if (!baseline.value || !report.value) return [];
  const before = new Map(baseline.value.questions.map(q => [q.path, q]));
  const after = new Map(report.value.questions.map(q => [q.path, q]));
  const show = (q, count) => (q ? `${((100 * q.shown) / count).toFixed(1)}% (${q.shown}/${count})` : 'Not in version');
  return [...new Set([...before.keys(), ...after.keys()])].sort().map(path => ({ path, before: show(before.get(path), baseline.value.runs), after: show(after.get(path), report.value.runs) }));
});
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
  .simulation-comparison { margin: 12px 0; }
  .simulation-comparison-table { overflow-x: auto; }
  .simulation-clean { color: $color-success; }
  .simulation-error { color: $color-danger; }
  .simulation-hint, .simulation-idle { color: $color-text-secondary; }
  .simulation-group { margin: 8px 0; summary { cursor: pointer; font-weight: bold; } }
  .simulation-list { margin: 6px 0 0; padding-left: 18px; }
  .simulation-table { max-width: 640px; }
}
</style>
