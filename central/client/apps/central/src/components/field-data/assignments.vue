<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

This file is part of Field Data, a distribution of ODK Central. It is subject to
the license terms in the LICENSE file found in the top-level directory of this
distribution and at https://www.apache.org/licenses/LICENSE-2.0.

Assignments: dispatch board - who is visiting which case, by when.
-->
<template>
  <div id="fd-assignments">
    <header class="fd-head">
      <div>
        <h1>{{ $t('title') }}</h1>
        <p>{{ $t('subtitle') }}</p>
      </div>
    </header>

    <form class="fd-assign-create" @submit.prevent="create">
      <select v-model="draft.caseId" class="form-control" required>
        <option value="" disabled>{{ $t('field.case') }}</option>
        <option v-for="c of caseOptions" :key="c.id" :value="c.id">{{ c.name }}{{ c.district ? ` - ${c.district}` : '' }}</option>
      </select>
      <select v-model="draft.actorId" class="form-control" required>
        <option value="" disabled>{{ $t('field.enumerator') }}</option>
        <option v-for="m of enumerators" :key="m.submitterId" :value="m.submitterId">{{ m.name }}</option>
      </select>
      <input v-model="draft.dueDate" type="date" class="form-control">
      <input v-model.trim="draft.note" type="text" class="form-control note" :placeholder="$t('field.note')">
      <button type="submit" class="fd-btn-primary" :aria-disabled="awaitingResponse || !draft.caseId || !draft.actorId">{{ $t('action.assign') }}</button>
    </form>

    <loading :state="board.initiallyLoading"/>

    <template v-if="board.dataExists">
      <div class="fd-chips">
        <span class="chip blue"><b>{{ board.data.counts.open }}</b> {{ $t('chip.open') }}</span>
        <span class="chip red"><b>{{ board.data.counts.overdue }}</b> {{ $t('chip.overdue') }}</span>
        <span class="chip green"><b>{{ board.data.counts.done }}</b> {{ $t('chip.done') }}</span>
      </div>

      <div class="fd-panel">
        <table class="fd-table">
          <thead><tr>
            <th>{{ $t('th.enumerator') }}</th>
            <th>{{ $t('th.case') }}</th>
            <th>{{ $t('th.district') }}</th>
            <th>{{ $t('th.due') }}</th>
            <th>{{ $t('th.note') }}</th>
            <th>{{ $t('th.status') }}</th>
            <th class="a">{{ $t('th.actions') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="a of board.data.assignments" :key="a.id">
              <td class="name">{{ a.enumerator || `#${a.actorId}` }}</td>
              <td>
                <router-link v-if="a.caseId" :to="`/field-data/cases/${a.caseId}`" class="caselink">{{ a.caseName }}</router-link>
                <span v-else class="muted">-</span>
              </td>
              <td class="muted">{{ a.caseDistrict || '-' }}</td>
              <td :class="{ overdue: isOverdue(a) }">{{ a.dueDate ? a.dueDate.slice(0, 10) : '-' }}</td>
              <td class="muted note-cell">{{ a.note || '-' }}</td>
              <td><span class="fd-pill" :class="`as-${a.status}`">{{ $t(`astatus.${a.status}`) }}</span></td>
              <td class="a">
                <template v-if="a.status === 'assigned'">
                  <button type="button" class="rbtn ok" :aria-disabled="awaitingResponse" @click="setStatus(a, 'done')">{{ $t('action.done') }}</button>
                  <button type="button" class="rbtn no" :aria-disabled="awaitingResponse" @click="setStatus(a, 'cancelled')">{{ $t('action.cancel') }}</button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="board.data.assignments.length === 0" class="fd-empty">{{ $t('empty') }}</p>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, inject, reactive } from 'vue';
import { useI18n } from 'vue-i18n';

import Loading from '../loading.vue';

import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';
import { useRequestData } from '../../request-data';

defineOptions({ name: 'FieldDataAssignments' });

const { t } = useI18n();
const alert = inject('alert');
const { request, awaitingResponse } = useRequest();
const { createResource } = useRequestData();
const board = createResource('fieldDataAssignmentsBoard');
const team = createResource('fieldDataTeamForBoard');
const caseList = createResource('fieldDataCasesForBoard');

const load = () => board.request({ url: apiPaths.fieldDataAssignments(), clear: false }).catch(noop);
load();
team.request({ url: apiPaths.fieldDataTeam() }).catch(noop);
caseList.request({ url: apiPaths.fieldDataCases() }).catch(noop);

const enumerators = computed(() => (team.dataExists ? team.data.members.filter(m => m.submitterId != null) : []));
const caseOptions = computed(() => (caseList.dataExists ? caseList.data.cases.filter(c => c.status === 'active') : []));

const draft = reactive({ caseId: '', actorId: '', dueDate: '', note: '' });
const create = () => {
  request({ method: 'POST', url: apiPaths.fieldDataAssignments(), data: { caseId: draft.caseId, actorId: draft.actorId, dueDate: draft.dueDate || null, note: draft.note || null } })
    .then(() => { alert.success(t('alert.created')); draft.caseId = ''; draft.actorId = ''; draft.dueDate = ''; draft.note = ''; load(); })
    .catch(noop);
};
const setStatus = (a, status) => {
  request({ method: 'PATCH', url: apiPaths.fieldDataAssignment(a.id), data: { status } })
    .then(() => { load(); })
    .catch(noop);
};
const isOverdue = (a) => a.status === 'assigned' && a.dueDate && a.dueDate.slice(0, 10) < new Date().toISOString().slice(0, 10);
</script>

<i18n lang="json5">
{
  "en": {
    "title": "Assignments",
    "subtitle": "Dispatch field visits: who goes to which case, by when.",
    "field": { "case": "Case...", "enumerator": "Enumerator...", "note": "Instruction (optional)" },
    "action": { "assign": "Assign", "done": "Done", "cancel": "Cancel" },
    "chip": { "open": "open", "overdue": "overdue", "done": "completed" },
    "th": { "enumerator": "Enumerator", "case": "Case", "district": "District", "due": "Due", "note": "Instruction", "status": "Status", "actions": "Actions" },
    "astatus": { "assigned": "Assigned", "in_progress": "In progress", "done": "Done", "cancelled": "Cancelled" },
    "alert": { "created": "Assignment created." },
    "empty": "No assignments yet. Pick a case and an enumerator above to dispatch the first visit."
  }
}
</i18n>

<style lang="scss">
@import '../../assets/scss/variables';

#fd-assignments {
  --b: #e4ebed; --muted: #667a80;
  .fd-head { margin-bottom: 16px;
    h1 { font-size: 24px; font-weight: 750; letter-spacing: -0.01em; margin: 0 0 4px; color: #143039; }
    p { margin: 0; color: var(--muted); font-size: 14px; } }

  .fd-assign-create { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px;
    .form-control { width: auto; flex: 1 1 160px; border-radius: 9px; height: 38px; font-size: 13.5px; }
    .note { flex: 2 1 200px; } }
  .fd-btn-primary { border: none; background: #0E7490; color: #fff; font: inherit; font-weight: 600; font-size: 13.5px; padding: 9px 20px; border-radius: 9px; cursor: pointer; &:hover { background: #0A5A72; } }

  .fd-chips { display: flex; gap: 10px; margin-bottom: 14px;
    .chip { border-radius: 20px; padding: 5px 14px; font-size: 13px; font-weight: 600;
      &.blue { background: #e3f0f6; color: #155a86; }
      &.red { background: #fdecea; color: #b3210c; }
      &.green { background: #e2f3ea; color: #1f6e45; } } }

  .fd-panel { background: #fff; border: 1px solid var(--b); border-radius: 14px; box-shadow: 0 1px 2px rgba(18,48,58,0.04); overflow-x: auto; }
  .fd-table { width: 100%; border-collapse: collapse;
    th { text-align: left; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); padding: 12px 16px; border-bottom: 1px solid var(--b); white-space: nowrap; &.a { text-align: right; } }
    td { padding: 12px 16px; border-bottom: 1px solid #f1f5f6; font-size: 14px; vertical-align: middle; &.a { text-align: right; white-space: nowrap; } }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #f7fbfc; }
    .name { font-weight: 600; color: #143039; }
    .muted { color: var(--muted); }
    .note-cell { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .overdue { color: #b3210c; font-weight: 700; }
    .caselink { color: #0E7490; font-weight: 600; &:hover { text-decoration: underline; } } }

  .fd-pill { display: inline-block; padding: 3px 11px; border-radius: 20px; font-size: 12px; font-weight: 600;
    &.as-assigned { background: #e3f0f6; color: #155a86; }
    &.as-in_progress { background: #fdf3e0; color: #9c6209; }
    &.as-done { background: #e2f3ea; color: #1f6e45; }
    &.as-cancelled { background: #eef1f2; color: #566065; } }

  .rbtn { border: none; border-radius: 7px; font-size: 12.5px; font-weight: 600; padding: 5px 12px; cursor: pointer; margin-left: 6px;
    &.ok { background: #e2f3ea; color: #1f6e45; } &.no { background: #eef1f2; color: #566065; } }
  .fd-empty { padding: 34px; text-align: center; color: var(--muted); }
}
</style>
