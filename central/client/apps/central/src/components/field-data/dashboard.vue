<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

This file is part of Field Data, a distribution of ODK Central. It is subject to
the license terms in the LICENSE file found in the top-level directory of this
distribution and at https://www.apache.org/licenses/LICENSE-2.0.
-->
<template>
  <div id="field-data-dashboard">
    <loading :state="stats.initiallyLoading"/>
    <template v-if="stats.dataExists">
      <div class="kpi-row">
        <div class="kpi-card">
          <div class="kpi-value">{{ stats.data.kpi.projects }}</div>
          <div class="kpi-label">{{ $t('kpi.projects') }}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">{{ stats.data.kpi.forms }}</div>
          <div class="kpi-label">{{ $t('kpi.forms') }}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">{{ stats.data.kpi.submissions }}</div>
          <div class="kpi-label">{{ $t('kpi.submissions') }}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">{{ stats.data.kpi.users }}</div>
          <div class="kpi-label">{{ $t('kpi.users') }}</div>
        </div>
      </div>

      <div class="dashboard-columns">
        <div class="dashboard-col">
          <p class="page-body-heading">{{ $t('recentSubmissions') }}</p>
          <table class="table">
            <thead>
              <tr>
                <th>{{ $t('header.form') }}</th>
                <th>{{ $t('header.project') }}</th>
                <th>{{ $t('header.submitter') }}</th>
                <th>{{ $t('header.submitted') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s of stats.data.recentSubmissions" :key="s.id">
                <td>{{ s.formName || s.form }}</td>
                <td>{{ s.project }}</td>
                <td>{{ s.submitter || $t('unknownSubmitter') }}</td>
                <td><date-time :iso="s.createdAt"/></td>
              </tr>
            </tbody>
          </table>
          <p v-show="stats.data.recentSubmissions.length === 0" class="empty-table-message">
            {{ $t('noSubmissions') }}
          </p>
        </div>

        <div class="dashboard-col">
          <p class="page-body-heading">{{ $t('systemStatus') }}</p>
          <ul class="status-list">
            <li v-for="item of statusItems" :key="item.key">
              <span class="status-dot" :class="item.ok ? 'up' : 'down'"></span>
              {{ item.label }}
              <span class="status-text">{{ item.ok ? $t('status.up') : $t('status.down') }}</span>
            </li>
          </ul>

          <p class="page-body-heading top-forms-heading">{{ $t('topForms') }}</p>
          <table class="table">
            <thead>
              <tr>
                <th>{{ $t('header.form') }}</th>
                <th class="count-col">{{ $t('header.submissions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="f of stats.data.topForms" :key="f.form">
                <td>{{ f.name || f.form }}</td>
                <td class="count-col">{{ f.count }}</td>
              </tr>
            </tbody>
          </table>
          <p v-show="stats.data.topForms.length === 0" class="empty-table-message">
            {{ $t('noForms') }}
          </p>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import DateTime from '../date-time.vue';
import Loading from '../loading.vue';

import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';
import { useRequestData } from '../../request-data';

defineOptions({
  name: 'FieldDataDashboard'
});

const { t } = useI18n();
const { createResource } = useRequestData();
const stats = createResource('fieldDataStats');
stats.request({ url: apiPaths.fieldDataStats() }).catch(noop);

const statusItems = computed(() => {
  if (!stats.dataExists) return [];
  const s = stats.data.systemStatus;
  return [
    { key: 'database', label: t('status.database'), ok: s.database },
    { key: 'fileStorage', label: t('status.fileStorage'), ok: s.fileStorage },
    { key: 'enketo', label: t('status.enketo'), ok: s.enketo },
    { key: 'pyxform', label: t('status.pyxform'), ok: s.pyxform },
    { key: 'emailService', label: t('status.emailService'), ok: s.emailService }
  ];
});
</script>

<i18n lang="json5">
{
  "en": {
    "kpi": {
      "projects": "Projects",
      "forms": "Forms",
      "submissions": "Submissions",
      "users": "Users"
    },
    "recentSubmissions": "Recent Submissions",
    "systemStatus": "System Status",
    "topForms": "Top Forms",
    "header": {
      "form": "Form",
      "project": "Project",
      "submitter": "Submitter",
      "submitted": "Submitted",
      "submissions": "Submissions"
    },
    "status": {
      "up": "Online",
      "down": "Offline",
      "database": "Database",
      "fileStorage": "File Storage",
      "enketo": "Web Forms (Enketo)",
      "pyxform": "Form Conversion (pyxform)",
      "emailService": "Email Service"
    },
    "unknownSubmitter": "(unknown)",
    "noSubmissions": "There are no submissions yet.",
    "noForms": "There are no forms with submissions yet."
  }
}
</i18n>

<style lang="scss">
#field-data-dashboard {
  .kpi-row {
    display: flex;
    flex-wrap: wrap;
    gap: 15px;
    margin-bottom: 25px;
  }
  .kpi-card {
    flex: 1 1 160px;
    padding: 18px 20px;
    background-color: #f7f7f7;
    border: 1px solid #ddd;
    border-radius: 4px;
  }
  .kpi-value { font-size: 32px; font-weight: bold; line-height: 1.1; }
  .kpi-label { margin-top: 4px; color: #666; text-transform: uppercase; font-size: 12px; letter-spacing: 0.5px; }

  .dashboard-columns { display: flex; flex-wrap: wrap; gap: 30px; }
  .dashboard-col { flex: 1 1 320px; min-width: 0; }
  .top-forms-heading { margin-top: 25px; }
  .count-col { text-align: right; }

  .status-list { list-style: none; padding: 0; margin: 0 0 10px; }
  .status-list li { padding: 6px 0; border-bottom: 1px solid #eee; }
  .status-text { color: #666; margin-left: 6px; font-size: 12px; }
  .status-dot {
    display: inline-block; width: 10px; height: 10px; border-radius: 50%;
    margin-right: 8px; vertical-align: middle;
    &.up { background-color: #4caf50; }
    &.down { background-color: #ccc; }
  }
}
</style>
