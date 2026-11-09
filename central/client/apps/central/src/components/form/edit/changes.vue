<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.

Version changes (S3): what the Draft changes from the published version, and
what each change does to the data, in words. It never blocks publishing.
Contract: docs/field-intelligence/S3-version-changes.md -->
<template>
  <form-edit-section id="form-edit-changes">
    <template #title>Changes from the published version</template>
    <template #subtitle>
      What this Draft changes in the data collected, compared with version
      “{{ report?.from?.version === '' ? '(no version string)' : (report?.from?.version ?? 'published') }}”. Changes that affect meaning may need a note or a recode when versions are analysed together.
    </template>
    <template #actions>
      <button v-if="!versionsLoaded" type="button" class="btn btn-default btn-sm" :disabled="versionsLoading" @click="loadVersions">Choose an earlier version</button>
      <label v-else>Compare with
        <select v-model="selectedBaseline" class="form-control input-sm" @change="changeBaseline">
          <option value="current">Current published version</option>
          <option v-for="(version, index) of versions" :key="index" :value="`version:${index}`">{{ versionLabel(version) }}</option>
        </select>
      </label>
      <button type="button" class="btn btn-default btn-sm" :disabled="loading" @click="load">
        Compare again <spinner :state="loading"/>
      </button>
    </template>
    <template #body>
      <p v-if="error" role="alert" class="changes-error">{{ error }}</p>
      <p v-if="versionsError" role="alert" class="changes-error">{{ versionsError }}</p>
      <template v-else-if="report != null">
        <p v-if="report.from == null" class="changes-none">There is no published version to compare with.</p>
        <template v-else>
          <p class="changes-summary" role="status">
            <span :class="report.summary.meaning > 0 ? 'changes-count-meaning' : ''">{{ plural(report.summary.meaning, 'change') }} to meaning</span> ·
            {{ report.summary.continuity }} added, removed or moved ·
            {{ report.summary.population }} to who is asked or what is accepted ·
            {{ report.summary.wording }} to wording
            <span class="changes-scope">({{ plural(report.summary.unchanged, 'question') }} unchanged)</span>
          </p>
          <p v-if="report.changes.length === 0" class="changes-clean">No changes to the data collected.</p>
          <p v-if="report.truncated" class="changes-truncated">Only the first {{ report.changes.length }} changes are listed.</p>

          <template v-for="group of groups" :key="group.effect">
            <details v-if="group.items.length > 0" class="changes-group" :class="`changes-${group.effect}`" :open="group.effect !== 'wording'">
              <summary>{{ group.title }} ({{ group.items.length }})</summary>
              <p class="changes-explain">{{ group.explain }}</p>
              <ul class="changes-list">
                <li v-for="(c, i) of group.items" :key="i" class="changes-item">
                  <div class="changes-head">
                    <code class="changes-path">{{ c.path }}</code>
                    <span class="changes-code">{{ CODE_NAMES[c.code] ?? c.code }}</span>
                  </div>
                  <p class="changes-detail">{{ describe(c) }}</p>
                </li>
              </ul>
            </details>
          </template>
        </template>
      </template>
    </template>
  </form-edit-section>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import FormEditSection from './section.vue';
import Spinner from '../../spinner.vue';

import useRequest from '../../../composables/request';
import { apiPaths } from '../../../util/request';

defineOptions({ name: 'FormEditChanges' });
const props = defineProps({
  projectId: { type: String, required: true },
  xmlFormId: { type: String, required: true },
  // Changes when the Draft changes, so the comparison is made again.
  definitionKey: { type: String, default: null },
  publishedHash: { type: String, default: null }
});
const emit = defineEmits(['report']);
const { request } = useRequest();

const CODE_NAMES = {
  added: 'Added',
  removed: 'Removed',
  moved: 'Moved',
  'type-changed': 'Data type changed',
  'choice-kind-changed': 'Single or multiple choice changed',
  'repeat-changed': 'Repeat changed',
  'calculation-changed': 'Calculation changed',
  'choice-relabelled': 'Choice relabelled',
  'relevant-changed': 'When it is asked changed',
  'constraint-changed': 'Constraint changed',
  'required-changed': 'Required changed',
  'readonly-changed': 'Read-only changed',
  'choices-added': 'Choices added',
  'choices-removed': 'Choices removed',
  'choice-source-changed': 'Choice source changed',
  'label-changed': 'Label changed'
};
const EFFECTS = [
  { effect: 'meaning', title: 'Meaning', explain: 'Answers in the same column may not mean the same thing in both versions.' },
  { effect: 'continuity', title: 'Added, removed or moved', explain: 'A column starts, stops or is renamed in exports.' },
  { effect: 'population', title: 'Who is asked or what is accepted', explain: 'The same question, asked of different people or accepting different answers.' },
  { effect: 'wording', title: 'Wording', explain: 'The question reads differently. Usually comparable, but worth noting.' }
];

const report = ref(null); const error = ref(''); const loading = ref(false);
const versions = ref([]); const versionsLoading = ref(false); const versionsLoaded = ref(false); const versionsError = ref(''); const selectedBaseline = ref('current');
let scope = 0; let displayRequest = 0; let defaultRequest = 0;
const versionLabel = version => `Published version ${version.version || '(no version string)'}${version.publishedAt ? ` · ${version.publishedAt.slice(0, 10)}` : ''}`;
const validReport = (data, expectedHash, expectedVersion) => data?.to?.draft === true && (!props.definitionKey || data.to.hash === props.definitionKey) &&
  data.from != null && (!expectedHash || data.from.hash === expectedHash) && (expectedVersion == null || data.from.version === expectedVersion);
const message = e => e.response?.data?.message || e.message || 'The versions could not be compared.';
const loadVersions = async () => {
  const current = scope; versionsLoading.value = true; versionsError.value = '';
  try {
    const { data } = await request({ method: 'GET', url: apiPaths.formVersions(props.projectId, props.xmlFormId), alert: false });
    if (current !== scope) return;
    if (!Array.isArray(data) || data.some(v => typeof v.version !== 'string' || typeof v.hash !== 'string')) throw new Error('Published versions could not be verified. Refresh and try again.');
    versions.value = data.filter(v => v.publishedAt != null); versionsLoaded.value = true;
  } catch (e) { if (current === scope) versionsError.value = message(e); } finally { if (current === scope) versionsLoading.value = false; }
};
const load = async () => {
  const current = scope; displayRequest += 1; const requestId = displayRequest; const selected = selectedBaseline.value;
  const isDefault = selected === 'current'; if (isDefault) defaultRequest += 1; const defaultId = isDefault ? defaultRequest : null;
  const version = isDefault ? null : versions.value[Number(selected.slice(8))];
  if (!isDefault && !version) { report.value = null; error.value = 'Choose an available published version.'; return; }
  const url = `${apiPaths.form(props.projectId, props.xmlFormId)}/draft/changes${isDefault ? '' : `?${new URLSearchParams({ from: version.version || '___' })}`}`;
  loading.value = true; report.value = null; error.value = '';
  if (isDefault) emit('report', null);
  try {
    const { data } = await request({ method: 'GET', url, alert: false });
    if (current !== scope) return;
    if (!validReport(data, isDefault ? props.publishedHash : version.hash, isDefault ? null : version.version)) throw new Error('The form or published version changed. Refresh and try again.');
    if (isDefault && defaultId === defaultRequest) emit('report', data);
    if (requestId === displayRequest) report.value = data;
  } catch (e) {
    if (current !== scope) return;
    if (isDefault && defaultId === defaultRequest) emit('report', null);
    if (requestId === displayRequest) error.value = message(e);
  } finally { if (current === scope && requestId === displayRequest) loading.value = false; }
};
const changeBaseline = () => { load(); };
watch(() => [props.projectId, props.xmlFormId, props.definitionKey, props.publishedHash], () => {
  scope += 1; displayRequest += 1; defaultRequest += 1; report.value = null; error.value = ''; versions.value = []; versionsLoaded.value = false; versionsLoading.value = false; versionsError.value = ''; selectedBaseline.value = 'current'; emit('report', null); load();
}, { immediate: true });
onBeforeUnmount(() => { scope += 1; });

const groups = computed(() => EFFECTS.map((e) => ({ ...e, items: report.value.changes.filter((c) => c.effect === e.effect) })));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const shown = (value) => (value == null || value === '' ? '(none)' : value);
const inLanguage = (language) => (language === '' ? '' : ` (${language})`);
const describe = (c) => {
  const d = c.detail;
  switch (c.code) {
    case 'added': case 'removed': return `${d.kind[0].toUpperCase()}${d.kind.slice(1)} ${c.code === 'added' ? 'in this version only' : 'no longer collected'}.`;
    case 'moved': return `Was ${d.from}; the export column is renamed.`;
    case 'repeat-changed': return `Was collected ${d.from == null ? 'once per submission' : `in ${d.from}`}; now ${d.to == null ? 'once per submission' : `in ${d.to}`}.`;
    case 'choices-added': case 'choices-removed': return d.values.join(', ');
    case 'choice-relabelled': return `Value “${d.value}”${inLanguage(d.language)}: “${d.from}” → “${d.to}”. The stored value is the same; what people saw is not.`;
    case 'label-changed': return `${d.language === '' ? 'Label' : d.language}: “${d.from}” → “${d.to}”`;
    default: return `${shown(d.from)} → ${shown(d.to)}${d.inherited ? ' (including the groups it is in)' : ''}`;
  }
};
</script>

<style lang="scss">
@import '../../../assets/scss/variables';

#form-edit-changes {
  overflow-wrap: anywhere;
  .form-edit-section-heading { flex-wrap: wrap; row-gap: 8px; }
  .form-edit-section-heading > div { min-width: 0; }
  .form-edit-section-actions { display: flex; flex-wrap: wrap; gap: 8px; max-width: 100%; }
  .form-edit-section-actions label { min-width: 0; max-width: 100%; }
  .form-edit-section-actions select { max-width: 100%; }

  .changes-summary { margin-bottom: 8px; }
  .changes-count-meaning { color: $color-warning; font-weight: bold; }
  .changes-scope, .changes-explain, .changes-code { color: $color-text-secondary; }
  .changes-clean { color: $color-success; }
  .changes-error { color: $color-danger; }
  .changes-group { margin: 8px 0; summary { cursor: pointer; font-weight: bold; } }
  .changes-explain { font-size: 12px; margin: 4px 0 0; }
  .changes-list { list-style: none; margin: 6px 0 0; padding: 0; }
  .changes-item { border-left: 3px solid #e9e9f1; margin: 8px 0; padding-left: 10px; }
  .changes-meaning .changes-item { border-left-color: $color-warning; }
  .changes-head { align-items: baseline; display: flex; flex-wrap: wrap; gap: 6px; }
  .changes-code { font-size: 12px; }
  .changes-detail { margin: 4px 0; white-space: pre-wrap; }
}
</style>
