<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

This file is part of Field Data, a distribution of ODK Central. It is subject to
the license terms in the LICENSE file found in the top-level directory of this
distribution and at https://www.apache.org/licenses/LICENSE-2.0.

Presentational body of the program report. Fed by either the authenticated
/field-data/report endpoint or the public tokenized one. Print-friendly: the
map renders district polygons on a plain background (no tile requests).
-->
<template>
  <div class="fd-report-body">
    <div class="rb-head">
      <img src="../../assets/images/field-data-logo.png" alt="Field Data" class="rb-logo">
      <div>
        <component :is="headingLevel === 1 ? 'h1' : 'h2'">{{ $t('title') }}</component>
        <p class="rb-meta">{{ $t('generated') }} <date-time :iso="data.generatedAt"/></p>
      </div>
    </div>

    <div class="rb-kpis">
      <div class="k"><div class="n">{{ $n(data.kpi.submissions, 'default') }}</div><div class="l">{{ $t('kpi.submissions') }}</div></div>
      <div class="k"><div class="n g">{{ $n(data.kpi.approved, 'default') }}</div><div class="l">{{ $t('kpi.approved') }}</div></div>
      <div class="k"><div class="n r">{{ $n(data.kpi.rejected, 'default') }}</div><div class="l">{{ $t('kpi.rejected') }}</div></div>
      <div class="k"><div class="n a">{{ $n(data.kpi.inReview, 'default') }}</div><div class="l">{{ $t('kpi.inReview') }}</div></div>
      <div class="k"><div class="n">{{ data.approvalRate }}%</div><div class="l">{{ $t('kpi.approvalRate') }}</div></div>
      <div class="k"><div class="n">{{ $n(data.kpi.forms, 'default') }}</div><div class="l">{{ $t('kpi.forms') }}</div></div>
    </div>

    <div class="rb-grid">
      <section class="rb-card">
        <h2>{{ $t('sec.trend') }}</h2>
        <div class="rb-chart"><canvas ref="trendCanvas"></canvas></div>
      </section>
      <section class="rb-card">
        <h2>{{ $t('sec.map') }}</h2>
        <div ref="mapEl" class="rb-map"></div>
      </section>
    </div>

    <div class="rb-grid">
      <section class="rb-card">
        <h2>{{ $t('sec.forms') }}</h2>
        <div class="fd-table-scroll" role="region" aria-label="Scrollable data table" tabindex="0">
<table class="rb-table">
          <thead><tr><th>{{ $t('th.form') }}</th><th class="r">{{ $t('th.submissions') }}</th><th class="r">{{ $t('th.approved') }}</th></tr></thead>
          <tbody>
            <tr v-for="f of data.topForms" :key="f.form">
              <td>{{ f.name || f.form }}</td><td class="r">{{ $n(f.count, 'default') }}</td><td class="r">{{ $n(f.approved, 'default') }}</td>
            </tr>
          </tbody>
        </table>
</div>
      </section>
      <section class="rb-card">
        <h2>{{ $t('sec.team') }}</h2>
        <div class="fd-table-scroll" role="region" aria-label="Scrollable data table" tabindex="0">
<table class="rb-table">
          <thead><tr><th>{{ $t('th.enumerator') }}</th><th class="r">{{ $t('th.submissions') }}</th><th class="r">{{ $t('th.approved') }}</th><th class="r">{{ $t('th.rejected') }}</th></tr></thead>
          <tbody>
            <tr v-for="m of data.team" :key="m.name">
              <td>{{ m.name }}</td><td class="r">{{ $n(m.total, 'default') }}</td><td class="r">{{ $n(m.approved, 'default') }}</td><td class="r">{{ $n(m.rejected, 'default') }}</td>
            </tr>
          </tbody>
        </table>
</div>
      </section>
    </div>

    <p class="rb-foot">{{ $t('footer') }}</p>
  </div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip } from 'chart.js';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import slDistricts from '../../assets/sl-districts.json';

import DateTime from '../date-time.vue';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip);

defineOptions({ name: 'FieldDataReportBody' });
const props = defineProps({
  data: { type: Object, required: true },
  headingLevel: { type: Number, default: 1 }
});

const trendCanvas = ref(null);
const mapEl = ref(null);
let chart = null; let map = null;

const RAMP = ['#eef7f9', '#cfe8ed', '#9fd0da', '#5faebf', '#2c8ba1', '#0E7490', '#09566c'];
const rampColor = (value, max) => {
  if (value <= 0 || max <= 0) return RAMP[0];
  const f = Math.sqrt(value / max);
  return RAMP[Math.min(RAMP.length - 1, 1 + Math.floor(f * (RAMP.length - 1)))];
};

onMounted(() => nextTick(() => {
  const tr = props.data.trend || [];
  if (trendCanvas.value) {
    chart = new Chart(trendCanvas.value, {
      type: 'line',
      data: {
        labels: tr.map(d => new Date(d.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
        datasets: [{ data: tr.map(d => d.count), borderColor: '#0E7490', backgroundColor: 'rgba(14,116,144,0.08)', fill: true, tension: 0.35, pointRadius: 2 }]
      },
      options: {
        animation: false,
        responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, grid: { color: '#eef2f3' } }, x: { grid: { display: false } } }
      }
    });
  }
  if (mapEl.value) {
    // No tile layer: plain background prints reliably and needs no network.
    map = L.map(mapEl.value, { zoomControl: false, attributionControl: false, scrollWheelZoom: false, dragging: false, doubleClickZoom: false });
    const counts = props.data.districtCounts || [];
    const max = counts.reduce((m, c) => Math.max(m, c.count), 0) || 1;
    const byName = Object.fromEntries(counts.map(c => [c.district, c.count]));
    const layer = L.geoJSON(slDistricts, {
      style: (feature) => ({ color: '#fff', weight: 1.25, fillColor: rampColor(byName[feature.properties.name] || 0, max), fillOpacity: 0.9 }),
      onEachFeature: (feature, l) => {
        l.bindTooltip(`${feature.properties.name}: ${byName[feature.properties.name] || 0}`, { sticky: true });
      }
    }).addTo(map);
    map.fitBounds(layer.getBounds(), { padding: [8, 8] });
  }
}));

onBeforeUnmount(() => {
  if (chart) chart.destroy();
  if (map) map.remove();
});
</script>

<i18n lang="json5">
{
  "en": {
    "title": "Field Operations Report",
    "generated": "Generated",
    "kpi": {
      "submissions": "Total submissions", "approved": "Approved", "rejected": "Rejected",
      "inReview": "In review", "approvalRate": "Approval rate", "forms": "Active forms"
    },
    "sec": { "trend": "Submissions - last 30 days", "map": "Coverage by district", "forms": "Forms", "team": "Field team" },
    "th": { "form": "Form", "submissions": "Submissions", "approved": "Approved", "rejected": "Rejected", "enumerator": "Enumerator" },
    "footer": "Produced with Field Data - Offline Field Operations Platform."
  }
}
</i18n>

<style lang="scss">
.fd-report-body {
  --b: #e4ebed; --muted: #667a80;
  background: #fff;

  .rb-head { display: flex; align-items: center; gap: 18px; padding-bottom: 16px; border-bottom: 2px solid #0E7490; margin-bottom: 20px;
    .rb-logo { height: 52px; width: auto; }
    h1 { font-size: 22px; font-weight: 750; margin: 0; color: #143039; }
    .rb-meta { margin: 2px 0 0; color: var(--muted); font-size: 13px; } }

  .rb-kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; margin-bottom: 20px;
    .k { border: 1px solid var(--b); border-radius: 10px; padding: 12px 14px;
      .n { font-size: 22px; font-weight: 750; color: #143039; &.g { color: #1f6e45; } &.r { color: #b3210c; } &.a { color: #9c6209; } }
      .l { font-size: 11.5px; color: var(--muted); margin-top: 4px; } }
    @media (max-width: 900px) { grid-template-columns: repeat(3, 1fr); } }

  .rb-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;
    @media (max-width: 900px) { grid-template-columns: 1fr; } }
  .rb-card { border: 1px solid var(--b); border-radius: 12px; padding: 14px 16px;
    h2 { font-size: 14px; font-weight: 700; margin: 0 0 12px; color: #143039; } }
  .rb-chart { height: 240px; position: relative; }
  .rb-map { height: 300px; background: #f6fafb; border-radius: 8px; }

  .rb-table { width: 100%; border-collapse: collapse; font-size: 13px;
    th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); padding: 7px 8px; border-bottom: 1px solid var(--b); &.r { text-align: right; } }
    td { padding: 7px 8px; border-bottom: 1px solid #f1f5f6; &.r { text-align: right; font-variant-numeric: tabular-nums; } }
    tr:last-child td { border-bottom: none; } }

  .rb-foot { margin: 10px 0 0; color: #8fa1a7; font-size: 11.5px; text-align: center; }
}

@media print {
  .fd-shell #fd-sidebar, .fd-shell .navbar, .fd-report-actions, .fd-share-panel { display: none !important; }
  .fd-shell .fd-main-col { width: 100% !important; }
  .fd-report-body .rb-card, .fd-report-body .rb-kpis .k { break-inside: avoid; }
}
</style>
