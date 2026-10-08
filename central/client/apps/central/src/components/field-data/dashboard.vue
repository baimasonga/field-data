<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

This file is part of Field Data, a distribution of ODK Central. It is subject to
the license terms in the LICENSE file found in the top-level directory of this
distribution and at https://www.apache.org/licenses/LICENSE-2.0.
-->
<template>
  <div id="field-data-dashboard">
    <header class="fd-dash-head">
      <h1>{{ $t('dashboard') }}</h1>
      <p>{{ greeting }}</p>
    </header>
    <loading :state="stats.initiallyLoading"/>
    <div v-if="loadFailed" role="alert" class="empty-msg">
      <p>{{ $t('loadFailed') }}</p>
      <button type="button" class="btn btn-primary" @click="fetchStats">{{ $t('retry') }}</button>
    </div>
    <template v-if="stats.dataExists">
      <!-- KPI cards -->
      <div class="kpi-row">
        <div v-for="c of kpiCards" :key="c.key" class="kpi-card">
          <div class="kpi-top">
            <span class="kpi-label">{{ c.label }}</span>
            <span class="kpi-icon" :class="`icon-${c.tone}`">
              <!-- Static icon paths defined below. -->
              <!-- eslint-disable vue/no-v-html -->
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" v-html="kpiIconPaths[c.icon]"/>
              <!-- eslint-enable vue/no-v-html -->
            </span>
          </div>
          <div class="kpi-value">{{ c.value.toLocaleString() }}</div>
        </div>
      </div>

      <!-- Row: submission trend + accessible projects -->
      <div class="panel-row">
        <div class="panel panel-2">
          <div class="panel-head">
            <h2>{{ $t('overview') }}</h2>
            <span class="panel-sub">{{ $t('last7days') }}</span>
          </div>
          <div class="chart-wrap"><canvas ref="trendCanvas" role="img" :aria-label="$t('overview')"></canvas></div>
          <p v-if="stats.data.submissionsTrend.length === 0" class="empty-msg">{{ $t('noRecentSubmissions') }}</p>
        </div>
        <div class="panel panel-1">
          <div class="panel-head"><h2>{{ $t('projects') }}</h2></div>
          <ul class="summary-list">
            <li v-for="project of stats.data.projects" :key="project.id">
              <router-link :to="`/projects/${project.id}`">{{ project.name }}</router-link>
            </li>
          </ul>
          <p v-if="stats.data.projects.length === 0" class="empty-msg">{{ $t('noProjects') }}</p>
        </div>
      </div>

      <!-- Row: recent submissions + top forms -->
      <div class="panel-row">
        <div class="panel panel-2">
          <div class="panel-head"><h2>{{ $t('recentSubmissions') }}</h2></div>
          <div class="fd-table-scroll" role="region" aria-label="Scrollable data table" tabindex="0">
<table class="fd-table">
            <thead>
              <tr>
                <th>{{ $t('header.id') }}</th>
                <th>{{ $t('header.form') }}</th>
                <th>{{ $t('header.submitter') }}</th>
                <th>{{ $t('header.submitted') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s of stats.data.recentSubmissions" :key="s.id">
                <td class="mono">#{{ s.id }}</td>
                <td>{{ s.formName || s.form }}</td>
                <td>{{ s.submitter || $t('unknownSubmitter') }}</td>
                <td><date-time :iso="s.createdAt"/></td>
              </tr>
            </tbody>
          </table>
</div>
          <p v-show="stats.data.recentSubmissions.length === 0" class="empty-msg">{{ $t('noSubmissions') }}</p>
        </div>

        <div class="panel panel-1">
          <div class="panel-head"><h2>{{ $t('topForms') }}</h2></div>
          <ul class="summary-list">
            <li v-for="form of stats.data.topForms" :key="form.form">
              <span class="legend-label">{{ form.name || form.form }}</span>
              <span class="legend-value">{{ form.count.toLocaleString() }}</span>
            </li>
          </ul>
          <p v-if="stats.data.topForms.length === 0" class="empty-msg">{{ $t('noSubmissions') }}</p>
        </div>
      </div>

      <!-- System status bar -->
      <div v-if="statusItems.length !== 0" class="status-bar">
        <div v-for="item of statusItems" :key="item.key" class="status-item">
          <span class="status-dot" :class="item.ok ? 'up' : 'down'"></span>
          <span class="status-name">{{ item.label }}</span>
          <span class="status-state">{{ item.ok ? $t('status.up') : $t('status.down') }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale,
  Filler, Tooltip, Legend
} from 'chart.js';
import DateTime from '../date-time.vue';
import Loading from '../loading.vue';

import { apiPaths } from '../../util/request';
import { useRequestData } from '../../request-data';

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  Legend
);

defineOptions({ name: 'FieldDataDashboard' });

const { t } = useI18n();
const { createResource, currentUser } = useRequestData();
const stats = createResource('fieldDataStats');
const loadFailed = ref(false);
const fetchStats = () => {
  loadFailed.value = false;
  return stats.request({ url: apiPaths.fieldDataStats(), resend: true })
    .catch(() => { loadFailed.value = true; });
};
fetchStats();

// A friendly greeting; personalise only when a real (non-email) display name is set.
const greeting = computed(() => {
  const dn = currentUser.dataExists ? (currentUser.displayName || '') : '';
  return (dn && !dn.includes('@')) ? t('welcomeName', { name: dn }) : t('welcome');
});

// Brand palette
const C = { total: '#0E7490' };

const kpiIconPaths = {
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  x: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>'
};

// --- KPI cards ---
const kpiCards = computed(() => {
  if (!stats.dataExists) return [];
  const k = stats.data.kpi;
  return [
    { key: 'total', label: t('kpi.total'), value: k.submissions, tone: 'blue', icon: 'file' },
    { key: 'projects', label: t('projects'), value: k.projects, tone: 'green', icon: 'list' },
    { key: 'forms', label: t('totalForms'), value: k.forms, tone: 'violet', icon: 'file' },
    { key: 'users', label: t('users'), value: k.users, tone: 'amber', icon: 'list' }
  ];
});

// --- System status ---
const statusItems = computed(() => {
  if (!stats.dataExists) return [];
  const s = stats.data.systemStatus;
  if (s == null) return [];
  return [
    { key: 'database', label: t('status.database'), ok: s.database },
    { key: 'fileStorage', label: t('status.fileStorage'), ok: s.fileStorage },
    { key: 'enketo', label: t('status.enketo'), ok: s.enketo },
    { key: 'pyxform', label: t('status.pyxform'), ok: s.pyxform },
    { key: 'emailService', label: t('status.emailService'), ok: s.emailService }
  ];
});

// --- Submission trend ---
const trendCanvas = ref(null);
let trendChart = null;

const buildTrend = () => {
  const trend = stats.data.submissionsTrend || [];
  const labels = trend.map(r => new Date(r.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  const ds = (label, key, color) => ({
    label, data: trend.map(r => r[key] || 0), borderColor: color, backgroundColor: color,
    tension: 0.35, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, fill: false
  });
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(trendCanvas.value, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { ...ds(t('kpi.total'), 'count', C.total), fill: true, backgroundColor: 'rgba(14,116,144,0.08)' },
      ]
    },
    options: {
      animation: false,
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'top', labels: { boxWidth: 12, usePointStyle: true, pointStyle: 'circle' } } },
      scales: { y: { beginAtZero: true, grid: { color: '#eef2f3' } }, x: { grid: { display: false } } }
    }
  });
};

watch(() => stats.data, async () => {
  if (!stats.dataExists) return;
  await nextTick();
  if (trendCanvas.value != null) buildTrend();
}, { immediate: true });

onBeforeUnmount(() => {
  if (trendChart) trendChart.destroy();
});
</script>

<i18n lang="json5">
{
  "en": {
    "dashboard": "Dashboard",
    "projects": "Projects",
    "users": "Users",
    "topForms": "Top Forms by Submissions",
    "noProjects": "No projects are available yet. Create a project to get started.",
    "loadFailed": "The dashboard could not be loaded. Please try again.",
    "retry": "Try again",
    "welcome": "Welcome back - here's your field operations overview.",
    "welcomeName": "Welcome back, {name} - here's your field operations overview.",
    "kpi": {
      "total": "Total Submissions",
      "approved": "Approved",
      "rejected": "Rejected",
      "inReview": "In Review",
      "activeForms": "Active Forms"
    },
    "noChange": "No change",
    "vsLast7": "vs last 7 days",
    "overview": "Submissions Overview",
    "last7days": "Last 7 days",
    "byLocation": "Submissions by Location",
    "recentSubmissions": "Recent Submissions",
    "formSummary": "Form Summary",
    "totalForms": "Total Forms",
    "header": {
      "id": "ID", "form": "Form", "submitter": "Submitter", "location": "Location", "submitted": "Date Submitted", "status": "Status"
    },
    "review": {
      "approved": "Approved", "rejected": "Rejected", "hasIssues": "In Review", "edited": "Edited", "received": "Received"
    },
    "form": { "active": "Active", "inactive": "Inactive", "archived": "Archived", "draft": "Draft" },
    "status": {
      "up": "Operational", "down": "Down",
      "database": "PostgreSQL", "fileStorage": "File Storage", "enketo": "Web Forms",
      "pyxform": "Form Conversion", "emailService": "Email Service"
    },
    "unknownSubmitter": "(unknown)",
    "noSubmissions": "There are no submissions yet.",
    "noRecentSubmissions": "There are no submissions in the last seven days."
  }
}
</i18n>

<style lang="scss">
@import '../../assets/scss/variables';

#field-data-dashboard {
  --fd-teal: #0E7490;
  --fd-border: #e4ebed;
  --fd-ink: #143039;
  --fd-muted: #667a80;

  .fd-dash-head {
    margin-bottom: 22px;
    h1 { font-size: 24px; font-weight: 750; letter-spacing: -0.01em; margin: 0 0 4px; color: var(--fd-ink); }
    p { margin: 0; color: var(--fd-muted); font-size: 14.5px; }
  }

  // KPI cards
  .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 20px; }
  .kpi-card {
    background: #fff; border: 1px solid var(--fd-border); border-radius: 12px; padding: 16px 18px;
    box-shadow: 0 1px 2px rgba(20,48,57,0.04);
  }
  .kpi-top { display: flex; justify-content: space-between; align-items: flex-start; }
  .kpi-label { color: var(--fd-muted); font-size: 12.5px; font-weight: 600; }
  .kpi-icon { width: 34px; height: 34px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center;
    svg { width: 17px; height: 17px; }
    &.icon-blue { background: #e3f0f6; color: #1C6FA6; }
    &.icon-green { background: #e2f3ea; color: #2E8B5A; }
    &.icon-red { background: #fdecea; color: #de2a11; }
    &.icon-amber { background: #fdf3e0; color: #d9860b; }
    &.icon-violet { background: #eee9f7; color: #6b4fb0; }
  }
  .kpi-value { font-size: 30px; font-weight: 750; line-height: 1.1; margin: 8px 0 4px; letter-spacing: -0.01em; }

  // Panels
  .panel-row { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; margin-bottom: 20px; }
  .panel { background: #fff; border: 1px solid var(--fd-border); border-radius: 12px; padding: 18px 20px; min-width: 0; box-shadow: 0 1px 2px rgba(20,48,57,0.04); }
  .panel-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; }
  .panel-head h2 { font-size: 16px; font-weight: 700; margin: 0; color: var(--fd-ink); }
  .panel-sub { color: var(--fd-muted); font-size: 12.5px; }
  .chart-wrap { height: 300px; position: relative; }

  // Table
  .fd-table { width: 100%; border-collapse: collapse; }
  .fd-table th { text-align: left; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--fd-muted); padding: 8px 10px; border-bottom: 1px solid var(--fd-border); }
  .fd-table td { padding: 10px; border-bottom: 1px solid #f1f5f6; font-size: 14px; }
  .fd-table .mono { font-family: $font-family-monospace; color: var(--fd-muted); }
  .empty-msg { color: var(--fd-muted); padding: 16px 4px; }

  // Project and form summaries
  .summary-list { list-style: none; padding: 0; margin: 0; width: 100%; }
  .summary-list li { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 13.5px; }
  .legend-label { flex: 1; }
  .legend-value { font-weight: 700; }

  // Status bar
  .status-bar { background: #fff; border: 1px solid var(--fd-border); border-radius: 12px; padding: 14px 20px; display: flex; flex-wrap: wrap; gap: 26px; box-shadow: 0 1px 2px rgba(20,48,57,0.04); }
  .status-item { display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .status-name { font-weight: 600; }
  .status-state { color: var(--fd-muted); }
  .status-dot { width: 9px; height: 9px; border-radius: 50%;
    &.up { background: #2E8B5A; box-shadow: 0 0 0 3px rgba(46,139,90,0.18); }
    &.down { background: #cbd3d5; }
  }

  @media (max-width: 1100px) {
    .kpi-row { grid-template-columns: repeat(2, 1fr); }
    .panel-row { grid-template-columns: 1fr; }
  }
}
</style>
