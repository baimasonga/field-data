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

    <details v-if="outcomes != null && outcomes.status.open + outcomes.status.closed > 0" class="investigation-outcomes">
      <summary>How investigations ended</summary>
      <p class="outcomes-lead">
        Counts only. People choose which findings to investigate, so these numbers do not show how often a check is
        right, and a collector listed here is not shown to have done anything wrong: a benign disposition counts like any other.
      </p>
      <p class="outcomes-status">
        {{ outcomes.status.open }} open · {{ outcomes.status.closed }} closed · {{ outcomes.status.reopened }} ever reopened
        <template v-if="outcomes.timeToClose != null">
          · days to close: median {{ outcomes.timeToClose.median }}, longest {{ outcomes.timeToClose.longest }}
        </template>
      </p>
      <div v-if="outcomes.status.closed > 0" class="outcomes-tables">
        <table class="table outcomes-dispositions">
          <caption>Closed investigations by disposition</caption>
          <thead><tr><th>Disposition</th><th>Closed</th></tr></thead>
          <tbody>
            <tr v-for="(label, key) of DISPOSITIONS" :key="key"><td>{{ label }}</td><td>{{ outcomes.dispositions[key] }}</td></tr>
          </tbody>
        </table>
        <table v-for="t of outcomeTables" :key="t.key" class="table" :class="`outcomes-${t.key}`">
          <caption>{{ t.caption }}</caption>
          <thead>
            <tr><th>{{ t.label }}</th><th v-for="(label, key) of DISPOSITIONS" :key="key">{{ label }}</th><th v-if="t.total">Total</th></tr>
          </thead>
          <tbody>
            <tr v-for="row of t.rows" :key="t.rowKey(row)">
              <td>{{ t.name(row) }}</td>
              <td v-for="(label, key) of DISPOSITIONS" :key="key">{{ row[key] }}</td>
              <td v-if="t.total">{{ row.total }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="outcomes.collectorsOmitted > 0" class="outcomes-note">{{ outcomes.collectorsOmitted }} more collectors not listed.</p>
        <p v-if="outcomes.hiddenFindings > 0" class="outcomes-note">{{ outcomes.hiddenFindings }} findings on Forms you may not read are left out of the tables by kind and by collector.</p>
      </div>
    </details>

    <details v-if="workload != null" class="investigation-workload">
      <summary>Investigation workload</summary>
      <p>Open investigations, not a measure of performance. Overdue means due before today in UTC. Counts cover the whole project, independent of the filters below.</p>
      <p>{{ workload.total.open }} open · {{ workload.total.overdue }} overdue</p>
      <table class="table">
        <caption>Open investigations by assigned manager</caption>
        <thead><tr><th>Manager</th><th>Open</th><th>Overdue</th></tr></thead>
        <tbody>
          <tr v-for="person of workload.managers" :key="person.id"><td>{{ person.name }}</td><td>{{ person.open }}</td><td>{{ person.overdue }}</td></tr>
          <tr><td>Unassigned</td><td>{{ workload.unassigned.open }}</td><td>{{ workload.unassigned.overdue }}</td></tr>
          <tr><td>Manager no longer has access</td><td>{{ workload.unavailable.open }}</td><td>{{ workload.unavailable.overdue }}</td></tr>
        </tbody>
      </table>
      <p v-if="workload.omittedManagers">{{ workload.omittedManagers }} more managers are included in the total but not listed.</p>
    </details>
    <div class="investigations-filters" aria-label="Filter investigations">
      <label>Status <select v-model="statusFilter" class="form-control" @change="loadList"><option value="">All statuses</option><option value="open">Open</option><option value="closed">Closed</option></select></label>
      <label>Assigned to <select v-model="assigneeFilter" class="form-control" @change="loadList">
        <option value="">Anyone</option><option value="me">Me</option><option value="unassigned">Unassigned</option>
        <option v-for="person of assignees?.candidates ?? []" :key="person.id" :value="String(person.id)">{{ person.displayName }}</option>
      </select></label>
      <label class="investigations-overdue"><input v-model="overdueFilter" type="checkbox" @change="loadList"> Overdue only</label>
    </div>
    <p class="investigations-filter-help">Overdue means an open investigation whose due date is before today in UTC. Up to 200 matching investigations are shown.</p>
    <p v-if="list != null && list.length === 0" class="investigations-empty">
      {{ hasFilters ? 'No investigations match these filters.' : 'No investigation has been opened in this project. Open one from a group of collectors above.' }}
    </p>
    <ul v-else-if="list != null" class="investigations-list">
      <li v-for="item of list" :key="item.id">
        <button type="button" class="btn btn-link" :aria-current="current?.id === item.id" @click="open(item.id)">{{ item.title }}</button>
        · {{ item.status === 'open' ? 'Open' : `Closed: ${DISPOSITIONS[item.disposition]}` }} · {{ item.findings }} findings
        <template v-if="item.dueDate"> · Due {{ item.dueDate }}</template>
        <strong v-if="item.overdue"> · Overdue</strong>
      </li>
    </ul>

    <article v-if="current != null" class="investigation" :aria-label="current.title">
      <h3>{{ current.title }}</h3>
      <p class="investigation-status">
        {{ current.status === 'open' ? 'Open' : `Closed: ${DISPOSITIONS[current.disposition]}` }} · opened by {{ current.openedByName ?? 'unknown' }}
      </p>
      <h4>Assignment</h4>
      <p>Assigned to {{ current.assignedTo == null ? 'no one' : current.assigneeName ?? 'an unavailable manager' }} · Due {{ current.dueDate ?? 'not set' }}</p>
      <p v-if="current.assigneeAvailable === false">The assigned manager no longer has access. Choose another manager.</p>
      <form v-if="current.status === 'open'" class="investigation-form" @submit.prevent="saveAssignment">
        <label>Assigned manager
          <select v-model="assignedTo" class="form-control" :disabled="assignees == null">
            <option value="">Unassigned</option>
            <option v-for="person of assignees?.candidates ?? []" :key="person.id" :value="String(person.id)">{{ person.displayName }}</option>
          </select>
        </label>
        <p v-if="assignees?.truncated">Only the first 200 eligible managers are shown.</p>
        <label>Due date <input v-model="dueDate" type="date" class="form-control"></label>
        <label>Reason for assignment change <textarea v-model="assignmentReason" required maxlength="2000" class="form-control"></textarea></label>
        <button type="submit" class="btn btn-default" :disabled="busy || assignees == null">Save assignment</button>
      </form>
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

      <field-data-investigation-cases :project-id="projectId" :investigation-id="current.id" :revision="current.revision" @changed="refreshCaseLinks"/>

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
import { computed, ref, watch } from 'vue';

import Spinner from '../spinner.vue';
import FieldDataInvestigationCases from './investigation-cases.vue';
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
const FAMILIES = { travel: 'Travel', location: 'Location', contradiction: 'Contradiction', identity: 'Identity', similarity: 'Similar answers', other: 'Other' };
const outcomes = ref(null);
const list = ref(null); const current = ref(null); const draft = ref(null); const error = ref('');
const note = ref(''); const disposition = ref('benign-pattern'); const conclusion = ref(''); const reason = ref('');
const assignees = ref(null); const assignedTo = ref(''); const dueDate = ref(''); const assignmentReason = ref('');
const workload = ref(null);
const statusFilter = ref(''); const assigneeFilter = ref(''); const overdueFilter = ref(false);
const hasFilters = computed(() => Boolean(statusFilter.value || assigneeFilter.value || overdueFilter.value));
let listGeneration = 0;
const base = () => `/v1/projects/${props.projectId}/investigations`;
const failed = (what) => (e) => {
  error.value = e?.response?.status === 412 ? 'The investigation was changed by someone else; it has been reloaded.'
    : e?.response?.status === 409 ? 'The investigation is no longer in that state; it has been reloaded.'
      : `${what} could not be saved. Try again.`;
  if (current.value != null && [409, 412].includes(e?.response?.status)) open(current.value.id); // eslint-disable-line no-use-before-define
};

// F7: how investigations ended; loaded with the list and after each change.
const loadOutcomes = () => request({ method: 'GET', url: `${base()}/outcomes`, alert: false })
  .then(({ data }) => { outcomes.value = data; })
  .catch(() => { error.value = 'How investigations ended could not be loaded. Try again.'; });
const loadList = () => {
  listGeneration += 1;
  const generation = listGeneration;
  list.value = null;
  const query = new URLSearchParams();
  if (statusFilter.value) query.set('status', statusFilter.value);
  if (assigneeFilter.value) query.set('assignee', assigneeFilter.value);
  if (overdueFilter.value) query.set('overdue', 'true');
  const suffix = query.toString();
  return request({ method: 'GET', url: `${base()}${suffix ? `?${suffix}` : ''}`, alert: false })
    .then(({ data }) => { if (generation !== listGeneration) return; if (!Array.isArray(data)) throw new Error('Unexpected response'); list.value = data; })
    .catch(() => { if (generation === listGeneration) error.value = 'Investigations could not be loaded. Try again.'; });
};
const load = () => Promise.all([
  loadList(),
  loadOutcomes(),
  request({ method: 'GET', url: `${base()}/workload`, alert: false })
    .then(({ data }) => { workload.value = data; })
    .catch(() => { workload.value = null; error.value = 'Investigation workload could not be loaded. Try again.'; }),
  request({ method: 'GET', url: `${base()}/assignees`, alert: false })
    .then(({ data }) => { assignees.value = data; })
    .catch(() => { assignees.value = null; error.value = 'Eligible managers could not be loaded. Try again.'; })
]);
const outcomeTables = computed(() => [
  { key: 'months', caption: 'Closed by month of closing (UTC)', label: 'Month', rows: outcomes.value.months, rowKey: (r) => r.month, name: (r) => r.month, total: false },
  {
    key: 'families', caption: 'Findings in closed investigations, by kind of check (each finding once)', label: 'Kind', rows: outcomes.value.families,
    rowKey: (r) => r.family, name: (r) => FAMILIES[r.family] ?? r.family, total: true
  },
  {
    key: 'collectors', caption: 'Closed investigations involving each collector\'s Submissions', label: 'Collector', rows: outcomes.value.collectors,
    rowKey: (r) => r.actorId ?? 'unknown', name: (r) => (r.actorId == null ? 'Unknown' : r.displayName ?? `#${r.actorId}`), total: true
  }
]);
const open = (id) => request({ method: 'GET', url: `${base()}/${id}`, alert: false })
  .then(({ data }) => { current.value = data; assignedTo.value = data.assigneeAvailable === false ? '' : String(data.assignedTo ?? ''); dueDate.value = data.dueDate ?? ''; assignmentReason.value = ''; })
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
    .then(({ data }) => { draft.value = null; current.value = data; assignedTo.value = ''; dueDate.value = ''; assignmentReason.value = ''; return load(); })
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
const saveAssignment = () => write('assignment', { assignedTo: assignedTo.value === '' ? null : Number(assignedTo.value), dueDate: dueDate.value || null, reason: assignmentReason.value }, 'The assignment', () => { assignmentReason.value = ''; });

const refreshCaseLinks = () => { if (current.value) { open(current.value.id); load(); } };

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
  .investigations-filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; }
  .investigations-filters label { font-weight: normal; }
  .investigations-overdue { padding-bottom: 8px; }
  .investigations-filter-help { color: $color-text-secondary; }
  .investigation-workload { margin: 12px 0; overflow-x: auto; summary { cursor: pointer; font-weight: bold; } .table { width: auto; } }
  .investigations-new, .investigation-form { display: flex; flex-direction: column; gap: 6px; margin: 12px 0; max-width: 560px;
    label { display: flex; flex-direction: column; font-weight: normal; } }
  .investigation-history { padding-left: 18px; }
  .investigation-note { display: block; white-space: pre-wrap; }
  .investigation-outcomes { margin: 12px 0;
    summary { cursor: pointer; font-weight: bold; }
    .outcomes-lead, .outcomes-note { color: $color-text-secondary; }
    .outcomes-tables { overflow-x: auto; }
    .table { margin-bottom: 12px; width: auto; }
    caption { color: $color-text; font-weight: bold; }
    td + td, th + th { text-align: right; } }
}
</style>
