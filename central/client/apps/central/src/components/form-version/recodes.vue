<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.

Recode rules for exports (S4): how answers from earlier versions of this form
line up with the current one. Applied by the analysis workspace and exports; submissions are
never changed. Contract: docs/field-intelligence/S4-export-recodes.md -->
<template>
  <section id="form-version-recodes" class="panel panel-simple">
    <div class="panel-heading"><h1 class="panel-title">Recode rules for exports</h1></div>
    <div class="panel-body">
      <p class="recodes-intro">
        When a question's codes or place changed between versions, a rule makes exports that span versions use one set of codes.
        Rules can apply to the analysis table, charts and map, as well as analysis exports (CSV, Excel, SPSS, Stata), and are listed in each export's manifest.
        They do not change submissions, and standard CSV and OData downloads retain stored answers. Native CSV ZIP downloads offer opt-in value rules with a manifest; moved-question rules remain unsupported there.
      </p>
      <p v-if="error" role="alert" class="recodes-error">{{ error }}</p>
      <button v-if="error" type="button" class="btn btn-default" :disabled="busy" @click="load">Reload rules</button>
      <p v-if="data == null && !error" class="recodes-loading">Loading…</p>
      <template v-else-if="data != null">
        <p v-if="data.active.length === 0" class="recodes-none">No active rules.</p>
        <ul v-else class="recodes-list">
          <li v-for="rule of data.active" :key="rule.id" class="recodes-rule">
            <div class="recodes-head">
              <code>{{ rule.path }}</code>
              <span class="recodes-kind">{{ rule.kind === 'value' ? 'Codes' : 'Moved question' }} · {{ versionsLabel(rule.versions) }}</span>
            </div>
            <p v-if="rule.kind === 'value'" class="recodes-values">
              <span v-for="(to, from) in rule.values" :key="from" class="recodes-pair"><code>{{ from }}</code> → <code>{{ to }}</code></span>
            </p>
            <p v-else class="recodes-values">Answers read from <code>{{ rule.fromPath }}</code> when <code>{{ rule.path }}</code> is empty.</p>
            <p class="recodes-reason">{{ rule.reason }} · {{ rule.actorName ?? 'unknown' }} · {{ rule.createdAt.slice(0, 10) }}</p>
            <form v-if="allowed" class="recodes-retire" @submit.prevent="retire(rule)">
              <label>Reason to retire <input v-model="retireReasons[rule.id]" class="form-control" required maxlength="2000"></label>
              <button type="submit" class="btn btn-default" :disabled="busy">Retire</button>
            </form>
          </li>
        </ul>
        <details v-if="data.retired.length > 0" class="recodes-retired">
          <summary>Retired rules ({{ data.retired.length }})</summary>
          <ul class="recodes-list">
            <li v-for="rule of data.retired" :key="rule.id" class="recodes-rule">
              <code>{{ rule.path }}</code> · {{ versionsLabel(rule.versions) }} · retired by {{ rule.retiredByName ?? 'unknown' }}: {{ rule.retireReason }}
            </li>
          </ul>
        </details>

        <p v-if="earlier.length === 0" class="recodes-single">This form has one published version, so there is nothing to recode yet.</p>
        <details v-else-if="allowed" class="recodes-add" :open="addOpen ?? data.active.length === 0" @toggle="addOpen = $event.target.open">
          <summary>Add a rule</summary>
          <form @submit.prevent="add">
            <fieldset>
              <legend>Kind</legend>
              <label class="recodes-choice"><input v-model="form.kind" type="radio" value="value"> Codes changed: map old values to new ones</label>
              <label class="recodes-choice"><input v-model="form.kind" type="radio" value="path"> Question moved: read earlier answers from its old place</label>
            </fieldset>
            <label>Question in the current version
              <select v-model="form.path" class="form-control" required>
                <option value="">Choose a question</option>
                <option v-for="q of questions" :key="q.path" :value="q.path">{{ q.path }}</option>
              </select>
            </label>
            <fieldset>
              <legend>Earlier versions it applies to</legend>
              <label v-for="v of earlier" :key="v.version" class="recodes-choice">
                <input v-model="form.versions" type="checkbox" :value="v.version"> {{ v.version === '' ? '(no version string)' : v.version }}
              </label>
            </fieldset>
            <label v-if="form.kind === 'value'">Old value = new value, one per line
              <textarea v-model="form.values" class="form-control" rows="3" required placeholder="borehole = bh"></textarea>
            </label>
            <label v-else>Its path in those versions
              <input v-model="form.fromPath" class="form-control" required placeholder="/old_age">
            </label>
            <label>Reason <textarea v-model="form.reason" class="form-control" required maxlength="2000"></textarea></label>
            <button type="submit" class="btn btn-primary" :disabled="busy">Add rule</button>
          </form>
        </details>
      </template>
    </div>
  </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';

import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';

defineOptions({ name: 'FormVersionRecodes' });
const props = defineProps({
  projectId: { type: String, required: true },
  xmlFormId: { type: String, required: true },
  allowed: { type: Boolean, default: false }
});
const { request, awaitingResponse: busy } = useRequest();
const root = () => `${apiPaths.form(props.projectId, props.xmlFormId)}/recodes`;
const addOpen = ref(null); let loadGeneration = 0;
const data = ref(null); const fields = ref([]); const error = ref('');
const retireReasons = reactive({});
const blank = () => ({ kind: 'value', path: '', versions: [], values: '', fromPath: '', reason: '' });
const form = reactive(blank());

const message = (e, fallback) => e?.response?.data?.message ?? fallback;
const load = () => {
  loadGeneration += 1; const generation = loadGeneration;
  return Promise.all([
    request({ method: 'GET', url: root(), alert: false }),
    request({ method: 'GET', url: `${apiPaths.form(props.projectId, props.xmlFormId)}/fields?odata=false`, alert: false })
  ])
    .then(([rules, schema]) => {
      if (generation !== loadGeneration) return;
      if (!Array.isArray(rules.data?.active) || !Array.isArray(rules.data?.retired) || !Array.isArray(rules.data?.versions) || !Array.isArray(schema.data)) throw new Error('Invalid rule response');
      data.value = rules.data; fields.value = schema.data; error.value = '';
    })
    .catch((e) => { if (generation === loadGeneration) error.value = message(e, 'The recode rules could not be loaded.'); });
};
watch(() => [props.projectId, props.xmlFormId], () => {
  data.value = null; fields.value = []; error.value = ''; addOpen.value = null; Object.assign(form, blank());
  for (const id of Object.keys(retireReasons)) delete retireReasons[id];
  load();
}, { immediate: true });

const earlier = computed(() => (data.value?.versions ?? []).filter((v) => !v.current));
const repeats = computed(() => fields.value.filter((f) => f.type === 'repeat').map((f) => f.path));
const questions = computed(() => fields.value.filter((f) => !['structure', 'repeat'].includes(f.type) && !f.binary &&
  !f.path.startsWith('/meta/') &&
  (form.kind === 'value' || !repeats.value.some((r) => f.path.startsWith(`${r}/`)))));
const versionsLabel = (versions) => `version${versions.length === 1 ? '' : 's'} ${versions.map((v) => (v === '' ? '(none)' : v)).join(', ')}`;

const add = () => {
  if (busy.value) return Promise.resolve();
  const scope = root(); error.value = '';
  const body = { kind: form.kind, path: form.path, versions: [...form.versions], reason: form.reason };
  if (form.kind === 'value') {
    const values = {};
    for (const line of form.values.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const [from, to, ...rest] = line.split('=').map((s) => s.trim());
      if (!from || !to || rest.length > 0) { error.value = `Write each line as old = new: "${line}"`; return Promise.resolve(); }
      values[from] = to;
    }
    body.values = values;
  } else {
    body.fromPath = form.fromPath.trim();
  }
  return request({ method: 'POST', url: root(), data: body, alert: false })
    .then(() => { if (root() !== scope) return undefined; Object.assign(form, blank()); return load(); })
    .catch((e) => { if (root() === scope) error.value = message(e, 'The rule could not be saved.'); });
};
const retire = (rule) => {
  if (busy.value) return Promise.resolve();
  const scope = root(); error.value = '';
  return request({ method: 'POST', url: `${root()}/${rule.id}/retire`, data: { reason: retireReasons[rule.id] }, alert: false })
    .then(() => { if (root() !== scope) return undefined; delete retireReasons[rule.id]; return load(); })
    .catch((e) => { if (root() === scope) error.value = message(e, 'The rule could not be retired.'); });
};
</script>

<style lang="scss">
@import '../../assets/scss/variables';

#form-version-recodes {
  margin-top: 20px;
  overflow-wrap: anywhere;

  .recodes-intro, .recodes-reason, .recodes-kind, .recodes-single { color: $color-text-secondary; }
  .recodes-error { color: $color-danger; }
  .recodes-list { list-style: none; margin: 0; padding: 0; }
  .recodes-rule { border-left: 3px solid #e9e9f1; margin: 10px 0; padding-left: 10px; }
  .recodes-head { align-items: baseline; display: flex; flex-wrap: wrap; gap: 8px; }
  .recodes-values { margin: 4px 0; }
  .recodes-pair { display: inline-block; margin-right: 12px; }
  .recodes-reason { font-size: 12px; margin: 0 0 4px; }
  .recodes-retire { align-items: flex-end; display: flex; flex-wrap: wrap; gap: 8px; }
  .recodes-choice { display: block; font-weight: normal; margin: 2px 0; }
  .recodes-add, .recodes-retired { margin-top: 12px; summary { cursor: pointer; font-weight: bold; } }
  .recodes-add form > label, .recodes-add fieldset { display: block; margin: 8px 0; }
}
</style>
