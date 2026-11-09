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
        <label v-if="publishedHash" class="simulation-compare-toggle">
          <span><input v-model="compare" type="checkbox" :disabled="running || versionsLoading" @change="toggleComparison"> Compare versions</span>
        </label>
        <template v-if="compare">
          <label>Compare version
            <select v-model="selectedTarget" class="form-control input-sm" :disabled="running || versionsLoading" @change="clearComparison">
              <option value="current">{{ target === 'draft' ? 'Current draft' : 'Current published version' }}</option>
              <option v-for="(version, index) of versions" :key="`target-${index}`" :value="`version:${index}`">{{ versionLabel(version) }}</option>
            </select>
          </label>
          <label>Against version
            <select v-model="selectedBaseline" class="form-control input-sm" :disabled="running || versionsLoading" @change="clearComparison">
              <option v-for="(version, index) of versions" :key="`baseline-${index}`" :value="`version:${index}`">{{ versionLabel(version) }}</option>
            </select>
          </label>
          <span v-if="versionsLoading" role="status">Loading published versions…</span>
        </template>
        <button type="submit" class="btn btn-default btn-sm" :disabled="running || versionsLoading || (compare && !selectedBaseline)">
          Simulate interviews <spinner :state="running"/>
        </button>
      </form>
    </template>
    <template #body>
      <p v-if="error" role="alert" class="simulation-error">{{ error }}</p>
      <p v-else-if="report == null && !running" class="simulation-idle">Not simulated yet.</p>
      <template v-else-if="report != null">
        <div v-if="baseline != null" class="simulation-comparison">
          <h3>Simulation comparison</h3>
          <p>The same seed and requested number of interviews were used. Different question paths or logic can change random draws, so these are separate simulations, not paired interviews. Differences are evidence to review, not proof of an improvement.</p>
          <p>Baseline version {{ baseline.formVersion || '(no version string)' }}: {{ baseline.runs }} interviews, typically {{ baseline.length.median }} questions; {{ report.draft ? 'draft' : 'comparison' }} version {{ report.formVersion || '(no version string)' }}: {{ report.runs }} interviews, typically {{ report.length.median }} questions. Baseline report <code>{{ baseline.reportHash }}</code>; comparison report <code>{{ report.reportHash }}</code>.</p>
          <button type="button" class="btn btn-default btn-sm" @click="downloadComparison">Download comparison JSON</button>
          <p v-if="baseline.reducedForBudget || report.reducedForBudget">The simulation budget reduced at least one run count; percentages use the actual count for each version.</p>
          <p v-if="baseline.notSimulated.length || report.notSimulated.length">Some expressions were not simulated (baseline: {{ baseline.notSimulated.length }}, comparison: {{ report.notSimulated.length }}). Review both reports before interpreting differences.</p>
          <details v-if="baseline.notSimulated.length" class="simulation-group">
            <summary>Baseline expressions not simulated ({{ baseline.notSimulated.length }})</summary>
            <ul class="simulation-list"><li v-for="n of baseline.notSimulated" :key="`${n.path} ${n.attribute}`"><code>{{ n.path }}</code> {{ n.attribute }}: {{ n.reason }}</li></ul>
          </details>
          <div class="simulation-comparison-table">
            <table class="table">
              <caption>Share of simulated interviews in which each question was shown</caption>
              <thead><tr><th scope="col">Question path</th><th scope="col">Baseline</th><th scope="col">Comparison</th></tr></thead>
              <tbody><tr v-for="row of comparisonRows" :key="row.path"><th scope="row"><code>{{ row.path }}</code></th><td>{{ row.before }}</td><td>{{ row.after }}</td></tr></tbody>
            </table>
          </div>
          <details class="simulation-group">
            <summary>Answer and constraint outcomes</summary>
            <p>Percentages use all interviews in each run, including interviews where a question was not shown. “Constraint not met” counts interviews where the simulator could not satisfy a constraint after its attempts.</p>
            <div class="simulation-comparison-table">
<table class="table">
              <caption>Answers and unmet constraints by version</caption>
              <thead><tr><th scope="col">Question path</th><th scope="col">Baseline answered</th><th scope="col">Comparison answered</th><th scope="col">Baseline constraint not met</th><th scope="col">Comparison constraint not met</th></tr></thead>
              <tbody><tr v-for="row of comparisonRows" :key="row.path"><th scope="row"><code>{{ row.path }}</code></th><td>{{ row.beforeAnswered }}</td><td>{{ row.afterAnswered }}</td><td>{{ row.beforeConstraint }}</td><td>{{ row.afterConstraint }}</td></tr></tbody>
            </table>
</div>
          </details>
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
const versions = ref([]); const versionsLoading = ref(false); const selectedTarget = ref('current'); const selectedBaseline = ref('');
let generation = 0;
watch(() => [props.projectId, props.xmlFormId, props.target, props.definitionKey, props.publishedHash], () => {
  generation += 1; report.value = null; baseline.value = null; error.value = ''; versions.value = []; compare.value = false; selectedTarget.value = 'current'; selectedBaseline.value = '';
});

const clearComparison = () => { report.value = null; baseline.value = null; error.value = ''; };
const versionLabel = version => `Published version ${version.version || '(no version string)'}${version.publishedAt ? ` · ${version.publishedAt.slice(0, 10)}` : ''}`;
const toggleComparison = async () => {
  clearComparison(); selectedTarget.value = 'current'; selectedBaseline.value = '';
  if (!compare.value) return;
  const current = generation; versionsLoading.value = true;
  try {
    const { data } = await request({ method: 'GET', url: apiPaths.formVersions(props.projectId, props.xmlFormId), alert: false });
    if (current !== generation) return;
    if (!Array.isArray(data) || data.some(version => typeof version.version !== 'string' || typeof version.hash !== 'string')) throw new Error('The published versions could not be verified. Refresh and try again.');
    versions.value = data.filter(version => version.publishedAt != null);
    if (!versions.value.length) throw new Error('No published versions are available for comparison.');
    selectedBaseline.value = props.target === 'published' && versions.value.length > 1 ? 'version:1' : 'version:0';
  } catch (e) {
    if (current === generation) { compare.value = false; versions.value = []; error.value = e.response?.data?.message || e.message || 'Published versions could not be loaded.'; }
  } finally { versionsLoading.value = false; }
};
const selection = (key) => {
  if (key === 'current') return { path: props.target === 'draft' ? `${apiPaths.form(props.projectId, props.xmlFormId)}/draft/simulation` : `${apiPaths.form(props.projectId, props.xmlFormId)}/simulation`, hash: props.definitionKey, draft: props.target === 'draft' };
  const match = /^version:(\d+)$/.exec(key); const version = match ? versions.value[Number(match[1])] : null;
  if (!version) throw new Error('Choose an available published version.');
  return { path: apiPaths.formVersionDef(props.projectId, props.xmlFormId, version.version, '/simulation'), hash: version.hash, version: version.version, draft: false };
};

const run = async () => {
  if (running.value) return;
  const current = generation; const comparing = compare.value && props.publishedHash != null;
  const params = new URLSearchParams({ runs: String(runs.value) });
  if (seed.value !== '') params.set('seed', seed.value);
  running.value = true; report.value = null; baseline.value = null; error.value = '';
  try {
    const selected = selection(comparing ? selectedTarget.value : 'current');
    const chosenBaseline = comparing ? selection(selectedBaseline.value) : null;
    const { data } = await request({ method: 'GET', url: `${selected.path}?${params}`, alert: false });
    if (current !== generation) return;
    if ((selected.hash && data.hash !== selected.hash) || data.draft !== selected.draft || (selected.version != null && data.formVersion !== selected.version)) throw new Error('The form changed while simulating. Refresh the page and try again.');
    let previous = null;
    if (comparing) {
      params.set('seed', data.seed);
      previous = (await request({ method: 'GET', url: `${chosenBaseline.path}?${params}`, alert: false })).data;
      if (current !== generation) return;
      if (previous.hash !== chosenBaseline.hash || previous.formVersion !== chosenBaseline.version || previous.draft || previous.seed !== data.seed || previous.simulatedToday !== data.simulatedToday || previous.simulatorVersion !== data.simulatorVersion) throw new Error('The form or simulation date changed. Refresh the page and try again.');
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
  const show = (q, count, field) => (!q ? 'Not in version' : q[field] == null ? 'Not reported' : `${((100 * q[field]) / count).toFixed(1)}% (${q[field]}/${count})`);
  return [...new Set([...before.keys(), ...after.keys()])].sort().map(path => ({
    path, before: show(before.get(path), baseline.value.runs, 'shown'), after: show(after.get(path), report.value.runs, 'shown'),
    beforeAnswered: show(before.get(path), baseline.value.runs, 'answered'), afterAnswered: show(after.get(path), report.value.runs, 'answered'),
    beforeConstraint: show(before.get(path), baseline.value.runs, 'constraintNeverMet'), afterConstraint: show(after.get(path), report.value.runs, 'constraintNeverMet')
  }));
});
const downloadComparison = () => {
  if (!baseline.value || !report.value) return;
  const contents = {
    method: 'survey-simulation-comparison@1', baseline: baseline.value, comparison: report.value,
    limitations: 'Independent simulated interviews; matching question paths do not establish equivalent meaning. Unsupported expressions and reduced run counts are included in each report.'
  };
  const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(contents, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = objectUrl; link.download = 'survey-simulation-comparison.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
};
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
