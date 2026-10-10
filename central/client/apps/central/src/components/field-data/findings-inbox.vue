<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.

Project findings inbox (F3): integrity findings from every form in the project
the person may review, in one list. It links to each form's Verification page,
where the full evidence is shown and findings are resolved.
Contract: docs/field-intelligence/F3-findings-inbox.md -->
<template>
  <section class="findings-inbox" aria-label="Findings across the project">
    <h2>Findings across the project</h2>
    <p>Findings from the checks on every form in this project that you can review. Each is a question for a reviewer, not a conclusion. Open the form's Verification page to see the evidence and record a decision.</p>
    <button type="button" class="btn btn-default" :disabled="busy" @click="reload">Refresh findings</button>
    <p v-if="busy" role="status">Loading findings…</p>
    <div v-if="error" role="alert">
      <p>{{ error }}</p>
      <button type="button" class="btn btn-default" :disabled="busy" @click="reload">Retry</button>
    </div>

    <template v-if="summary">
      <p class="counts">
        <b>{{ summary.open }}</b> open ·
        <template v-for="(name, i) of FAMILIES" :key="name">
          {{ summary.byFamily[name] }} {{ FAMILY_NAMES[name].toLowerCase() }}<template v-if="i < FAMILIES.length - 1"> · </template>
        </template>
      </p>
      <details v-if="summary.byForm.length">
        <summary>Open findings by form</summary>
        <ul class="by-form">
          <li v-for="f of summary.byForm" :key="f.xmlFormId">{{ f.formName }} — {{ f.open }} open</li>
        </ul>
      </details>
    </template>

    <form class="filters" @submit.prevent="reload">
      <fieldset>
        <legend>Filter the findings</legend>
        <label>Form
          <select v-model="xmlFormId" class="form-control">
            <option value="">Any form</option>
            <option v-for="f of forms" :key="f.xmlFormId" :value="f.xmlFormId">{{ f.formName }}</option>
          </select>
        </label>
        <label>Check
          <select v-model="family" class="form-control">
            <option value="">Any check</option>
            <option v-for="name of FAMILIES" :key="name" :value="name">{{ FAMILY_NAMES[name] }}</option>
          </select>
        </label>
        <label>Show
          <select v-model="view" class="form-control">
            <option value="open">Not yet reviewed or being looked into</option>
            <option value="resolved">Reviewed</option>
            <option value="withdrawn">No longer found</option>
            <option value="all">Everything</option>
          </select>
        </label>
      </fieldset>
    </form>

    <p v-if="loaded && items.length === 0 && !busy && !error">No findings match these filters.</p>
    <ul class="findings-items">
      <li v-for="f of items" :key="f.id" :class="`outcome-${f.outcome}`">
        <div class="finding-head">
          <b>{{ label(f) }}</b>
          <span class="finding-form">{{ f.formName }}</span>
        </div>
        <p>
          {{ OUTCOMES[f.outcome] ?? f.outcome }} · {{ STATUSES[f.status] ?? f.status }}
          <template v-if="f.decision"> · {{ DECISIONS[f.decision] ?? f.decision }}</template>
          <template v-if="f.note"> — {{ f.note }}</template>
          · found {{ new Date(f.createdAt).toLocaleString() }}
        </p>
        <p class="finding-links">
          <router-link :to="verificationPath(f)">Open on the Verification page</router-link>
          <router-link :to="submissionPath(f, f.instanceId)">Submission</router-link>
          <router-link v-if="f.relatedInstanceId" :to="submissionPath(f, f.relatedInstanceId)">Related submission</router-link>
        </p>
      </li>
    </ul>
    <button v-if="nextCursor" type="button" class="btn btn-default" :disabled="busy" @click="more">Load more</button>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import useRequest from '../../composables/request';

defineOptions({ name: 'FieldDataFindingsInbox' });
const props = defineProps({ projectId: { type: String, required: true } });
const { request } = useRequest();
const root = `/v1/projects/${encodeURIComponent(props.projectId)}/findings`;

const FAMILIES = ['travel', 'location', 'contradiction', 'identity'];
const FAMILY_NAMES = { travel: 'Travel', location: 'Location', contradiction: 'Contradictions', identity: 'Identity' };
const RULE_NAMES = {
  'implausible-travel': 'Travel between submissions',
  'location-accuracy': 'Location accuracy',
  'outside-project-area': 'Outside the project area',
  'repeated-location': 'Repeated location'
};
const OUTCOMES = { concern: 'Worth a look', inconclusive: 'Could not tell', withdrawn: 'No longer found' };
const STATUSES = { open: 'Not yet reviewed', investigating: 'Being looked into', resolved: 'Reviewed' };
const DECISIONS = { explained: 'Explained', 'data-error': 'Data error, corrected', unresolved: 'Still unresolved', substantiated: 'Substantiated through review' };
const VIEWS = {
  open: { status: ['open', 'investigating'], outcome: ['concern', 'inconclusive'] },
  resolved: { status: ['resolved'], outcome: ['concern', 'inconclusive', 'withdrawn'] },
  withdrawn: { status: ['open', 'investigating', 'resolved'], outcome: ['withdrawn'] },
  all: { status: ['open', 'investigating', 'resolved'], outcome: ['concern', 'inconclusive', 'withdrawn'] }
};

const label = (f) => {
  if (f.family === 'contradiction') return `Contradiction: ${f.title ?? ''}`;
  if (f.family === 'identity') return `${f.kind === 'inconsistent' ? 'Changed details' : 'Repeated identity'}: ${f.title ?? ''}`;
  return RULE_NAMES[f.rule] ?? f.rule;
};
const formPath = (f) => `/projects/${props.projectId}/forms/${encodeURIComponent(f.xmlFormId)}`;
const verificationPath = (f) => `${formPath(f)}/verification`;
const submissionPath = (f, instanceId) => `${formPath(f)}/submissions/${encodeURIComponent(instanceId)}`;

const busy = ref(false); const error = ref(''); const loaded = ref(false);
const summary = ref(null); const items = ref([]); const nextCursor = ref(null);
const xmlFormId = ref(''); const family = ref(''); const view = ref('open');
const forms = computed(() => summary.value?.byForm ?? []);

// Only the newest request may change what is shown.
let latest = 0;
let alive = true;
onBeforeUnmount(() => { alive = false; });

const query = (cursor) => {
  const params = new URLSearchParams();
  for (const s of VIEWS[view.value].status) params.append('status', s);
  for (const o of VIEWS[view.value].outcome) params.append('outcome', o);
  if (xmlFormId.value) params.set('xmlFormId', xmlFormId.value);
  if (family.value) params.set('family', family.value);
  if (cursor) params.set('cursor', cursor);
  return `?${params.toString()}`;
};
const load = async (cursor = null) => {
  latest += 1;
  const mine = latest;
  busy.value = true; error.value = '';
  try {
    const [list, counts] = await Promise.all([
      request({ method: 'GET', url: `${root}${query(cursor)}`, alert: false }),
      cursor ? Promise.resolve(null) : request({ method: 'GET', url: `${root}/summary`, alert: false })
    ]);
    if (!alive || mine !== latest) return;
    if (!Array.isArray(list.data?.items) || (counts != null && counts.data?.byFamily == null)) throw new Error('Unexpected response');
    items.value = cursor ? [...items.value, ...list.data.items] : list.data.items;
    nextCursor.value = list.data.nextCursor;
    if (counts != null) summary.value = counts.data;
    loaded.value = true;
  } catch {
    if (alive && mine === latest) error.value = 'The findings could not be loaded. Check your connection and try again.';
  } finally {
    if (alive && mine === latest) busy.value = false;
  }
};
const reload = () => load();
const more = () => load(nextCursor.value);
watch([xmlFormId, family, view], reload);
load();
</script>

<style scoped>
.findings-inbox { margin-top: 24px; overflow-wrap: anywhere; }
label { display: block; margin: 12px 0; }
fieldset { min-width: 0; }
.findings-items { padding-left: 0; list-style: none; }
.findings-items li { margin: 12px 0; padding: 0 0 12px 10px; border-bottom: 1px solid #ddd; border-left: 3px solid #e9e9f1; }
.findings-items li.outcome-concern { border-left-color: #f29e00; }
.finding-head { display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; }
.finding-form { color: #666; font-size: 12px; }
.finding-links { display: flex; flex-wrap: wrap; gap: 12px; }
</style>
