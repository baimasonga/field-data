<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

This file is part of Field Data, a distribution of ODK Central. It is subject to
the license terms in the LICENSE file found in the top-level directory of this
distribution and at https://www.apache.org/licenses/LICENSE-2.0.

Case detail: identity, visit timeline (linked submissions), and assignments.
-->
<template>
  <div id="fd-case-detail">
    <loading :state="detail.initiallyLoading"/>
    <template v-if="detail.dataExists">
      <header class="fd-head">
        <div>
          <router-link to="/field-data/cases" class="fd-back">&lt;- {{ $t('back') }}</router-link>
          <h1>{{ detail.data.case.name }}</h1>
          <p class="meta">
            {{ $t(`type.${detail.data.case.type}`) }}
            <template v-if="detail.data.case.district"> · {{ detail.data.case.district }}</template>
            · <span class="fd-pill" :class="detail.data.case.status">{{ $t(`status.${detail.data.case.status}`) }}</span>
          </p>
        </div>
        <button type="button" class="fd-btn-secondary" :aria-disabled="awaitingResponse" @click="toggleStatus">
          {{ detail.data.case.status === 'active' ? $t('action.close') : $t('action.reopen') }}
        </button>
      </header>

      <div class="fd-detail-grid">
        <!-- Visit timeline -->
        <div class="fd-panel">
          <h2>{{ $t('timeline') }} <span class="count">{{ detail.data.timeline.length }}</span></h2>
          <ol v-if="detail.data.timeline.length > 0" class="fd-timeline">
            <li v-for="v of detail.data.timeline" :key="v.id">
              <span class="tdot" :class="dotClass(v.reviewState)"></span>
              <div class="tbody">
                <div class="trow1">
<b>{{ v.formName || v.form }}</b>
                  <span class="fd-pill sm" :class="pillClass(v.reviewState)">{{ statusLabel(v.reviewState) }}</span>
</div>
                <div class="trow2">{{ v.submitter || $t('unknown') }} · <date-time :iso="v.createdAt"/></div>
              </div>
            </li>
          </ol>
          <p v-else class="fd-empty">{{ $t('noVisits') }}</p>
        </div>

        <!-- Assignments -->
        <div class="fd-panel">
          <h2>{{ $t('assignments') }}</h2>
          <form class="fd-assign-form" @submit.prevent="assign">
            <label class="fd-control-label">{{ $t('field.enumerator') }}<select v-model="draft.actorId" class="form-control" required>
              <option value="" disabled>{{ $t('field.enumerator') }}</option>
              <option v-for="m of enumerators" :key="m.submitterId" :value="m.submitterId">{{ m.name }}</option>
            </select></label>
            <label class="fd-control-label">Due date<input v-model="draft.dueDate" type="date" class="form-control"></label>
            <label class="fd-control-label">{{ $t('field.note') }}<input v-model.trim="draft.note" type="text" class="form-control note" :placeholder="$t('field.note')"></label>
            <button type="submit" class="fd-btn-primary" :aria-disabled="awaitingResponse || !draft.actorId">{{ $t('action.assign') }}</button>
          </form>
          <ul v-if="detail.data.assignments.length > 0" class="fd-assign-list">
            <li v-for="a of detail.data.assignments" :key="a.id">
              <div class="abody">
                <b>{{ a.enumerator || `#${a.actorId}` }}</b>
                <span v-if="a.dueDate" class="due" :class="{ overdue: isOverdue(a) }">{{ $t('due') }} {{ a.dueDate.slice(0, 10) }}</span>
                <span class="fd-pill sm" :class="`as-${a.status}`">{{ $t(`astatus.${a.status}`) }}</span>
                <div v-if="a.note" class="anote">{{ a.note }}</div>
              </div>
              <div v-if="a.status === 'assigned'" class="aact">
                <button type="button" class="rbtn ok" :aria-disabled="awaitingResponse" @click="setAssignment(a, 'done')">{{ $t('action.done') }}</button>
                <button type="button" class="rbtn no" :aria-disabled="awaitingResponse" @click="setAssignment(a, 'cancelled')">{{ $t('action.cancel') }}</button>
              </div>
            </li>
          </ul>
          <p v-else class="fd-empty">{{ $t('noAssignments') }}</p>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, inject, reactive } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

import DateTime from '../date-time.vue';
import Loading from '../loading.vue';

import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';
import { useRequestData } from '../../request-data';

defineOptions({ name: 'FieldDataCaseDetail' });

const { t } = useI18n();
const alert = inject('alert');
const route = useRoute();
const { request, awaitingResponse } = useRequest();
const { createResource } = useRequestData();
const detail = createResource('fieldDataCaseDetail');
const team = createResource('fieldDataTeamForAssign');

const caseId = route.params.id;
const load = () => detail.request({ url: apiPaths.fieldDataCase(caseId), clear: false }).catch(noop);
load();
team.request({ url: apiPaths.fieldDataTeam() }).catch(noop);
const enumerators = computed(() => (team.dataExists ? team.data.members.filter(m => m.submitterId != null) : []));

const draft = reactive({ actorId: '', dueDate: '', note: '' });
const assign = () => {
  request({ method: 'POST', url: apiPaths.fieldDataAssignments(), data: { caseId: Number(caseId), actorId: draft.actorId, dueDate: draft.dueDate || null, note: draft.note || null } })
    .then(() => { alert.success(t('alert.assigned')); draft.actorId = ''; draft.dueDate = ''; draft.note = ''; load(); })
    .catch(noop);
};
const setAssignment = (a, status) => {
  request({ method: 'PATCH', url: apiPaths.fieldDataAssignment(a.id), data: { status } })
    .then(() => { load(); })
    .catch(noop);
};
const toggleStatus = () => {
  const status = detail.data.case.status === 'active' ? 'closed' : 'active';
  request({ method: 'PATCH', url: apiPaths.fieldDataCase(caseId), data: { status } })
    .then(() => { load(); })
    .catch(noop);
};

const isOverdue = (a) => a.dueDate && a.dueDate.slice(0, 10) < new Date().toISOString().slice(0, 10);
const statusLabel = (rs) => {
  if (rs === 'approved') return t('review.approved');
  if (rs === 'rejected') return t('review.rejected');
  return t('review.pending');
};
const pillClass = (rs) => (rs === 'approved' ? 'active' : (rs === 'rejected' ? 'rej' : 'pend'));
const dotClass = (rs) => (rs === 'approved' ? 'g' : (rs === 'rejected' ? 'r' : 'a'));
</script>

<i18n lang="json5">
{
  "en": {
    "back": "All cases",
    "timeline": "Visit history",
    "assignments": "Assignments",
    "type": { "household": "Household", "facility": "Facility", "school": "School", "other": "Other" },
    "status": { "active": "Active", "closed": "Closed" },
    "astatus": { "assigned": "Assigned", "in_progress": "In progress", "done": "Done", "cancelled": "Cancelled" },
    "review": { "approved": "Approved", "rejected": "Rejected", "pending": "Pending" },
    "field": { "enumerator": "Assign to...", "note": "Instruction (optional)" },
    "action": { "assign": "Assign visit", "done": "Done", "cancel": "Cancel", "close": "Close case", "reopen": "Reopen case" },
    "due": "due",
    "unknown": "(unknown)",
    "alert": { "assigned": "Visit assigned." },
    "noVisits": "No visits linked yet.",
    "noAssignments": "No assignments for this case."
  }
}
</i18n>

<style lang="scss">
@import '../../assets/scss/variables';

#fd-case-detail {
  --b: #e4ebed; --muted: #667a80;
  .fd-back { color: #0E7490; font-weight: 600; font-size: 13px; display: inline-block; margin-bottom: 6px; }
  .fd-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;
    h1 { font-size: 24px; font-weight: 750; margin: 0 0 6px; color: #143039; }
    .meta { color: var(--muted); font-size: 14px; margin: 0; } }
  .fd-btn-primary { border: none; background: #0E7490; color: #fff; font: inherit; font-weight: 600; font-size: 13.5px; padding: 9px 16px; border-radius: 9px; cursor: pointer; &:hover { background: #0A5A72; } }
  .fd-btn-secondary { border: 1px solid #d5e2e5; background: #fff; color: #33474d; font: inherit; font-weight: 600; font-size: 13.5px; padding: 9px 16px; border-radius: 9px; cursor: pointer; &:hover { border-color: #0E7490; color: #0E7490; } }

  .fd-detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px;
    @media (max-width: 1000px) { grid-template-columns: 1fr; } }
  .fd-panel { background: #fff; border: 1px solid var(--b); border-radius: 14px; padding: 18px 20px;
    h2 { font-size: 16px; font-weight: 700; margin: 0 0 14px; color: #143039;
      .count { color: #8fa1a7; font-weight: 600; font-size: 14px; margin-left: 6px; } } }

  .fd-timeline { list-style: none; margin: 0; padding: 0;
    li { display: flex; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f1f5f6; &:last-child { border-bottom: none; } }
    .tdot { width: 10px; height: 10px; border-radius: 50%; margin-top: 6px; flex-shrink: 0;
      &.g { background: #2E8B5A; } &.r { background: #de2a11; } &.a { background: #f29e00; } }
    .trow1 { font-size: 14px; display: flex; align-items: center; gap: 8px; b { color: #143039; } }
    .trow2 { font-size: 12.5px; color: var(--muted); margin-top: 2px; } }

  .fd-assign-form { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px;
    .form-control { width: auto; flex: 1 1 130px; border-radius: 8px; height: 36px; font-size: 13.5px; }
    .note { flex: 2 1 180px; } }

  .fd-assign-list { list-style: none; margin: 0; padding: 0;
    li { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; padding: 10px 0; border-bottom: 1px solid #f1f5f6; &:last-child { border-bottom: none; } }
    .abody { font-size: 13.5px; b { color: #143039; } }
    .due { margin-left: 8px; color: var(--muted); font-size: 12.5px; &.overdue { color: #b3210c; font-weight: 700; } }
    .anote { color: var(--muted); font-size: 12.5px; margin-top: 3px; } }

  .fd-pill { display: inline-block; padding: 3px 11px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-left: 8px;
    &.sm { padding: 2px 9px; font-size: 11.5px; }
    &.active { background: #e2f3ea; color: #1f6e45; }
    &.closed { background: #eef1f2; color: #566065; }
    &.rej { background: #fdecea; color: #b3210c; }
    &.pend { background: #fdf3e0; color: #9c6209; }
    &.as-assigned { background: #e3f0f6; color: #155a86; }
    &.as-in_progress { background: #fdf3e0; color: #9c6209; }
    &.as-done { background: #e2f3ea; color: #1f6e45; }
    &.as-cancelled { background: #eef1f2; color: #566065; } }

  .rbtn { border: none; border-radius: 7px; font-size: 12.5px; font-weight: 600; padding: 5px 12px; cursor: pointer; margin-left: 6px;
    &.ok { background: #e2f3ea; color: #1f6e45; } &.no { background: #eef1f2; color: #566065; } }
  .fd-empty { color: var(--muted); font-size: 13.5px; padding: 8px 0; }
}
</style>
