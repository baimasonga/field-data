<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.

Random backcheck sample (O3): a seeded, reproducible share of every collector's
Submissions, routed into review with the reason "backcheck-sample".
Contract: docs/field-intelligence/O3-backcheck-sample.md -->
<template>
  <section v-if="samples != null" class="backcheck-sample" aria-labelledby="backcheck-sample-title">
    <h2 id="backcheck-sample-title">Random backcheck sample</h2>
    <p class="section-lead">
      Chooses a share of every collector's Submissions by chance, so work that raised no finding is still revisited.
      Each chosen Submission goes to the review queue with the reason "backcheck-sample", where a reviewer asks
      another App User, never the original collector, to revisit it. Being chosen says nothing about the collector.
    </p>

    <form v-if="canDraw" class="backcheck-sample-form" @submit.prevent="drawSample">
      <label>Share of each collector's Submissions (%)
        <input v-model.number="settings.rate" type="number" min="1" max="100" step="1" required class="form-control">
      </label>
      <label>At least, per collector
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

    <p v-if="samples.length === 0" class="backcheck-sample-empty">No sample has been drawn for this Form.</p>
    <template v-else>
      <label v-if="samples.length > 1" class="backcheck-sample-pick">Sample
        <select v-model="selectedId" class="form-control" @change="loadSample">
          <option v-for="s of samples" :key="s.id" :value="s.id">
            {{ formatDate(s.drawnAt) }} · {{ s.sampled }} of {{ s.eligible }}
          </option>
        </select>
      </label>
      <div v-if="sample != null" class="backcheck-sample-detail">
        <p role="status" class="backcheck-sample-summary">
          Drawn {{ formatDate(sample.drawnAt) }}<template v-if="sample.drawnBy"> by {{ sample.drawnBy.displayName }}</template>:
          {{ sample.sampled }} of {{ sample.eligible }} eligible Submissions
          ({{ sample.settings.rate }}% per collector, at least {{ sample.settings.minPerCollector }}<template v-if="sample.settings.receivedFrom || sample.settings.receivedTo">,
          received {{ sample.settings.receivedFrom || '…' }} to {{ sample.settings.receivedTo || '…' }}</template>)<template v-if="sample.sampledBefore > 0">;
          {{ sample.sampledBefore }} skipped as sampled before</template>.
          <template v-if="sample.alreadyDecided > 0">
            {{ sample.alreadyDecided }} already had a review decision and were not reopened.
          </template>
        </p>
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
              · {{ item.displayName ?? 'Unknown' }} ·
              <template v-if="item.routing === 'already-decided'">already decided, not reopened</template>
              <template v-else-if="item.backcheck">backcheck {{ item.backcheck }}</template>
              <template v-else>in the review queue, no backcheck yet</template>
            </li>
          </ul>
        </details>
        <p class="backcheck-sample-seed">
          Seed <code>{{ sample.seed }}</code>. Each Submission's place in the draw is
          SHA-256 of the seed, a colon and its instance ID, lowest first within each collector,
          so the draw can be checked from the seed and the list of eligible Submissions.
        </p>
      </div>
    </template>
  </section>
</template>

<script setup>
import { reactive, ref } from 'vue';

import Spinner from '../spinner.vue';
import useRequest from '../../composables/request';

defineOptions({ name: 'BackcheckSample' });
const props = defineProps({
  projectId: { type: String, required: true },
  xmlFormId: { type: String, required: true },
  canDraw: Boolean
});
const emit = defineEmits(['drawn']);
const { request, awaitingResponse: busy } = useRequest();
const base = () => `/v1/projects/${props.projectId}/forms/${encodeURIComponent(props.xmlFormId)}/backcheck-samples`;

const samples = ref(null); const sample = ref(null); const selectedId = ref(null); const error = ref('');
const settings = reactive({ rate: 10, minPerCollector: 1, receivedFrom: '', receivedTo: '' });

const loadSample = () => (selectedId.value == null ? Promise.resolve()
  : request({ method: 'GET', url: `${base()}/${selectedId.value}`, alert: false })
    .then(({ data }) => { sample.value = data; })
    .catch(() => { sample.value = null; }));
const load = () => request({ method: 'GET', url: base(), alert: false })
  .then(({ data }) => {
    samples.value = Array.isArray(data) ? data : null;
    if (samples.value != null && !samples.value.some((s) => s.id === selectedId.value))
      selectedId.value = samples.value[0]?.id ?? null;
    return loadSample();
  })
  .catch(() => { samples.value = null; });
load();

// One request ID per set of settings, so a retried draw is not drawn twice.
let requestId = null; let requestFor = null;
const drawSample = () => {
  if (busy.value) return Promise.resolve();
  error.value = '';
  const data = {
    rate: settings.rate, minPerCollector: settings.minPerCollector,
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
    .catch((e) => { error.value = e.response?.data?.message || 'The sample could not be drawn.'; });
};

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
  .backcheck-sample-items ul { margin: 6px 0 0; padding-left: 18px; }
  .backcheck-sample-seed code { overflow-wrap: anywhere; }
}
</style>
