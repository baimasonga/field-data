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
    <template v-if="stats.dataExists">
      <!-- KPI cards -->
      <div class="kpi-row">
        <div v-for="c of kpiCards" :key="c.key" class="kpi-card">
          <div class="kpi-top">
            <span class="kpi-label">{{ c.label }}</span>
            <span class="kpi-icon" :class="`icon-${c.tone}`">
              <!-- eslint-disable-next-line vue/no-v-html -->
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" v-html="kpiIconPaths[c.icon]"></svg>
            </span>
          </div>
          <div class="kpi-value">{{ c.value.toLocaleString() }}</div>
          <div class="kpi-delta" :class="deltaClass(c.delta)">
            <template v-if="c.delta == null">{{ $t('noChange') }}</template>
            <template v-else>
              <span :class="c.delta >= 0 ? 'icon-arrow-up' : 'icon-arrow-down'"></span>
              {{ Math.abs(c.delta) }}% {{ $t('vsLast7') }}
            </template>
          </div>
        </div>
      </div>

      <!-- Row: trend chart + map -->
      <div class="panel-row">
        <div class="panel panel-2">
          <div class="panel-head">
            <h2>{{ $t('overview') }}</h2>
            <span class="panel-sub">{{ $t('last7days') }}</span>
          </div>
          <div class="chart-wrap"><canvas ref="trendCanvas"></canvas></div>
        </div>
        <div class="panel panel-1">
          <div class="panel-head">
            <h2>{{ $t('byLocation') }}</h2>
          </div>
          <div ref="mapEl" class="map-wrap"></div>
        </div>
      </div>

      <!-- Row: recent submissions + form summary -->
      <div class="panel-row">
        <div class="panel panel-2">
          <div class="panel-head"><h2>{{ $t('recentSubmissions') }}</h2></div>
          <table class="fd-table">
            <thead>
              <tr>
                <th>{{ $t('header.id') }}</th>
                <th>{{ $t('header.form') }}</th>
                <th>{{ $t('header.submitter') }}</th>
                <th>{{ $t('header.location') }}</th>
                <th>{{ $t('header.submitted') }}</th>
                <th>{{ $t('header.status') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s of stats.data.recentSubmissions" :key="s.id">
                <td class="mono">#{{ s.id }}</td>
                <td>{{ s.formName || s.form }}</td>
                <td>{{ s.submitter || $t('unknownSubmitter') }}</td>
                <td>
                  <span v-if="s.location" class="loc"><span class="loc-dot"></span>{{ s.location }}</span>
                  <span v-else class="loc-empty">-</span>
                </td>
                <td><date-time :iso="s.createdAt"/></td>
                <td><span class="badge" :class="statusInfo(s.reviewState).cls">{{ statusInfo(s.reviewState).label }}</span></td>
              </tr>
            </tbody>
          </table>
          <p v-show="stats.data.recentSubmissions.length === 0" class="empty-msg">{{ $t('noSubmissions') }}</p>
        </div>

        <div class="panel panel-1">
          <div class="panel-head"><h2>{{ $t('formSummary') }}</h2></div>
          <div class="donut-wrap">
            <div class="donut-canvas"><canvas ref="donutCanvas"></canvas>
              <div class="donut-center"><span class="donut-total">{{ formTotal }}</span><span class="donut-total-label">{{ $t('totalForms') }}</span></div>
            </div>
            <ul class="donut-legend">
              <li v-for="seg of formSegments" :key="seg.key">
                <span class="legend-dot" :style="{ backgroundColor: seg.color }"></span>
                <span class="legend-label">{{ seg.label }}</span>
                <span class="legend-value">{{ seg.value }}</span>
                <span class="legend-pct">{{ seg.pct }}%</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <!-- System status bar -->
      <div class="status-bar">
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
  DoughnutController, ArcElement, Filler, Tooltip, Legend
} from 'chart.js';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import slDistricts from '../../assets/sl-districts.json';

import DateTime from '../date-time.vue';
import Loading from '../loading.vue';

import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';
import { useRequestData } from '../../request-data';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale,
  DoughnutController, ArcElement, Filler, Tooltip, Legend);

defineOptions({ name: 'FieldDataDashboard' });

const { t } = useI18n();
const { createResource, currentUser } = useRequestData();
const stats = createResource('fieldDataStats');
stats.request({ url: apiPaths.fieldDataStats() }).catch(noop);

// A friendly greeting; personalise only when a real (non-email) display name is set.
const greeting = computed(() => {
  const dn = currentUser.dataExists ? (currentUser.displayName || '') : '';
  return (dn && !dn.includes('@')) ? t('welcomeName', { name: dn }) : t('welcome');
});

// Brand palette
const C = { total: '#0E7490', approved: '#2E8B5A', rejected: '#de2a11', inReview: '#f29e00', blue: '#1C6FA6', grey: '#9aa7ab' };

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
  const k = stats.data.kpi; const d = stats.data.deltas || {};
  return [
    { key: 'total', label: t('kpi.total'), value: k.submissions, delta: d.submissions, tone: 'blue', icon: 'file' },
    { key: 'approved', label: t('kpi.approved'), value: k.approved, delta: d.approved, tone: 'green', icon: 'check' },
    { key: 'rejected', label: t('kpi.rejected'), value: k.rejected, delta: d.rejected, tone: 'red', icon: 'x' },
    { key: 'inReview', label: t('kpi.inReview'), value: k.inReview, delta: d.inReview, tone: 'amber', icon: 'clock' },
    { key: 'activeForms', label: t('kpi.activeForms'), value: k.activeForms, delta: null, tone: 'violet', icon: 'list' }
  ];
});
const deltaClass = (delta) => (delta == null ? 'flat' : (delta >= 0 ? 'up' : 'down'));

// --- Status badges ---
const statusInfo = (rs) => {
  if (rs === 'approved') return { label: t('review.approved'), cls: 'badge-green' };
  if (rs === 'rejected') return { label: t('review.rejected'), cls: 'badge-red' };
  if (rs === 'hasIssues') return { label: t('review.hasIssues'), cls: 'badge-amber' };
  if (rs === 'edited') return { label: t('review.edited'), cls: 'badge-blue' };
  return { label: t('review.received'), cls: 'badge-grey' };
};

// --- Form summary donut ---
const formTotal = computed(() => {
  if (!stats.dataExists) return 0;
  const f = stats.data.formSummary; return f.active + f.inactive + f.archived + f.draft;
});
const formSegments = computed(() => {
  if (!stats.dataExists) return [];
  const f = stats.data.formSummary; const total = formTotal.value || 1;
  const pct = (v) => Math.round((v / total) * 1000) / 10;
  return [
    { key: 'active', label: t('form.active'), value: f.active, pct: pct(f.active), color: C.total },
    { key: 'inactive', label: t('form.inactive'), value: f.inactive, pct: pct(f.inactive), color: C.grey },
    { key: 'archived', label: t('form.archived'), value: f.archived, pct: pct(f.archived), color: C.approved },
    { key: 'draft', label: t('form.draft'), value: f.draft, pct: pct(f.draft), color: C.inReview }
  ];
});

// --- System status ---
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

// --- Charts + map ---
const trendCanvas = ref(null);
const donutCanvas = ref(null);
const mapEl = ref(null);
let trendChart = null; let donutChart = null; let map = null;

const DISTRICT_COORDS = {
  Kailahun: [8.28, -10.57], Kenema: [7.88, -11.19], Kono: [8.65, -10.97],
  Bombali: [9.02, -12.19], Falaba: [9.85, -11.30], Koinadugu: [9.58, -11.55],
  Tonkolili: [8.72, -11.95], Kambia: [9.12, -12.92], Karene: [9.05, -12.72],
  'Port Loko': [8.77, -12.79], Bo: [7.96, -11.74], Bonthe: [7.53, -12.50],
  Moyamba: [8.16, -12.43], Pujehun: [7.35, -11.72],
  'Western Area Rural': [8.30, -13.07], 'Western Area Urban': [8.48, -13.23]
};

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
        ds(t('kpi.approved'), 'approved', C.approved),
        ds(t('kpi.rejected'), 'rejected', C.rejected),
        ds(t('kpi.inReview'), 'inReview', C.inReview)
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'top', labels: { boxWidth: 12, usePointStyle: true, pointStyle: 'circle' } } },
      scales: { y: { beginAtZero: true, grid: { color: '#eef2f3' } }, x: { grid: { display: false } } }
    }
  });
};

const buildDonut = () => {
  const segs = formSegments.value;
  if (donutChart) donutChart.destroy();
  donutChart = new Chart(donutCanvas.value, {
    type: 'doughnut',
    data: { labels: segs.map(s => s.label), datasets: [{ data: segs.map(s => s.value), backgroundColor: segs.map(s => s.color), borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '72%', plugins: { legend: { display: false } } }
  });
};

// Light-to-deep teal ramp for the district choropleth.
const RAMP = ['#eef7f9', '#cfe8ed', '#9fd0da', '#5faebf', '#2c8ba1', '#0E7490', '#09566c'];
const rampColor = (value, max) => {
  if (value <= 0 || max <= 0) return RAMP[0];
  const f = Math.sqrt(value / max);
  return RAMP[Math.min(RAMP.length - 1, 1 + Math.floor(f * (RAMP.length - 1)))];
};

const buildMap = () => {
  if (map) { map.remove(); map = null; }
  map = L.map(mapEl.value, { attributionControl: true, scrollWheelZoom: false }).setView([8.46, -11.79], 7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 12, attribution: '&copy; OpenStreetMap'
  }).addTo(map);
  const counts = stats.data.districtCounts || [];
  const max = counts.reduce((m, c) => Math.max(m, c.count), 0) || 1;
  // District choropleth beneath the count bubbles.
  const byName = Object.fromEntries(counts.map(c => [c.district, c.count]));
  L.geoJSON(slDistricts, {
    style: (feature) => ({
      color: '#fff', weight: 1, fillColor: rampColor(byName[feature.properties.name] || 0, max), fillOpacity: 0.65
    }),
    onEachFeature: (feature, layer) => {
      layer.bindTooltip(`${feature.properties.name}: ${byName[feature.properties.name] || 0}`, { sticky: true });
    }
  }).addTo(map);
  // Draw larger bubbles first so smaller ones stay clickable on top.
  const sorted = [...counts].sort((a, b) => b.count - a.count);
  for (const row of sorted) {
    const coord = DISTRICT_COORDS[row.district];
    if (!coord) continue;
    // Tighter scale + cap to avoid the Freetown-area bubbles swallowing the map.
    const radius = 6 + Math.sqrt(row.count / max) * 15;
    L.circleMarker(coord, {
      radius, color: '#0E7490', weight: 1.25, fillColor: '#0E7490', fillOpacity: 0.28
    }).addTo(map).bindTooltip(`${row.district}: ${row.count}`, { permanent: false, direction: 'top' });
    // Only label bubbles big enough to hold the number, to cut clutter.
    if (radius >= 12) {
      L.marker(coord, { interactive: false, icon: L.divIcon({ className: 'fd-map-count', html: `<span>${row.count}</span>`, iconSize: [36, 16] }) }).addTo(map);
    }
  }
  nextTick(() => map && map.invalidateSize());
};

const render = () => { if (!stats.dataExists) return; nextTick(() => { buildTrend(); buildDonut(); buildMap(); }); };
watch(() => stats.dataExists, (v) => { if (v) render(); }, { immediate: true });

onBeforeUnmount(() => {
  if (trendChart) trendChart.destroy();
  if (donutChart) donutChart.destroy();
  if (map) map.remove();
});
</script>

<i18n lang="json5">
{
  "en": {
    "dashboard": "Dashboard",
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
    "noSubmissions": "There are no submissions yet."
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
  .kpi-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; margin-bottom: 20px; }
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
  .kpi-delta { font-size: 12px; font-weight: 600;
    &.up { color: #2E8B5A; } &.down { color: #de2a11; } &.flat { color: var(--fd-muted); }
  }

  // Panels
  .panel-row { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; margin-bottom: 20px; }
  .panel { background: #fff; border: 1px solid var(--fd-border); border-radius: 12px; padding: 18px 20px; min-width: 0; box-shadow: 0 1px 2px rgba(20,48,57,0.04); }
  .panel-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; }
  .panel-head h2 { font-size: 16px; font-weight: 700; margin: 0; color: var(--fd-ink); }
  .panel-sub { color: var(--fd-muted); font-size: 12.5px; }
  .chart-wrap { height: 300px; position: relative; }
  .map-wrap { height: 300px; border-radius: 8px; overflow: hidden; z-index: 0; }

  // Table
  .fd-table { width: 100%; border-collapse: collapse; }
  .fd-table th { text-align: left; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--fd-muted); padding: 8px 10px; border-bottom: 1px solid var(--fd-border); }
  .fd-table td { padding: 10px; border-bottom: 1px solid #f1f5f6; font-size: 14px; }
  .fd-table .mono { font-family: $font-family-monospace; color: var(--fd-muted); }
  .loc { display: inline-flex; align-items: center; gap: 6px; }
  .loc-dot { width: 6px; height: 6px; border-radius: 50%; background: #1C6FA6; flex-shrink: 0; }
  .loc-empty { color: #b3bfc2; }
  .empty-msg { color: var(--fd-muted); padding: 16px 4px; }

  .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600;
    &.badge-green { background: #e2f3ea; color: #1f6e45; }
    &.badge-red { background: #fdecea; color: #b3210c; }
    &.badge-amber { background: #fdf3e0; color: #9c6209; }
    &.badge-blue { background: #e3f0f6; color: #155a86; }
    &.badge-grey { background: #eef1f2; color: #566065; }
  }

  // Donut
  .donut-wrap { display: flex; flex-direction: column; align-items: center; gap: 16px; }
  .donut-canvas { position: relative; width: 190px; height: 190px; }
  .donut-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; }
  .donut-total { font-size: 26px; font-weight: 750; }
  .donut-total-label { font-size: 11px; color: var(--fd-muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .donut-legend { list-style: none; padding: 0; margin: 0; width: 100%; }
  .donut-legend li { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 13.5px; }
  .legend-dot { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
  .legend-label { flex: 1; }
  .legend-value { font-weight: 700; }
  .legend-pct { color: var(--fd-muted); width: 48px; text-align: right; }

  // Status bar
  .status-bar { background: #fff; border: 1px solid var(--fd-border); border-radius: 12px; padding: 14px 20px; display: flex; flex-wrap: wrap; gap: 26px; box-shadow: 0 1px 2px rgba(20,48,57,0.04); }
  .status-item { display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .status-name { font-weight: 600; }
  .status-state { color: var(--fd-muted); }
  .status-dot { width: 9px; height: 9px; border-radius: 50%;
    &.up { background: #2E8B5A; box-shadow: 0 0 0 3px rgba(46,139,90,0.18); }
    &.down { background: #cbd3d5; }
  }

  .fd-map-count span { display: inline-block; font-size: 11px; font-weight: 700; color: #0E7490; text-shadow: 0 0 3px #fff, 0 0 3px #fff; text-align: center; width: 40px; }

  @media (max-width: 1100px) {
    .kpi-row { grid-template-columns: repeat(2, 1fr); }
    .panel-row { grid-template-columns: 1fr; }
  }
}
</style>
