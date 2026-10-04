<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section id="fd-analysis">
    <h1>Analysis</h1>
    <p>Explore the same selection as a table, chart or map. Saved views are private to you.</p>
    <div class="analysis-controls">
      <label>Project<select v-model="projectId" aria-label="Project" class="form-control"><option value="">Choose a project</option>
        <option v-for="p of projects" :key="p.id" :value="String(p.id)">{{ p.name }}</option></select></label>
      <label>Source<select v-model="sourceKey" aria-label="Source" class="form-control" :disabled="!projectId"><option value="">Choose a source</option>
        <option v-for="s of sources" :key="s.key" :value="s.key">{{ s.name }} ({{ s.kind }})</option></select></label>
      <label>Saved view<select aria-label="Saved view" :value="activeViewId" class="form-control" @change="restore($event.target.value)"><option value="">Choose a saved view</option>
        <option v-for="v of views" :key="v.id" :value="v.id">{{ v.title }}</option></select></label>
    </div>
    <p v-if="error" role="alert">{{ error }} <button type="button" class="btn btn-default" @click="retry">Try again</button></p>
    <p v-if="loading">Loading analysis…</p>
    <template v-if="result">
      <details>
<summary>Visible columns ({{ selectedColumns.length }} of {{ fields.length }})</summary>
        <label v-for="f of fields" :key="f.path" class="column-option"><input v-model="selectedColumns" type="checkbox" :value="f.path"> {{ f.name || f.path }}</label>
        <button type="button" class="btn btn-default" :disabled="!selectedColumns.length || loading" @click="refresh">Apply column selection</button>
      </details>
      <label><input v-model="includeRepeats" type="checkbox"> Include all authorized repeat fields in separate export tables</label>
      <fieldset class="analysis-controls">
<legend>Filter selection</legend>
        <label>Field<select v-model="filterField" class="form-control"><option value="">No additional filter</option>
          <option v-for="f of fields" :key="f.path" :value="f.path">{{ f.name || f.path }}</option></select></label>
        <label>Comparison<select v-model="filterOperator" class="form-control"><option v-for="op of ['=', '<>', '>', '<', '>=', '<=']" :key="op">{{ op }}</option></select></label>
        <label>Value<input v-model="filterValue" class="form-control"></label>
        <button type="button" class="btn btn-primary" @click="applyFilter">Apply filter</button>
      </fieldset>
      <p>Immediate downloads support 5,000 records. Queue larger frozen selections up to 100,000 records or 200 MB XML; downloads expire after 24 hours and contain numbered parts with a manifest. Dates use UTC. Select a location field for KML.</p>
      <label><input v-model="queueDownload" type="checkbox"> Queue export in the background</label>
      <p>{{ result.total.toLocaleString() }} matching records. Page {{ Math.floor(offset / 100) + 1 }}.</p>
      <div class="analysis-controls">
        <div class="btn-group" role="group" aria-label="Analysis view">
<button v-for="t of ['table', 'chart', 'map']" :key="t" type="button"
          class="btn btn-default" :aria-pressed="tab === t" @click="tab = t">
{{ t }}
</button>
</div>
        <label>View title<input v-model.trim="viewTitle" class="form-control" maxlength="255"></label>
        <button type="button" class="btn btn-default" :disabled="!viewTitle || loading" @click="save">Save view</button>
        <button v-if="activeViewId" type="button" class="btn btn-default" @click="removeView">Delete saved view</button>
        <button v-for="format of ['csv', 'xlsx', 'kml', 'sav', 'dta']" :key="format" type="button" class="btn btn-default"
          :disabled="loading || downloading" @click="download(format)">
Export {{ format.toUpperCase() }}
</button>
      </div>
      <div v-if="tab === 'table'" class="analysis-table">
<table class="table">
<thead>
<tr>
<th>Submission</th><th>Source form</th>
        <th v-for="f of result.fields" :key="f.path">{{ f.name || f.path }}</th>
</tr>
</thead><tbody>
<tr v-for="row of result.rows" :key="`${row.sourceForm}:${row.instanceId}`">
          <td>{{ row.instanceId }}</td><td>{{ row.sourceForm }}</td><td v-for="f of result.fields" :key="f.path">{{ row.data[f.path] }}</td>
        </tr>
</tbody>
</table><p v-if="result.rows.length === 0">No records match this selection.</p>
</div>
      <div v-if="tab === 'chart'">
        <div class="analysis-controls">
<label>Measure<select v-model="chartField" class="form-control"><option value="">Choose a measure</option>
          <option v-for="f of fields" :key="f.path" :value="f.path">{{ f.name || f.path }}</option></select></label>
          <label>Aggregation<select v-model="aggregation" class="form-control"><option v-for="a of ['count', 'sum', 'mean', 'median']" :key="a">{{ a }}</option></select></label>
          <label>Group by<select v-model="groupField" class="form-control"><option value="">Measure categories</option>
            <option v-for="f of fields.filter(f => f.path !== chartField)" :key="f.path" :value="f.path">{{ f.name || f.path }}</option></select></label>
          <button type="button" class="btn btn-primary" @click="refresh">Update chart</button>
</div>
        <template v-if="result.chart">
<p>{{ result.chart.coverage.answered }} answered out of {{ result.chart.coverage.total }} records.</p>
          <p v-if="result.chart.unavailable">{{ result.chart.unavailable }}</p>
          <table class="table">
<caption>{{ aggregation }} by category — table alternative to the bars</caption><thead><tr><th>Category</th><th>Value</th><th>Contributing records</th></tr></thead>
            <tbody><tr v-for="r of result.chart.rows" :key="r.key"><td>{{ r.key }}</td><td><span class="analysis-bar" :style="{ width: barWidth(r.value) }"></span>{{ r.value }}</td><td>{{ r.count }}</td></tr></tbody>
</table>
          <p v-if="result.chart.omitted">Additional categories omitted: {{ result.chart.omitted.groups || result.chart.omitted.categories }}. Add filters to inspect them.</p>
</template>
      </div>
      <div v-if="tab === 'map'">
<label>Location field<select v-model="geometry" aria-label="Location field" class="form-control"><option value="">Choose a visible location field</option>
        <option v-for="f of fields" :key="f.path" :value="f.path">{{ f.name || f.path }}</option></select></label>
        <button type="button" class="btn btn-primary" @click="refresh">Update map</button>
        <p>The map shows valid locations from this page, not the entire dataset. Coordinates are available below.</p>
        <analysis-map v-if="result.map" :data="result.map" :project-id="projectId" :can-edit="projects.find(p => String(p.id) === projectId)?.verbs?.includes('project.update')"/>
      </div>
      <div class="analysis-controls">
<button type="button" class="btn btn-default" :disabled="offset === 0 || loading" @click="page(-100)">Previous page</button>
        <button type="button" class="btn btn-default" :disabled="result.nextOffset == null || loading" @click="page(100)">Next page</button>
</div>
    </template>
    <p v-else-if="!loading && !error && sourceKey === ''">Choose a project and source to begin.</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <section v-if="projectId" aria-label="Export jobs">
      <h2>Export jobs</h2><button type="button" class="btn btn-default" @click="loadJobs">Refresh export progress</button>
      <p v-for="job of jobs" :key="job.id">
{{ job.format }} · {{ job.status }} · {{ job.completed }}/{{ job.total }} · expires {{ job.expiresAt }} {{ job.error }}
        <button v-if="job.status === 'Success'" type="button" class="btn btn-default" @click="downloadJob(job)">Download export</button>
        <button type="button" class="btn btn-default" @click="removeJob(job)">Remove export</button>
      </p>
    </section>
  </section>
</template>
<script setup>
import { computed, ref, watch, onUnmounted } from 'vue';
import useRequest from '../../composables/request';
import AnalysisMap from './analysis-map.vue';

defineOptions({ name: 'FieldDataAnalysis' });
const { request } = useRequest();
const projects = ref([]); const projectId = ref(''); const sources = ref([]); const sourceKey = ref('');
const selectedColumns = ref([]); const includeRepeats = ref(true);
const activeViewId = ref('');
const downloading = ref(false);
const queueDownload = ref(false); const jobs = ref([]);
let jobGeneration = 0; let queueId = null; let queueFingerprint = null;
const views = ref([]); const result = ref(null); const fields = ref([]); const loading = ref(false); const error = ref('');
const tab = ref('table'); const offset = ref(0); const query = ref([]); const viewTitle = ref(''); const notice = ref('');
const filterField = ref(''); const filterOperator = ref('='); const filterValue = ref('');
const chartField = ref(''); const groupField = ref(''); const aggregation = ref('count'); const geometry = ref('');
let generation = 0; let scopeGeneration = 0; let saveId = null; let saveFingerprint = null;
const source = computed(() => { const [kind, id] = sourceKey.value.split(':'); return { kind, id: Number(id) }; });
const definition = () => ({
  version: 1, source: source.value, ...(selectedColumns.value.length ? { columns: selectedColumns.value } : {}), query: query.value, tab: tab.value,
  chart: chartField.value ? { column: chartField.value, groupBy: groupField.value || null, aggregation: aggregation.value } : null,
  geometry: geometry.value || null
});
const base = () => `/v1/projects/${projectId.value}/analysis`;
const loadJobs = async () => {
  jobGeneration += 1; const current = jobGeneration; if (!projectId.value) return;
  try { const { data } = await request({ method: 'GET', url: `${base()}/jobs`, alert: false }); if (current === jobGeneration) jobs.value = data; } catch { if (current === jobGeneration) notice.value = 'Export progress could not be loaded. Refresh to retry.'; }
};
const timer = setInterval(() => { if (jobs.value.some(j => ['Pending', 'Running'].includes(j.status))) loadJobs(); }, 5000);
onUnmounted(() => { clearInterval(timer); jobGeneration += 1; });
const downloadBlob = (data, name) => { const url = URL.createObjectURL(data); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); };
const downloadJob = async job => {
  try { const { data } = await request({ method: 'GET', url: `${base()}/jobs/${job.id}/download`, responseType: 'blob' }); downloadBlob(data, `analysis-${job.id}.zip`); } catch { notice.value = 'Download failed. Check expiry and current source permissions.'; }
};
const removeJob = async job => { try { await request({ method: 'DELETE', url: `${base()}/jobs/${job.id}` }); await loadJobs(); } catch { /* request reports failure */ } };
const refresh = async () => {
  if (!projectId.value || !sourceKey.value) return;
  generation += 1; const current = generation; loading.value = true; error.value = '';
  try {
    const { data } = await request({ method: 'POST', url: `${base()}/query`, data: { ...definition(), offset: offset.value, limit: 100 }, alert: false });
    if (current !== generation) return;
    result.value = data; fields.value = data.availableFields || data.fields; if (!selectedColumns.value.length) selectedColumns.value = data.definition.columns;
  } catch (e) { if (current === generation) error.value = e.response?.data?.message || 'Analysis could not be loaded. The source or a saved field may no longer be available.'; } finally { if (current === generation) loading.value = false; }
};
const retry = () => { if (!projects.value.length || !sourceKey.value) window.location.reload(); else refresh(); };
const applyFilter = () => { query.value = filterField.value ? [{ column: filterField.value, filter: filterOperator.value, value: filterValue.value, condition: 'AND' }] : []; offset.value = 0; refresh(); };
const page = delta => { offset.value += delta; refresh(); };
const barWidth = value => `${(Math.max(0, Math.abs(value)) / Math.max(1, ...result.value.chart.rows.map(r => Math.abs(r.value)))) * 100}px`;
const save = async () => {
  const fingerprint = JSON.stringify([projectId.value, viewTitle.value, definition()]);
  if (fingerprint !== saveFingerprint) { saveId = crypto.randomUUID(); saveFingerprint = fingerprint; }
  saveId ||= crypto.randomUUID();
  try {
    await request({ method: 'POST', url: `${base()}/views`, data: { id: saveId, title: viewTitle.value, definition: definition() } });
    saveId = null; views.value = (await request({ method: 'GET', url: `${base()}/views` })).data; notice.value = 'View saved.';
  } catch { /* request shows the failure */ }
};
const removeView = async () => {
  const view = views.value.find(v => v.id === activeViewId.value); if (!view) return;
  try {
    await request({ method: 'DELETE', url: `${base()}/views/${view.id}`, headers: { 'If-Match': `"view-${view.revision}"` } });
    activeViewId.value = ''; views.value = views.value.filter(v => v.id !== view.id); notice.value = 'Saved view removed.';
    window.history.replaceState(null, '', window.location.pathname);
  } catch { /* request displays the error */ }
};
const restore = id => {
  const view = views.value.find(v => v.id === id); if (!view) return;
  window.history.replaceState(null, '', `${window.location.pathname}?project=${encodeURIComponent(projectId.value)}&view=${encodeURIComponent(id)}`);
  const d = view.definition; sourceKey.value = `${d.source.kind}:${d.source.id}`;
  queueMicrotask(() => {
    activeViewId.value = id; selectedColumns.value = d.columns;
    query.value = d.query; chartField.value = d.chart?.column || ''; groupField.value = d.chart?.groupBy || '';
    aggregation.value = d.chart?.aggregation || 'count'; geometry.value = d.geometry || ''; tab.value = d.tab; viewTitle.value = view.title; offset.value = 0; refresh();
  });
};
const download = async format => {
  downloading.value = true; notice.value = 'Preparing the filtered download…';
  try {
    if (queueDownload.value) {
      const payload = { ...definition(), format, includeRepeats: includeRepeats.value };
      const fingerprint = JSON.stringify([projectId.value, payload]);
      if (queueFingerprint !== fingerprint) { queueFingerprint = fingerprint; queueId = crypto.randomUUID(); }
      queueId ||= crypto.randomUUID();
      await request({ method: 'POST', url: `${base()}/jobs`, data: { ...payload, id: queueId } }); queueId = null;
      notice.value = 'Export queued. You can leave this page and return to download it within 24 hours.'; await loadJobs(); return;
    }
    const { data } = await request({ method: 'POST', url: `${base()}/export/${format}`, data: { ...definition(), includeRepeats: includeRepeats.value }, responseType: 'blob' });
    const url = URL.createObjectURL(data); const a = document.createElement('a'); a.href = url; a.download = `analysis.${['csv', 'sav', 'dta'].includes(format) ? 'zip' : format}`; a.click(); URL.revokeObjectURL(url); notice.value = 'Download prepared.';
  } catch { notice.value = 'Download failed. Check the export limits and retry.'; } finally { downloading.value = false; }
};
watch(projectId, async () => {
  jobs.value = []; jobGeneration += 1; queueId = null; loadJobs();
  scopeGeneration += 1; const current = scopeGeneration; generation += 1; sourceKey.value = ''; result.value = null; sources.value = []; views.value = []; error.value = ''; loading.value = false;
  if (!projectId.value) return;
  try {
    const [s, v] = await Promise.all([request({ method: 'GET', url: `${base()}/sources`, alert: false }), request({ method: 'GET', url: `${base()}/views`, alert: false })]);
    if (current !== scopeGeneration) return;
    sources.value = Object.entries(s.data).flatMap(([kind, rows]) => rows.map(r => ({ ...r, kind: kind === 'forms' ? 'form' : kind, key: `${kind === 'forms' ? 'form' : kind}:${r.id}` }))); views.value = v.data;
    const linked = new URLSearchParams(window.location.search).get('view'); if (linked) restore(linked);
  } catch { if (current === scopeGeneration) error.value = 'Project sources could not be loaded.'; }
});
watch(sourceKey, () => { selectedColumns.value = []; activeViewId.value = ''; generation += 1; result.value = null; query.value = []; chartField.value = ''; groupField.value = ''; geometry.value = ''; offset.value = 0; saveId = null; if (sourceKey.value) refresh(); });
request({ method: 'GET', url: '/v1/projects', extended: true }).then(({ data }) => { projects.value = data.filter(p => p.verbs?.includes('submission.read') && p.verbs?.includes('submission.list')); const linked = new URLSearchParams(window.location.search).get('project'); if (projects.value.some(p => String(p.id) === linked)) projectId.value = linked; }).catch(() => { error.value = 'Projects could not be loaded.'; });
</script>
<style lang="scss">
#fd-analysis { .analysis-controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin: 16px 0; }
  label { min-width: 160px; } .column-option { display: inline-block; margin: 8px; } .analysis-table { overflow-x: auto; } .analysis-bar { display: inline-block; height: 10px; background: #0e7490; margin-right: 8px; }
}
</style>
