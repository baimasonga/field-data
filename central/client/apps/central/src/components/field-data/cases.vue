<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

This file is part of Field Data, a distribution of ODK Central. It is subject to
the license terms in the LICENSE file found in the top-level directory of this
distribution and at https://www.apache.org/licenses/LICENSE-2.0.

Cases: registered beneficiaries/sites tracked across visits.
-->
<template>
  <div id="fd-cases">
    <header class="fd-head">
      <div>
        <h1>{{ $t('title') }}</h1>
        <p>{{ $t('subtitle') }}</p>
      </div>
      <button type="button" class="fd-btn-primary" @click="creating = !creating">
        {{ creating ? $t('action.cancel') : $t('action.new') }}
      </button>
    </header>

    <form v-if="creating" class="fd-create" @submit.prevent="create">
      <label class="fd-control-label">{{ $t('field.name') }}<input v-model.trim="draft.name" type="text" class="form-control" :placeholder="$t('field.name')" required></label>
      <label class="fd-control-label">{{ $t('th.type') }}<select v-model="draft.type" class="form-control">
        <option value="household">{{ $t('type.household') }}</option>
        <option value="facility">{{ $t('type.facility') }}</option>
        <option value="school">{{ $t('type.school') }}</option>
        <option value="other">{{ $t('type.other') }}</option>
      </select></label>
      <label class="fd-control-label">{{ $t('field.district') }}<select v-model="draft.district" class="form-control">
        <option value="">{{ $t('field.district') }}</option>
        <option v-for="d of DISTRICTS" :key="d" :value="d">{{ d }}</option>
      </select></label>
      <button type="submit" class="fd-btn-primary" :aria-disabled="awaitingResponse">{{ $t('action.create') }}</button>
    </form>

    <loading :state="cases.initiallyLoading"/>

    <template v-if="cases.dataExists">
      <div class="fd-case-stats">
        <div class="s"><div class="n">{{ cases.data.counts.total }}</div><div class="l">{{ $t('stat.total') }}</div></div>
        <div class="s"><div class="n">{{ cases.data.counts.active }}</div><div class="l">{{ $t('stat.active') }}</div></div>
        <div class="s"><div class="n">{{ cases.data.counts.closed }}</div><div class="l">{{ $t('stat.closed') }}</div></div>
      </div>

      <div class="fd-panel">
        <div class="fd-table-scroll" role="region" aria-label="Scrollable data table" tabindex="0">
<table class="fd-table">
          <thead>
<tr>
            <th>{{ $t('th.name') }}</th>
            <th>{{ $t('th.type') }}</th>
            <th>{{ $t('th.district') }}</th>
            <th class="r">{{ $t('th.visits') }}</th>
            <th class="r">{{ $t('th.lastVisit') }}</th>
            <th class="r">{{ $t('th.open') }}</th>
            <th>{{ $t('th.status') }}</th>
          </tr>
</thead>
          <tbody>
            <tr v-for="c of cases.data.cases" :key="c.id" class="rowlink" @click="openCase(c)">
              <td class="name">{{ c.name }}</td>
              <td class="muted">{{ $t(`type.${c.type}`) }}</td>
              <td>{{ c.district || '-' }}</td>
              <td class="r"><b>{{ c.visits }}</b></td>
              <td class="r muted"><date-time v-if="c.lastVisit" :iso="c.lastVisit" relative="past"/><span v-else>-</span></td>
              <td class="r"><span v-if="c.openAssignments > 0" class="open-chip">{{ c.openAssignments }}</span><span v-else class="muted">0</span></td>
              <td><span class="fd-pill" :class="c.status">{{ $t(`status.${c.status}`) }}</span></td>
            </tr>
          </tbody>
        </table>
</div>
        <p v-if="cases.data.cases.length === 0" class="fd-empty">{{ $t('empty') }}</p>
      </div>
    </template>
  </div>
</template>

<script setup>
import { inject, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import DateTime from '../date-time.vue';
import Loading from '../loading.vue';

import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';
import { useRequestData } from '../../request-data';

defineOptions({ name: 'FieldDataCases' });

const { t } = useI18n();
const alert = inject('alert');
const router = useRouter();
const { request, awaitingResponse } = useRequest();
const { createResource } = useRequestData();
const cases = createResource('fieldDataCases');

const DISTRICTS = ['Bo', 'Bombali', 'Bonthe', 'Falaba', 'Kailahun', 'Kambia', 'Karene',
  'Kenema', 'Koinadugu', 'Kono', 'Moyamba', 'Port Loko', 'Pujehun', 'Tonkolili',
  'Western Area Rural', 'Western Area Urban'];

const load = () => cases.request({ url: apiPaths.fieldDataCases(), clear: false }).catch(noop);
load();

const creating = ref(false);
const draft = reactive({ name: '', type: 'household', district: '' });
const create = () => {
  request({ method: 'POST', url: apiPaths.fieldDataCases(), data: { ...draft, district: draft.district || null } })
    .then(() => {
      alert.success(t('alert.created', { name: draft.name }));
      draft.name = ''; creating.value = false;
      load();
    })
    .catch(noop);
};

const openCase = (c) => { router.push(`/field-data/cases/${c.id}`); };
</script>

<i18n lang="json5">
{
  "en": {
    "title": "Cases",
    "subtitle": "Beneficiaries and sites you track across visits - households, facilities, schools.",
    "action": { "new": "New case", "cancel": "Cancel", "create": "Create case" },
    "field": { "name": "Case name (e.g. Kamara household, Bo Govt. Hospital)", "district": "District..." },
    "type": { "household": "Household", "facility": "Facility", "school": "School", "other": "Other" },
    "stat": { "total": "Total cases", "active": "Active", "closed": "Closed" },
    "th": { "name": "Case", "type": "Type", "district": "District", "visits": "Visits", "lastVisit": "Last visit", "open": "Open assignments", "status": "Status" },
    "status": { "active": "Active", "closed": "Closed" },
    "alert": { "created": "\"{name}\" has been registered." },
    "empty": "No cases yet. Register your first household, facility, or school to start tracking visits."
  }
}
</i18n>

<style lang="scss">
@import '../../assets/scss/variables';

#fd-cases {
  --b: #e4ebed; --muted: #667a80;
  .fd-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 18px;
    h1 { font-size: 24px; font-weight: 750; letter-spacing: -0.01em; margin: 0 0 4px; color: #143039; }
    p { margin: 0; color: var(--muted); font-size: 14px; } }
  .fd-btn-primary {
    border: none; background: #0E7490; color: #fff; font: inherit; font-weight: 600; font-size: 13.5px;
    padding: 9px 18px; border-radius: 9px; cursor: pointer; box-shadow: 0 4px 12px rgba(14,116,144,0.22);
    &:hover { background: #0A5A72; } }

  .fd-create { display: flex; gap: 10px; margin-bottom: 18px; flex-wrap: wrap;
    .form-control { width: auto; flex: 1 1 200px; border-radius: 9px; height: 38px; }
    input.form-control { flex: 2 1 320px; } }

  .fd-case-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px;
    .s { background: #fff; border: 1px solid var(--b); border-radius: 12px; padding: 14px 18px;
      .n { font-size: 25px; font-weight: 750; color: #143039; } .l { font-size: 12.5px; color: var(--muted); margin-top: 4px; } } }

  .fd-panel { background: #fff; border: 1px solid var(--b); border-radius: 14px; box-shadow: 0 1px 2px rgba(18,48,58,0.04); overflow-x: auto; }
  .fd-table { width: 100%; border-collapse: collapse;
    th { text-align: left; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); padding: 12px 16px; border-bottom: 1px solid var(--b); white-space: nowrap; &.r { text-align: right; } }
    td { padding: 12px 16px; border-bottom: 1px solid #f1f5f6; font-size: 14px; &.r { text-align: right; font-variant-numeric: tabular-nums; } }
    tr:last-child td { border-bottom: none; }
    .rowlink { cursor: pointer; &:hover td { background: #f7fbfc; } }
    .name { font-weight: 600; color: #143039; }
    .muted { color: var(--muted); } }

  .open-chip { display: inline-block; min-width: 22px; text-align: center; background: #fdf3e0; color: #9c6209; border-radius: 12px; font-size: 12px; font-weight: 700; padding: 2px 8px; }
  .fd-pill { display: inline-block; padding: 3px 11px; border-radius: 20px; font-size: 12px; font-weight: 600;
    &.active { background: #e2f3ea; color: #1f6e45; }
    &.closed { background: #eef1f2; color: #566065; } }
  .fd-empty { padding: 34px; text-align: center; color: var(--muted); }
}
</style>
