<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

This file is part of Field Data, a distribution of ODK Central. It is subject to
the license terms in the LICENSE file found in the top-level directory of this
distribution and at https://www.apache.org/licenses/LICENSE-2.0.

Ona-style Data Explorer: browse a form's submissions as a Table, Map, Photo
gallery, or Charts.
-->
<template>
  <div id="fd-explore">
    <header class="fd-explore-head">
      <div>
        <h1>{{ $t('title') }}</h1>
        <p>{{ $t('subtitle') }}</p>
      </div>
      <div class="fd-explore-actions">
        <select v-model="selectedForm" class="fd-form-select" :aria-label="$t('allForms')">
          <option value="">{{ $t('allForms') }}</option>
          <option v-for="f of forms" :key="f.form" :value="f.form">{{ f.name || f.form }} ({{ f.submissions }})</option>
        </select>
        <a class="fd-export" :href="csvUrl" download>{{ $t('downloadCsv') }}</a>
      </div>
    </header>

    <div class="fd-tabs" role="tablist">
      <button v-for="(tb, index) of tabs" :id="`explore-tab-${tb.key}`" :key="tb.key" type="button"
        role="tab" :class="{ on: activeTab === tb.key }" :aria-selected="activeTab === tb.key" :tabindex="activeTab === tb.key ? 0 : -1" aria-controls="fd-explorer-panel" @keydown="tabKey($event, index)" @click="setTab(tb.key)">
        <!-- eslint-disable vue/no-v-html -->
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" v-html="tabIcons[tb.key]"/>
        {{ tb.label }}<span v-if="tb.count != null" class="fd-tab-count">{{ tb.count }}</span>
      </button>
    </div>

    <loading :state="explore.initiallyLoading"/>

    <div v-if="explore.dataExists" id="fd-explorer-panel" role="tabpanel" :aria-labelledby="`explore-tab-${activeTab}`" class="fd-explore-body">
      <!-- TABLE -->
      <div v-if="activeTab === 'table'" class="fd-panel">
        <div class="fd-panel-scroll">
          <div class="fd-table-scroll" role="region" aria-label="Scrollable data table" tabindex="0">
<table class="fd-table">
            <thead>
<tr>
              <th>{{ $t('th.id') }}</th><th>{{ $t('th.form') }}</th><th>{{ $t('th.submitter') }}</th>
              <th>{{ $t('th.district') }}</th><th>{{ $t('th.date') }}</th><th>{{ $t('th.status') }}</th>
            </tr>
</thead>
            <tbody>
              <tr v-for="r of rows" :key="r.id">
                <td class="mono">#{{ r.id }}</td>
                <td>{{ r.formName || r.form }}</td>
                <td>{{ r.submitter || $t('unknown') }}</td>
                <td>{{ r.district || '-' }}</td>
                <td><date-time :iso="r.createdAt"/></td>
                <td><span class="badge" :class="statusInfo(r.reviewState).cls">{{ statusInfo(r.reviewState).label }}</span></td>
              </tr>
            </tbody>
          </table>
</div>
        </div>
        <p v-if="rows.length === 0" class="fd-empty">{{ $t('empty.rows') }}</p>
      </div>

      <!-- MAP -->
      <div v-show="activeTab === 'map'" class="fd-panel">
        <div class="fd-map-controls">
          <div class="fd-seg" role="group">
            <button type="button" :class="{ on: mapMode === 'points' }" @click="mapMode = 'points'">{{ $t('map.points') }}</button>
            <button type="button" :class="{ on: mapMode === 'districts' }" @click="mapMode = 'districts'">{{ $t('map.districts') }}</button>
          </div>
          <select v-if="mapMode === 'districts'" v-model="mapMetric" aria-label="District map measure" class="form-control fd-metric">
            <option value="total">{{ $t('metric.total') }}</option>
            <option value="approved">{{ $t('metric.approved') }}</option>
            <option value="needsReview">{{ $t('metric.needsReview') }}</option>
            <option value="rejected">{{ $t('metric.rejected') }}</option>
          </select>
        </div>
        <p v-if="basemapError" role="status">
Background map unavailable. Submission locations remain visible.
          <button type="button" class="btn btn-default" @click="retryBasemap">Retry background map</button>
        </p>
        <div v-show="mapMode === 'districts' || mappable > 0" ref="mapEl" class="fd-explore-map"></div>
        <p v-if="mappable === 0 && mapMode === 'points'" class="fd-empty">{{ $t('empty.map') }}</p>
      </div>

      <!-- PHOTOS -->
      <div v-if="activeTab === 'photos'" class="fd-panel">
        <div v-if="photos.length > 0" class="fd-gallery">
          <a v-for="(p, i) of photos" :key="i" :href="photoUrl(p)" target="_blank" rel="noopener" class="fd-photo">
            <img :src="photoUrl(p)" :alt="p.name" loading="lazy">
          </a>
        </div>
        <p v-else class="fd-empty">{{ $t('empty.photos') }}</p>
      </div>

      <!-- CHARTS -->
      <div v-show="activeTab === 'charts'" class="fd-panel">
        <div class="fd-charts-grid">
          <div class="fd-chart-card"><h3>{{ $t('chart.status') }}</h3><div class="cwrap"><canvas ref="statusCanvas"></canvas></div></div>
          <div class="fd-chart-card"><h3>{{ $t('chart.district') }}</h3><div class="cwrap"><canvas ref="districtCanvas"></canvas></div></div>
          <div class="fd-chart-card"><h3>{{ $t('chart.form') }}</h3><div class="cwrap"><canvas ref="formCanvas"></canvas></div></div>
          <div class="fd-chart-card"><h3>{{ $t('chart.trend') }}</h3><div class="cwrap"><canvas ref="trendCanvas"></canvas></div></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Chart, BarController, BarElement, DoughnutController, ArcElement,
  LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip, Legend
} from 'chart.js';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import slDistricts from '../../assets/sl-districts.json';

import DateTime from '../date-time.vue';
import Loading from '../loading.vue';

import { addBasemap, hasLocation } from '../../util/basemap';
import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';
import { useRequestData } from '../../request-data';

Chart.register(
  BarController,
  BarElement,
  DoughnutController,
  ArcElement,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  Legend
);

defineOptions({ name: 'FieldDataExplore' });

const { t } = useI18n();
const { createResource } = useRequestData();
const explore = createResource('fieldDataExplore');

const selectedForm = ref('');
const activeTab = ref('table');
const load = () => explore.request({ url: apiPaths.fieldDataExplore(selectedForm.value), clear: false }).catch(noop);
load();
watch(selectedForm, load);

const forms = computed(() => (explore.dataExists ? explore.data.forms : []));
const rows = computed(() => (explore.dataExists ? explore.data.rows : []));
const photos = computed(() => (explore.dataExists ? explore.data.photos : []));
const charts = computed(() => (explore.dataExists ? explore.data.charts : { byDistrict: [], byStatus: [], byForm: [], trend: [] }));
const mappable = computed(() => rows.value.filter(hasLocation).length);
const csvUrl = computed(() => apiPaths.fieldDataExploreCsv(selectedForm.value));

const tabs = computed(() => [
  { key: 'table', label: t('tab.table'), count: rows.value.length },
  { key: 'map', label: t('tab.map'), count: mappable.value },
  { key: 'photos', label: t('tab.photos'), count: photos.value.length },
  { key: 'charts', label: t('tab.charts'), count: null }
]);
const tabIcons = {
  table: '<line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><rect x="3" y="4" width="18" height="16" rx="2"/>',
  map: '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>',
  photos: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  charts: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>'
};

const statusInfo = (rs) => {
  if (rs === 'approved') return { label: t('status.approved'), cls: 'g' };
  if (rs === 'rejected') return { label: t('status.rejected'), cls: 'r' };
  if (rs === 'hasIssues') return { label: t('status.hasIssues'), cls: 'a' };
  if (rs === 'edited') return { label: t('status.edited'), cls: 'b' };
  return { label: t('status.received'), cls: 'n' };
};
const photoUrl = (p) => `/v1/projects/${p.projectId}/forms/${encodeURIComponent(p.form)}/submissions/${encodeURIComponent(p.instanceId)}/attachments/${encodeURIComponent(p.name)}`;

// --- Map + charts ---
const mapEl = ref(null);
const statusCanvas = ref(null); const districtCanvas = ref(null);
const formCanvas = ref(null); const trendCanvas = ref(null);
let map = null; let markers = null; let basemap = null;
const basemapError = ref(false);
const retryBasemap = () => {
  if (!map) return;
  basemap?.remove(); basemapError.value = false;
  basemap = addBasemap(map, () => { basemapError.value = true; }, { maxZoom: 14 });
};
const chartObjs = {};
const TEAL = '#0E7490'; const STATUS_COLORS = { approved: '#2E8B5A', rejected: '#de2a11', hasIssues: '#f29e00', edited: '#1C6FA6', received: '#9aa7ab' };

// Choropleth (GIS dashboard): shade the 16 districts by a chosen metric.
const mapMode = ref('points');
const mapMetric = ref('total');
let choroLayer = null; let legend = null;

const districtMetrics = computed(() => {
  const m = {};
  for (const r of rows.value.filter(row => row.district)) {
    if (!m[r.district]) m[r.district] = { total: 0, approved: 0, rejected: 0, needsReview: 0 };
    const d = m[r.district];
    d.total += 1;
    if (r.reviewState === 'approved') d.approved += 1;
    else if (r.reviewState === 'rejected') d.rejected += 1;
    else d.needsReview += 1;
  }
  return m;
});

// Light-to-deep teal ramp.
const RAMP = ['#eef7f9', '#cfe8ed', '#9fd0da', '#5faebf', '#2c8ba1', '#0E7490', '#09566c'];
const rampColor = (value, max) => {
  if (value <= 0 || max <= 0) return RAMP[0];
  const f = Math.sqrt(value / max); // sqrt: differentiate the low end
  return RAMP[Math.min(RAMP.length - 1, 1 + Math.floor(f * (RAMP.length - 1)))];
};

const buildChoropleth = () => {
  if (choroLayer) { choroLayer.remove(); choroLayer = null; }
  if (legend) { legend.remove(); legend = null; }
  const metrics = districtMetrics.value;
  const metric = mapMetric.value;
  const max = Object.values(metrics).reduce((m, d) => Math.max(m, d[metric]), 0);
  choroLayer = L.geoJSON(slDistricts, {
    style: (feature) => {
      const d = metrics[feature.properties.name];
      const v = d ? d[metric] : 0;
      return { color: '#fff', weight: 1.25, fillColor: rampColor(v, max), fillOpacity: 0.78 };
    },
    onEachFeature: (feature, layer) => {
      const nm = feature.properties.name;
      const d = metrics[nm] || { total: 0, approved: 0, rejected: 0, needsReview: 0 };
      layer.bindTooltip(
        `<b>${nm}</b><br>${t('metric.total')}: ${d.total}<br>${t('metric.approved')}: ${d.approved}` +
        `<br>${t('metric.needsReview')}: ${d.needsReview}<br>${t('metric.rejected')}: ${d.rejected}`,
        { sticky: true }
      );
      layer.on('mouseover', () => layer.setStyle({ weight: 2.5, color: '#0A4A5E' }));
      layer.on('mouseout', () => choroLayer && choroLayer.resetStyle(layer));
    }
  }).addTo(map);
  // Legend: min-to-max swatches.
  legend = L.control({ position: 'bottomright' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'fd-map-legend');
    const steps = RAMP.map((c, i) => `<i style="background:${c}"></i>${i === 0 ? '0' : (i === RAMP.length - 1 ? max : '')}`).join('');
    div.innerHTML = `<span class="lt">${t(`metric.${metric}`)}</span><div class="sw">${steps}</div>`;
    return div;
  };
  legend.addTo(map);
};

const buildPoints = () => {
  markers.clearLayers();
  for (const r of rows.value.filter(hasLocation)) {
    const { lat, lng } = r;
    const color = STATUS_COLORS[r.reviewState] || STATUS_COLORS.received;
    L.circleMarker([lat, lng], { radius: 5, color, weight: 1, fillColor: color, fillOpacity: 0.6 })
      .bindPopup(document.createTextNode([r.formName || r.form, r.submitter, r.district].filter(Boolean).join(' · ')))
      .addTo(markers);
  }
  if (markers.getLayers().length) map.fitBounds(markers.getBounds(), { maxZoom: 14 });
};

const buildMap = () => {
  if (!mapEl.value) return;
  if (mapMode.value === 'points' && mappable.value === 0) {
    map?.remove(); map = null; markers = null; basemap = null;
    choroLayer = null; legend = null; basemapError.value = false;
    return;
  }
  if (map == null) {
    map = L.map(mapEl.value, { scrollWheelZoom: false }).setView([8.46, -11.79], 7);
    retryBasemap();
    markers = L.featureGroup().addTo(map);
  }
  if (mapMode.value === 'districts') {
    markers.clearLayers();
    buildChoropleth();
  } else {
    if (choroLayer) { choroLayer.remove(); choroLayer = null; }
    if (legend) { legend.remove(); legend = null; }
    buildPoints();
  }
  nextTick(() => map && map.invalidateSize());
};

watch([mapMode, mapMetric], () => { if (activeTab.value === 'map') buildMap(); });

const barChart = (canvas, data, color) => new Chart(canvas, {
  type: 'bar',
  data: { labels: data.map(d => d.label), datasets: [{ data: data.map(d => d.count), backgroundColor: color, borderRadius: 4 }] },
  options: {
    animation: false,
    responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true, grid: { color: '#eef2f3' } }, x: { grid: { display: false } } }
  }
});

const buildCharts = () => {
  Object.values(chartObjs).forEach(c => c && c.destroy());
  const st = charts.value.byStatus || [];
  if (statusCanvas.value) chartObjs.status = new Chart(statusCanvas.value, {
    type: 'doughnut', data: {
      labels: st.map(s => statusInfo(s.label).label),
      datasets: [{ data: st.map(s => s.count), backgroundColor: st.map(s => STATUS_COLORS[s.label] || STATUS_COLORS.received), borderWidth: 0 }]
    },
    options: { animation: false, responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } } } }
  });
  if (districtCanvas.value) chartObjs.district = barChart(districtCanvas.value, charts.value.byDistrict || [], TEAL);
  if (formCanvas.value) chartObjs.form = barChart(formCanvas.value, charts.value.byForm || [], '#2E8B5A');
  const tr = charts.value.trend || [];
  if (trendCanvas.value) chartObjs.trend = new Chart(trendCanvas.value, {
    type: 'line', data: {
      labels: tr.map(d => new Date(d.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
      datasets: [{ data: tr.map(d => d.count), borderColor: TEAL, backgroundColor: 'rgba(14,116,144,0.08)', fill: true, tension: 0.35, pointRadius: 2 }]
    },
    options: {
      animation: false,
      responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, grid: { color: '#eef2f3' } }, x: { grid: { display: false } } }
    }
  });
};

const setTab = (key) => { activeTab.value = key; };
const tabKey = (event, index) => {
  let next;
  if (event.key === 'ArrowRight') next = (index + 1) % tabs.value.length;
  else if (event.key === 'ArrowLeft') next = (index + tabs.value.length - 1) % tabs.value.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = tabs.value.length - 1;
  else return;
  event.preventDefault(); setTab(tabs.value[next].key);
  event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next].focus();
};

watch([activeTab, () => explore.data], () => {
  if (!explore.dataExists) return;
  nextTick(() => {
    if (activeTab.value === 'map') buildMap();
    if (activeTab.value === 'charts') buildCharts();
  });
}, { deep: false });

onBeforeUnmount(() => {
  Object.values(chartObjs).forEach(c => c && c.destroy());
  if (map) map.remove();
});
</script>

<i18n lang="json5">
{
  "en": {
    "title": "Data Explorer",
    "subtitle": "Explore your submissions as a table, on a map, as photos, or as charts.",
    "allForms": "All forms",
    "downloadCsv": "Download CSV",
    "unknown": "(unknown)",
    "tab": { "table": "Table", "map": "Map", "photos": "Photos", "charts": "Charts" },
    "th": { "id": "ID", "form": "Form", "submitter": "Submitter", "district": "District", "date": "Submitted", "status": "Status" },
    "status": { "approved": "Approved", "rejected": "Rejected", "hasIssues": "In review", "edited": "Edited", "received": "Received" },
    "chart": { "status": "By review status", "district": "By district", "form": "By form", "trend": "Submissions over time" },
    "map": { "points": "Points", "districts": "Districts" },
    "metric": { "total": "Total submissions", "approved": "Approved", "needsReview": "Needs review", "rejected": "Rejected" },
    "empty": {
      "rows": "No submissions to show.",
      "map": "These submissions have no location data yet.",
      "photos": "No photo attachments in these submissions yet."
    }
  }
}
</i18n>

<style lang="scss">
@import '../../assets/scss/variables';

#fd-explore {
  --ex-border: #e4ebed; --ex-muted: #667a80;

  .fd-explore-head {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px;
    h1 { font-size: 24px; font-weight: 750; letter-spacing: -0.01em; margin: 0 0 4px; color: #143039; }
    p { margin: 0; color: var(--ex-muted); font-size: 14px; }
  }
  .fd-explore-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
  .fd-form-select {
    height: 38px; border: 1px solid #d5e2e5; border-radius: 9px; background: #f6fafb;
    padding: 0 12px; font-size: 14px; color: #23343a; min-width: 220px;
    &:focus { outline: none; border-color: #0E7490; }
  }
  .fd-export {
    display: inline-flex; align-items: center; justify-content: center; min-height: 38px;
    border: 1px solid #0E7490; border-radius: 8px; padding: 0 13px;
    color: #0E7490; background: #fff; font-size: 13px; font-weight: 700;
    text-decoration: none; white-space: nowrap;
    &:hover, &:focus { color: #fff; background: #0E7490; text-decoration: none; }
    &:focus { outline: 2px solid rgba(14, 116, 144, 0.25); outline-offset: 2px; }
  }

  .fd-tabs {
    display: flex; gap: 6px; border-bottom: 1px solid var(--ex-border); margin-bottom: 20px;
    button {
      display: inline-flex; align-items: center; gap: 8px;
      background: transparent; border: none; border-bottom: 2px solid transparent;
      padding: 10px 14px; font-size: 14px; font-weight: 600; color: var(--ex-muted); cursor: pointer;
      svg { width: 16px; height: 16px; }
      &:hover { color: #0E7490; }
      &.on { color: #0E7490; border-bottom-color: #0E7490; }
    }
    .fd-tab-count { background: #eef3f4; color: #5f7278; border-radius: 20px; font-size: 11.5px; font-weight: 700; padding: 1px 8px; }
    button.on .fd-tab-count { background: #e6f1f4; color: #0E7490; }
  }

  .fd-panel { background: #fff; border: 1px solid var(--ex-border); border-radius: 14px; box-shadow: 0 1px 2px rgba(20,48,57,0.04); overflow: hidden; position: relative; }
  .fd-panel-scroll { overflow-x: auto; }

  .fd-table { width: 100%; border-collapse: collapse;
    th { text-align: left; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ex-muted); padding: 12px 16px; border-bottom: 1px solid var(--ex-border); white-space: nowrap; }
    td { padding: 12px 16px; border-bottom: 1px solid #f1f5f6; font-size: 14px; white-space: nowrap; }
    tr:hover td { background: #f7fbfc; }
    .mono { font-family: $font-family-monospace; color: var(--ex-muted); }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600;
      &.g { background: #e2f3ea; color: #1f6e45; } &.r { background: #fdecea; color: #b3210c; }
      &.a { background: #fdf3e0; color: #9c6209; } &.b { background: #e3f0f6; color: #155a86; } &.n { background: #eef1f2; color: #566065; } }
  }

  .fd-explore-map { height: 520px; z-index: 0; }

  .fd-map-controls {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 14px; border-bottom: 1px solid #e4ebed;
  }
  .fd-seg {
    display: inline-flex; border: 1px solid #d5e2e5; border-radius: 9px; overflow: hidden;
    button {
      border: none; background: #fff; font: inherit; font-size: 13px; font-weight: 600;
      color: #5f7278; padding: 7px 16px; cursor: pointer;
      & + button { border-left: 1px solid #d5e2e5; }
      &.on { background: #0E7490; color: #fff; }
      &:not(.on):hover { background: #f1f6f7; color: #0E7490; }
    }
  }
  .fd-metric { width: auto; max-width: 220px; font-size: 13px; height: 33px; padding: 4px 10px; }

  .fd-map-legend {
    background: rgba(255, 255, 255, 0.94); border: 1px solid #dbe6e8; border-radius: 8px;
    padding: 8px 10px; font-size: 11px; color: #33474d; box-shadow: 0 2px 8px rgba(18,48,58,0.12);
    .lt { font-weight: 700; display: block; margin-bottom: 5px; }
    .sw { display: flex; align-items: flex-end; gap: 0; }
    .sw i { display: inline-block; width: 20px; height: 10px; }
  }
  .fd-empty { padding: 40px 20px; text-align: center; color: var(--ex-muted); font-size: 14px; margin: 0; }
  .fd-empty-over { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.7); }

  .fd-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; padding: 16px; }
  .fd-photo { display: block; aspect-ratio: 1; border-radius: 10px; overflow: hidden; border: 1px solid var(--ex-border);
    img { width: 100%; height: 100%; object-fit: cover; display: block; } &:hover { box-shadow: 0 6px 16px rgba(20,48,57,0.15); } }

  .fd-charts-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; padding: 16px;
    @media (max-width: 900px) { grid-template-columns: 1fr; } }
  .fd-chart-card { border: 1px solid var(--ex-border); border-radius: 12px; padding: 14px 16px;
    h3 { font-size: 14px; font-weight: 700; margin: 0 0 10px; color: #143039; }
    .cwrap { height: 240px; position: relative; } }
}
</style>
