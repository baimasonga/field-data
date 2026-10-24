<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.

Random backcheck sample (O3): a seeded, reproducible share of every collector's
Submissions, routed into review with the reason "backcheck-sample"; and its
schedule (O6), drawn by the operations runner when each period ends.
Contracts: docs/field-intelligence/O3-backcheck-sample.md,
docs/field-intelligence/O6-scheduled-backcheck-samples.md -->
<template>
  <section class="backcheck-sample" aria-labelledby="backcheck-sample-title">
    <h2 id="backcheck-sample-title">Random backcheck sample</h2>
    <p v-if="samples == null && !loadError" role="status">Loading sampling…</p>
    <div v-if="loadError" role="alert">Sampling could not be loaded. <button type="button" class="btn btn-link" :disabled="busy" @click="load">Retry</button></div>
    <template v-if="samples != null">
    <p class="section-lead">
      Chooses a share of every collector's Submissions by chance, so work that raised no finding is still revisited.
      Each chosen Submission goes to the review queue with the reason "backcheck-sample", where a reviewer asks
      another App User, never the original collector, to revisit it. Being chosen says nothing about the collector.
    </p>

    <form v-if="canDraw" class="backcheck-sample-form" @submit.prevent="drawSample">
      <label>Group submissions
        <select v-model="groupMode" class="form-control" @change="groupRates = []; groupBreaks = []; loadGroupFields()">
          <option value="collector">By collector</option>
          <option value="field">By collector and area or answer</option>
        </select>
      </label>
      <template v-if="groupMode === 'field'">
        <p v-if="fieldsLoading" role="status">Loading grouping questions…</p>
        <div v-if="fieldsError" role="alert">Grouping questions could not be loaded. <button type="button" class="btn btn-link" @click="loadGroupFields">Retry</button></div>
        <p v-if="!fieldsLoading && !fieldsError && fields.length === 0" role="status">No grouping questions are available. Use collector-only sampling for encrypted forms or forms without supported questions.</p>
        <label>Area or answer question
          <select v-model="groupField" class="form-control" required @change="groupRates = []; groupBreaks = []">
            <option value="" disabled>Choose a question</option>
            <option v-for="field of fields" :key="field.path" :value="field.path">{{ field.path }} ({{ field.type }})</option>
          </select>
        </label>
        <p class="backcheck-sample-hint">Uses exact answers within each collector; spaces at the beginning or end are ignored and capitalization stays distinct. Missing answers form a separate group. Choose a recorded area or categorical answer, not a personal identifier. Selected values are retained in the sample history (at most 100 groups, 200 characters per value). Repeat, multi-select, media and encrypted answers are unavailable.</p>
        <sampling-numeric-ranges v-if="numericQuestion(groupField)" v-model="groupBreaks" @update:model-value="groupRates = []"/>
        <sampling-group-rates v-model="groupRates" :choices="numericRangeLabels(groupBreaks)"/>
      </template>
      <label>{{ groupMode === 'field' ? 'Share of each collector and answer group (%)' : "Share of each collector's Submissions (%)" }}
        <input v-model.number="settings.rate" type="number" min="1" max="100" step="1" required class="form-control">
      </label>
      <label>{{ groupMode === 'field' ? 'At least, per collector and answer group' : 'At least, per collector' }}
        <input v-model.number="settings.minPerCollector" type="number" min="0" max="20" step="1" required class="form-control">
      </label>
      <label>Received from (optional)
        <input v-model="settings.receivedFrom" type="date" class="form-control">
      </label>
      <label>Received to (optional)
        <input v-model="settings.receivedTo" type="date" class="form-control">
      </label>
      <button type="submit" class="btn btn-primary" :aria-disabled="busy">
        Draw sample <spinner :state="busy"/>
      </button>
      <p class="backcheck-sample-hint">Submissions already in an earlier sample of this Form are not chosen again.</p>
    </form>
    <p v-if="error" role="alert" class="backcheck-sample-error">{{ error }}</p>

    <div v-if="scheduleLoadError" role="alert">Schedule could not be loaded. <button type="button" class="btn btn-link" :disabled="busy" @click="loadSchedule">Retry</button></div>
    <section v-if="schedule !== undefined" class="backcheck-schedule" aria-labelledby="backcheck-schedule-title">
      <h3 id="backcheck-schedule-title">Schedule</h3>
      <p class="backcheck-schedule-lead">
        With a schedule on, a sample of the Submissions received in each day or week (UTC; weeks start on Monday)
        is drawn when that period ends, with the same rules. Turning it on starts from now: earlier Submissions are
        only sampled by drawing above. Choose collector-only sampling or a recorded area/answer question for the schedule below. A grouped schedule pauses if its question, permissions or grouping data become unavailable.
      </p>
      <p v-if="schedule != null" role="status" class="backcheck-schedule-status">
        <template v-if="schedule.enabled">
          On: {{ schedule.groupRates?.length ? 'default ' : '' }}{{ schedule.rate }}% per {{ schedule.groupField ? 'collector and answer group' : 'collector' }}, at least {{ schedule.minPerCollector }}, {{ schedule.frequency }}.
          Next sample after {{ formatDate(schedule.nextRunAt) }}.
        </template>
        <template v-else>Off.</template>
      </p>
      <p v-else class="backcheck-schedule-status">No schedule.</p>
      <p v-if="schedule?.groupField">Scheduled grouping question: {{ schedule.groupField }}. Group values are retained in each sample history; coverage is available through Show sample.</p>
      <p v-if="schedule?.groupBreaks?.length" class="backcheck-schedule-ranges">Scheduled ranges: {{ numericRangeLabels(schedule.groupBreaks).join('; ') }}; Missing answer. Only range membership is retained in sample history.</p>
      <p v-if="schedule?.groupRates?.length" class="backcheck-schedule-rates">Saved group rates: <span v-for="(rule, index) of schedule.groupRates" :key="index">{{ index ? '; ' : '' }}{{ rule.value === null ? 'Missing answer' : rule.value }}: {{ rule.rate }}%</span>. Other answers: {{ schedule.rate }}%.</p>
      <form v-if="canDraw" class="backcheck-sample-form backcheck-schedule-form" @submit.prevent="saveSchedule">
        <label>Schedule grouping
          <select v-model="scheduleGroupMode" class="form-control" @change="scheduleGroupRates = []; scheduleGroupBreaks = []; loadGroupFields()">
            <option value="collector">By collector</option>
            <option value="field">By collector and area or answer</option>
          </select>
        </label>
        <template v-if="scheduleGroupMode === 'field'">
          <p v-if="fieldsLoading" role="status">Loading grouping questions…</p>
          <div v-if="fieldsError" role="alert">Schedule grouping questions could not be loaded. <button type="button" class="btn btn-link" @click="loadGroupFields">Retry</button></div>
          <label>Scheduled area or answer question
            <select v-model="scheduleGroupField" class="form-control" :required="scheduleSettings.enabled" @change="scheduleGroupRates = []; scheduleGroupBreaks = []">
              <option value="" disabled>Choose an available question</option>
              <option v-for="field of fields" :key="field.path" :value="field.path">{{ field.path }} ({{ field.type }})</option>
            </select>
          </label>
          <p class="backcheck-sample-hint">The rate and minimum apply to each collector and answer group. Missing answers form a group. Choose a categorical question, not a personal identifier: its values are retained in sample history. Limits are 100 groups and 200 characters per value. Grouping changes apply to the next draw, including submissions already received in its period.</p>
          <p v-if="!fieldsLoading && !fieldsError && fields.length === 0" role="status">No grouping questions are available. Choose collector-only sampling or turn the schedule off.</p>
          <sampling-numeric-ranges v-if="numericQuestion(scheduleGroupField)" v-model="scheduleGroupBreaks" @update:model-value="scheduleGroupRates = []"/>
          <sampling-group-rates v-model="scheduleGroupRates" :choices="numericRangeLabels(scheduleGroupBreaks)"/>
        </template>
        <label>{{ scheduleGroupMode === 'field' ? 'Scheduled share of each collector and answer group (%)' : "Share of each collector's Submissions (%)" }}
          <input v-model.number="scheduleSettings.rate" type="number" min="1" max="100" step="1" required class="form-control">
        </label>
        <label>{{ scheduleGroupMode === 'field' ? 'Scheduled minimum per collector and answer group' : 'At least, per collector' }}
          <input v-model.number="scheduleSettings.minPerCollector" type="number" min="0" max="20" step="1" required class="form-control">
        </label>
        <label>Every
          <select v-model="scheduleSettings.frequency" class="form-control">
            <option value="daily">day</option>
            <option value="weekly">week</option>
          </select>
        </label>
        <label class="backcheck-schedule-on">
          <input v-model="scheduleSettings.enabled" type="checkbox"> On
        </label>
        <button type="submit" class="btn btn-default" :aria-disabled="busy">Save schedule</button>
      </form>
      <p v-if="scheduleError" role="alert" class="backcheck-sample-error">{{ scheduleError }}</p>
      <ul v-if="runs.length > 0" class="backcheck-schedule-runs">
        <li v-for="r of runs" :key="r.periodStart">
          {{ formatDate(r.periodStart) }} to {{ formatDate(r.periodEnd) }}<template v-if="r.periods > 1"> ({{ r.periods }} periods, caught up)</template>:
          <template v-if="r.outcome === 'drawn'">
            {{ r.sampled }} of {{ r.eligible }} chosen
            <button v-if="r.sampleId != null" type="button" class="btn btn-link" @click="showSample(r.sampleId)">Show sample</button>
          </template>
          <template v-else-if="r.outcome === 'nothing-eligible'">nothing received to sample</template>
          <template v-else>not drawn: {{ r.error }}</template>
        </li>
      </ul>
    </section>



    <p v-if="samples.length === 0" class="backcheck-sample-empty">No sample has been drawn for this Form.</p>
    <template v-else>
      <label v-if="samples.length > 1" class="backcheck-sample-pick">Sample
        <select v-model="selectedId" class="form-control" @change="loadSample">
          <option v-for="s of samples" :key="s.id" :value="s.id">
            {{ formatDate(s.drawnAt) }} · {{ s.sampled }} of {{ s.eligible }}{{ s.scheduled ? ' · scheduled' : '' }}
          </option>
        </select>
      </label>
      <div v-if="sample != null" class="backcheck-sample-detail">
        <p role="status" class="backcheck-sample-summary">
          Drawn {{ formatDate(sample.drawnAt) }}<template v-if="sample.scheduled"> on schedule</template><template v-else-if="sample.drawnBy"> by {{ sample.drawnBy.displayName }}</template>:
          {{ sample.sampled }} of {{ sample.eligible }} eligible Submissions
          ({{ sample.settings.groupRates?.length ? 'default ' : '' }}{{ sample.settings.rate }}% per {{ sample.settings.groupField ? `collector and answer group for ${sample.settings.groupField}` : 'collector' }}, at least {{ sample.settings.minPerCollector }}{{ receivedRange }}){{ sampledBeforeText }}.
          <template v-if="sample.alreadyDecided > 0">
            {{ sample.alreadyDecided }} already had a review decision and were not reopened.
          </template>
        </p>
        <p v-if="sample.settings.groupBreaks?.length" class="backcheck-sample-ranges">Recorded ranges: {{ numericRangeLabels(sample.settings.groupBreaks).join('; ') }}; Missing answer. Boundaries start the next range. The seed replays the recorded range membership.</p>
        <p v-if="sample.settings.groupRates?.length">Recorded group rates: <span v-for="(rule, index) of sample.settings.groupRates" :key="index">{{ index ? '; ' : '' }}{{ rule.value === null ? 'Missing answer' : rule.value }}: {{ rule.rate }}%</span>. Other answers: {{ sample.settings.rate }}%. Coverage shows each group's rate; the minimum and rounding apply within each collector. These counts are not weighted population estimates.</p>
        <div v-if="sample.settings.groupField" class="backcheck-group-coverage">
          <table class="table">
            <caption>Coverage by answer group · {{ sample.settings.groupField }}</caption>
            <thead><tr><th scope="col">Answer group</th><th scope="col">Rate</th><th scope="col">Eligible</th><th scope="col">Sampled</th><th scope="col">Backcheck requested</th><th scope="col">Backcheck linked</th></tr></thead>
            <tbody>
<tr v-for="group of sample.groups" :key="JSON.stringify(group.value)">
              <th scope="row">{{ group.value == null ? 'Missing answer' : group.value }}</th>
              <td>{{ group.rate ?? sample.settings.rate }}%</td><td>{{ group.eligible }}</td><td>{{ group.sampled }}</td><td>{{ group.requested }}</td><td>{{ group.linked }}</td>
            </tr>
</tbody>
          </table>
        </div>
        <table class="table backcheck-sample-coverage">
          <caption>Coverage by collector</caption>
          <thead>
            <tr><th scope="col">Collector</th><th scope="col">Eligible</th><th scope="col">Sampled</th><th scope="col">Backcheck requested</th><th scope="col">Backcheck linked</th></tr>
          </thead>
          <tbody>
            <tr v-for="c of sample.collectors" :key="c.submitterId ?? 'none'">
              <th scope="row">{{ c.displayName ?? 'Unknown' }}</th>
              <td>{{ c.eligible }}</td><td>{{ c.sampled }}</td><td>{{ c.requested }}</td><td>{{ c.linked }}</td>
            </tr>
          </tbody>
        </table>
        <details class="backcheck-sample-items">
          <summary>Chosen Submissions ({{ sample.items.length }})</summary>
          <ul>
            <li v-for="item of sample.items" :key="item.instanceId">
              <router-link :to="submissionPath(item.instanceId)">{{ item.instanceId }}</router-link>
              · {{ item.displayName ?? 'Unknown' }}<template v-if="sample.settings.groupField"> · Group: {{ item.groupValue == null ? 'Missing answer' : item.groupValue }}</template> ·
              <template v-if="item.routing === 'already-decided'">already decided, not reopened</template>
              <template v-else-if="item.backcheck">backcheck {{ item.backcheck }}</template>
              <template v-else>in the review queue, no backcheck yet</template>
            </li>
          </ul>
        </details>
        <p class="backcheck-sample-seed">
          Seed <code>{{ sample.seed }}</code>. Each Submission's place in the draw is
          SHA-256 of the seed, a colon and its instance ID, lowest first within each {{ sample.settings.groupField ? 'collector and answer group' : 'collector' }},
          so the draw can be checked from the seed and the list of eligible Submissions.
        </p>
      </div>
    </template>
    </template>
    <backcheck-allocation :project-id="projectId" :xml-form-id="xmlFormId" :can-configure="canDraw && canManage"/>
  </section>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';

import Spinner from '../spinner.vue';
import BackcheckAllocation from './backcheck-allocation.vue';
import SamplingGroupRates from './sampling-group-rates.vue';
import SamplingNumericRanges from './sampling-numeric-ranges.vue';
import numericRangeLabels from '../../util/sampling-ranges';
import useRequest from '../../composables/request';

defineOptions({ name: 'BackcheckSample' });
const props = defineProps({
  projectId: { type: String, required: true },
  xmlFormId: { type: String, required: true },
  canManage: Boolean,
  canDraw: Boolean
});
const emit = defineEmits(['drawn']);
const { request, awaitingResponse: busy } = useRequest();
const base = () => `/v1/projects/${props.projectId}/forms/${encodeURIComponent(props.xmlFormId)}/backcheck-samples`;

const loadError = ref(false);
const samples = ref(null); const sample = ref(null); const selectedId = ref(null); const error = ref('');
const groupBreaks = ref([]); const scheduleGroupBreaks = ref([]);
const groupRates = ref([]); const scheduleGroupRates = ref([]);
const scheduleGroupMode = ref('collector'); const scheduleGroupField = ref('');
const groupMode = ref('collector'); const groupField = ref(''); const fields = ref([]); const fieldsLoading = ref(false); const fieldsError = ref(false);
const numericQuestion = path => fields.value.some(field => field.path === path && ['int', 'decimal'].includes(field.type));
const loadGroupFields = () => {
  if ((groupMode.value !== 'field' && scheduleGroupMode.value !== 'field') || fieldsLoading.value) return Promise.resolve();
  fieldsLoading.value = true; fieldsError.value = false;
  return request({ method: 'GET', url: `${base()}/fields`, alert: false })
    .then(({ data }) => { if (!Array.isArray(data?.fields)) throw new Error(); fields.value = data.fields; if (!fields.value.some(field => field.path === groupField.value)) groupField.value = ''; if (!fields.value.some(field => field.path === scheduleGroupField.value)) scheduleGroupField.value = ''; })
    .catch(() => { fieldsError.value = true; })
    .finally(() => { fieldsLoading.value = false; });
};
const settings = reactive({ rate: 10, minPerCollector: 1, receivedFrom: '', receivedTo: '' });
const receivedRange = computed(() => {
  const value = sample.value?.settings;
  return value?.receivedFrom || value?.receivedTo ? `, received ${value.receivedFrom || '…'} to ${value.receivedTo || '…'}` : '';
});
const sampledBeforeText = computed(() => (sample.value?.sampledBefore > 0 ? `; ${sample.value.sampledBefore} skipped as sampled before` : ''));

// O6: the form's schedule (undefined until loaded or when it cannot be read).
const scheduleLoadError = ref(false);
const schedule = ref(undefined); const runs = ref([]); const scheduleError = ref('');
const scheduleSettings = reactive({ rate: 10, minPerCollector: 1, frequency: 'daily', enabled: true });
const scheduleUrl = () => `/v1/projects/${props.projectId}/forms/${encodeURIComponent(props.xmlFormId)}/backcheck-schedule`;
const showSchedule = (data) => {
  schedule.value = data?.schedule; runs.value = Array.isArray(data?.runs) ? data.runs : [];
  if (data.schedule != null) {
    const { rate, minPerCollector, frequency, enabled } = data.schedule;
    Object.assign(scheduleSettings, { rate, minPerCollector, frequency, enabled });
    scheduleGroupBreaks.value = [...(data.schedule.groupBreaks ?? [])];
    scheduleGroupRates.value = (data.schedule.groupRates ?? []).map(rule => ({ ...rule }));
    scheduleGroupMode.value = data.schedule.groupField ? 'field' : 'collector'; scheduleGroupField.value = data.schedule.groupField ?? '';
    if (props.canDraw && scheduleGroupMode.value === 'field') loadGroupFields();
  }
};
const loadSchedule = () => {
  scheduleLoadError.value = false; return request({ method: 'GET', url: scheduleUrl(), alert: false })
    .then(({ data }) => showSchedule(data))
    .catch(() => { schedule.value = undefined; scheduleLoadError.value = true; });
};
loadSchedule();
const saveSchedule = () => {
  if (busy.value) return Promise.resolve();
  scheduleError.value = '';
  if (scheduleSettings.enabled && scheduleGroupMode.value === 'field' && (!scheduleGroupField.value || fieldsError.value || fieldsLoading.value)) { scheduleError.value = 'Choose an available scheduled grouping question, or turn the schedule off.'; return Promise.resolve(); }
  return request({ method: 'PUT', url: scheduleUrl(), data: { ...scheduleSettings, ...(scheduleGroupMode.value === 'field' && scheduleGroupField.value ? { groupField: scheduleGroupField.value, ...(scheduleGroupBreaks.value.length ? { groupBreaks: scheduleGroupBreaks.value } : {}), ...(scheduleGroupRates.value.length ? { groupRates: scheduleGroupRates.value } : {}) } : {}) }, alert: false })
    .then(({ data }) => showSchedule(data))
    .catch((e) => { scheduleError.value = e.response?.data?.message || 'The schedule could not be saved.'; });
};

const loadSample = () => (selectedId.value == null ? Promise.resolve()
  : request({ method: 'GET', url: `${base()}/${selectedId.value}`, alert: false })
    .then(({ data }) => { sample.value = data; })
    .catch(() => { sample.value = null; }));
const load = () => {
  loadError.value = false; return request({ method: 'GET', url: base(), alert: false })
    .then(({ data }) => {
      if (!Array.isArray(data)) throw new Error();
      samples.value = data;
      if (samples.value != null && !samples.value.some((s) => s.id === selectedId.value))
        selectedId.value = samples.value[0]?.id ?? null;
      return loadSample();
    })
    .catch(() => { samples.value = null; loadError.value = true; });
};
load();

// One request ID per set of settings, so a retried draw is not drawn twice.
let requestId = null; let requestFor = null;
const drawSample = () => {
  if (busy.value) return Promise.resolve();
  error.value = '';
  if (groupMode.value === 'field' && (!groupField.value || fieldsError.value || fieldsLoading.value)) { error.value = 'Choose an available grouping question before drawing.'; return Promise.resolve(); }
  const data = {
    rate: settings.rate, minPerCollector: settings.minPerCollector,
    ...(groupMode.value === 'field' ? { groupField: groupField.value, ...(groupBreaks.value.length ? { groupBreaks: groupBreaks.value } : {}), ...(groupRates.value.length ? { groupRates: groupRates.value } : {}) } : {}),
    ...(settings.receivedFrom ? { receivedFrom: settings.receivedFrom } : {}),
    ...(settings.receivedTo ? { receivedTo: settings.receivedTo } : {})
  };
  const fingerprint = JSON.stringify(data);
  if (fingerprint !== requestFor) { requestFor = fingerprint; requestId = crypto.randomUUID(); }
  return request({ method: 'POST', url: base(), data: { requestId, ...data }, alert: false })
    .then(({ data: drawn }) => {
      requestId = null; requestFor = null;
      selectedId.value = drawn.id;
      emit('drawn');
      return load();
    })
    .catch((e) => { error.value = e.response?.data?.message || 'The sample could not be drawn. Check the question, group limits and permissions, then retry.'; });
};

const showSample = (id) => { selectedId.value = id; return loadSample(); };
const formatDate = (iso) => new Date(iso).toLocaleString();
const submissionPath = (instanceId) =>
  `/projects/${props.projectId}/forms/${encodeURIComponent(props.xmlFormId)}/submissions/${encodeURIComponent(instanceId)}`;
</script>

<style lang="scss">
@import '../../assets/scss/variables';

.backcheck-sample {
  margin: 0 0 34px;
  overflow-wrap: anywhere;
  .backcheck-sample-form {
    display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin-bottom: 12px;
    label { display: flex; flex-direction: column; font-weight: normal; max-width: 220px; }
  }
  .backcheck-sample-hint, .backcheck-sample-empty, .backcheck-sample-seed { color: $color-text-secondary; }
  .backcheck-sample-hint { flex-basis: 100%; margin: 0; }
  .backcheck-sample-error { color: $color-danger; }
  .backcheck-sample-pick { display: block; max-width: 360px; font-weight: normal; }
  .backcheck-sample-coverage { max-width: 720px; caption { color: inherit; font-weight: bold; } }
  .backcheck-group-coverage { overflow-x: auto; caption { color: inherit; font-weight: bold; } }
  .backcheck-sample-items ul { margin: 6px 0 0; padding-left: 18px; }
  .backcheck-sample-seed code { overflow-wrap: anywhere; }
  .backcheck-schedule { margin: 12px 0 20px; }
  .backcheck-schedule h3 { font-size: 16px; }
  .backcheck-schedule-lead { color: $color-text-secondary; }
  .backcheck-schedule-form .backcheck-schedule-on { flex-direction: row; gap: 6px; align-items: center; }
  .backcheck-schedule-runs { padding-left: 18px; .btn-link { padding: 0; } }
}
</style>
