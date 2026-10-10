<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.

Investigation records (F6): findings looked into together, an append-only
history and a disposition. A record for people; it changes nothing else.
Contract: docs/field-intelligence/F6-investigations.md -->
<template>
  <section class="investigations" aria-labelledby="investigations-title">
    <h2 id="investigations-title">Investigations</h2>
    <p class="section-lead">
      A record of findings looked into together: what was learned and how it ended. Opening or closing an investigation
      changes no Submission, finding or review case, and it is not a verdict on anyone: many patterns have a benign
      explanation, and the disposition can say so. Only project managers see investigations.
    </p>
    <p v-if="error" role="alert" class="investigations-error">{{ error }}</p>

    <form v-if="draft != null" class="investigations-new" @submit.prevent="create">
      <h3>New investigation</h3>
      <label>Title
        <input v-model="draft.title" type="text" maxlength="200" required class="form-control">
      </label>
      <p>{{ draft.findingIds.length }} {{ draft.findingIds.length === 1 ? 'finding' : 'findings' }} to include.</p>
      <button type="submit" class="btn btn-primary" :aria-disabled="busy">Open investigation <spinner :state="busy"/></button>
      <button type="button" class="btn btn-link" @click="draft = null">Cancel</button>
    </form>

    <p v-if="list != null && list.length === 0" class="investigations-empty">
      No investigation has been opened in this project. Open one from a group of collectors above.
    </p>
    <ul v-else-if="list != null" class="investigations-list">
      <li v-for="item of list" :key="item.id">
        <button type="button" class="btn btn-link" :aria-current="current?.id === item.id" @click="open(item.id)">{{ item.title }}</button>
        · {{ item.status === 'open' ? 'Open' : `Closed: ${DISPOSITIONS[item.disposition]}` }} · {{ item.findings }} findings
      </li>
    </ul>

    <article v-if="current != null" class="investigation" :aria-label="current.title">
      <h3>{{ current.title }}</h3>
      <p class="investigation-status">
        {{ current.status === 'open' ? 'Open' : `Closed: ${DISPOSITIONS[current.disposition]}` }} · opened by {{ current.openedByName ?? 'unknown' }}
      </p>
      <h4>Findings</h4>
      <ul class="investigation-findings">
        <li v-for="f of current.findings" :key="f.id">
          {{ f.title ?? f.rule }} ·
          <router-link :to="submissionPath(f.xmlFormId, f.instanceId)">{{ f.instanceId }}</router-link>
          <template v-if="f.relatedInstanceId != null">
            and <router-link :to="submissionPath(f.xmlFormId, f.relatedInstanceId)">{{ f.relatedInstanceId }}</router-link>
          </template>
          · {{ f.outcome }}
        </li>
      </ul>
      <p v-if="current.hiddenFindings > 0" class="investigation-hidden">{{ current.hiddenFindings }} more on Forms you may not read.</p>

      <h4>History</h4>
      <ol class="investigation-history">
        <li v-for="e of current.events" :key="e.id">
          <strong>{{ EVENTS[e.kind] }}</strong>
          <template v-if="e.disposition != null">: {{ DISPOSITIONS[e.disposition] }}</template>
          <template v-if="e.findingIds != null && e.findingIds.length > 0"> ({{ e.findingIds.length }} findings)</template>
          · {{ e.actorName ?? 'unknown' }} · {{ e.createdAt.slice(0, 16).replace('T', ' ') }}
          <span v-if="e.note != null" class="investigation-note">{{ e.note }}</span>
        </li>
      </ol>

      <form class="investigation-form" @submit.prevent="addNote">
        <label>Note
          <textarea v-model="note" maxlength="4000" required class="form-control"></textarea>
        </label>
        <button type="submit" class="btn btn-default" :aria-disabled="busy">Add note</button>
      </form>
      <form v-if="current.status === 'open'" class="investigation-form" @submit.prevent="close">
        <label>Disposition
          <select v-model="disposition" required class="form-control">
            <option v-for="(label, key) of DISPOSITIONS" :key="key" :value="key">{{ label }}</option>
          </select>
        </label>
        <label>Conclusion
          <textarea v-model="conclusion" maxlength="4000" required class="form-control"></textarea>
        </label>
        <button type="submit" class="btn btn-primary" :aria-disabled="busy">Close investigation</button>
      </form>
      <form v-else class="investigation-form" @submit.prevent="reopen">
        <label>Reason to reopen
          <textarea v-model="reason" maxlength="4000" required class="form-control"></textarea>
        </label>
        <button type="submit" class="btn btn-default" :aria-disabled="busy">Reopen</button>
      </form>
    </article>
  </section>
</template>

<script setup>
import { ref, watch } from 'vue';

import Spinner from '../spinner.vue';
import useRequest from '../../composables/request';

defineOptions({ name: 'FieldDataInvestigations' });
const props = defineProps({
  projectId: { type: [String, Number], required: true },
  // { title, findingIds, at } from a collector group.
  prefill: { type: Object, default: null }
});
const { request, awaitingResponse: busy } = useRequest();

const DISPOSITIONS = {
  'confirmed-issue': 'Confirmed issue', 'data-error': 'Data error', 'benign-pattern': 'Benign pattern',
  'insufficient-evidence': 'Insufficient evidence', 'policy-exception': 'Policy exception', duplicate: 'Duplicate of another investigation'
};
const EVENTS = { opened: 'Opened', 'findings-added': 'Findings added', note: 'Note', closed: 'Closed', reopened: 'Reopened' };
const list = ref(null); const current = ref(null); const draft = ref(null); const error = ref('');
const note = ref(''); const disposition = ref('benign-pattern'); const conclusion = ref(''); const reason = ref('');
const base = () => `/v1/projects/${props.projectId}/investigations`;
const failed = (what) => (e) => {
  error.value = e?.response?.status === 412 ? 'The investigation was changed by someone else; it has been reloaded.'
    : e?.response?.status === 409 ? 'The investigation is no longer in that state; it has been reloaded.'
      : `${what} could not be saved. Try again.`;
  if (current.value != null && [409, 412].includes(e?.response?.status)) open(current.value.id); // eslint-disable-line no-use-before-define
};

const load = () => request({ method: 'GET', url: base(), alert: false })
  .then(({ data }) => { if (!Array.isArray(data)) throw new Error('Unexpected response'); list.value = data; })
  .catch(() => { error.value = 'Investigations could not be loaded. Try again.'; });
const open = (id) => request({ method: 'GET', url: `${base()}/${id}`, alert: false })
  .then(({ data }) => { current.value = data; })
  .catch(() => { error.value = 'The investigation could not be loaded. Try again.'; });
load();

watch(() => props.prefill, (prefill) => {
  if (prefill == null) return;
  // The request ID is kept until the investigation is created, so a retry cannot open two.
  draft.value = { requestId: crypto.randomUUID(), title: prefill.title, findingIds: [...prefill.findingIds] };
}, { immediate: true });

const create = () => {
  error.value = '';
  const { requestId, title, findingIds } = draft.value;
  return request({ method: 'POST', url: base(), data: { requestId, title, findingIds }, alert: false })
    .then(({ data }) => { draft.value = null; current.value = data; return load(); })
    .catch(failed('The investigation'));
};
const write = (path, data, what, reset) => {
  error.value = '';
  const headers = path === 'notes' ? {} : { 'If-Match': `"investigation-${current.value.revision}"` };
  return request({ method: 'POST', url: `${base()}/${current.value.id}/${path}`, data, headers, alert: false })
    .then(({ data: updated }) => { current.value = updated; reset(); return load(); })
    .catch(failed(what));
};
const addNote = () => write('notes', { note: note.value }, 'The note', () => { note.value = ''; });
const close = () => write('close', { disposition: disposition.value, conclusion: conclusion.value }, 'The closure', () => { conclusion.value = ''; });
const reopen = () => write('reopen', { reason: reason.value }, 'The reopening', () => { reason.value = ''; });

const formPath = (xmlFormId) => `/projects/${props.projectId}/forms/${encodeURIComponent(xmlFormId)}`;
const submissionPath = (xmlFormId, instanceId) => `${formPath(xmlFormId)}/submissions/${encodeURIComponent(instanceId)}`;
</script>

<style lang="scss">
@import '../../assets/scss/variables';

.investigations {
  margin: 24px 0;
  overflow-wrap: anywhere;
  .investigations-error { color: $color-danger; }
  .investigations-empty, .investigation-status, .investigation-hidden { color: $color-text-secondary; }
  .investigations-list, .investigation-findings { padding-left: 18px; }
  .investigations-list .btn-link { padding: 0; }
  .investigations-new, .investigation-form { display: flex; flex-direction: column; gap: 6px; margin: 12px 0; max-width: 560px;
    label { display: flex; flex-direction: column; font-weight: normal; } }
  .investigation-history { padding-left: 18px; }
  .investigation-note { display: block; white-space: pre-wrap; }
}
</style>
