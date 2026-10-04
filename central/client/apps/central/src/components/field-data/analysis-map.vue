<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <div>
    <p v-if="error" role="alert">{{ error }} <button type="button" class="btn btn-default" @click="load">Retry reference layers</button></p>
    <p v-if="basemapError" role="status">
Background map unavailable. Submission locations and reference layers remain visible.
      <button type="button" class="btn btn-default" @click="retryBasemap">Retry background map</button>
    </p>
    <div ref="mapEl" class="analysis-map"></div>
    <p v-if="!data.features.length">No valid submission locations in this selection.</p>
    <fieldset>
<legend>Project reference layers</legend>
      <p>Uploaded properties are visible to project readers. Use reference geography without personal data.</p>
      <div v-for="(layer, index) of layers" :key="layer.id" class="reference-layer">
        <label><input type="checkbox" :checked="layer.definition.visible" @change="toggle(layer, $event.target.checked)"> {{ layer.title }}</label>
        <button type="button" class="btn btn-default" @click="fit(layer.id)">Fit layer</button>
        <button type="button" class="btn btn-default" @click="downloadLayer(layer.id)">Download reference GeoJSON</button>
        <template v-if="canEdit">
          <button type="button" class="btn btn-default" :disabled="index === 0" @click="move(index, -1)">Move up</button>
          <button type="button" class="btn btn-default" :disabled="index === layers.length - 1" @click="move(index, 1)">Move down</button>
          <button type="button" class="btn btn-default" @click="edit(layer)">Edit / replace</button>
          <button type="button" class="btn btn-default" @click="remove(layer)">Remove</button>
        </template>
        <p>{{ layer.definition.attribution }} · {{ layer.data.features.length }} features</p>
        <ul v-if="layer.definition.style.mode !== 'single'" aria-label="Layer legend">
          <li v-for="(bin, i) of legend(layer)" :key="i"><span :style="{ background: bin.color }" class="layer-swatch"></span>{{ bin.label }}</li>
          <li><span :style="{ background: layer.definition.style.missingColor }" class="layer-swatch"></span>Missing or unclassified</li>
        </ul>
        <details>
<summary>Reference feature properties (table alternative)</summary>
          <p v-for="(feature, i) of layer.data.features.slice(0, 100)" :key="i">{{ JSON.stringify(feature.properties) }}</p>
          <p v-if="layer.data.features.length > 100">First 100 features; download the original reference file for the complete list.</p>
        </details>
      </div>
      <template v-if="canEdit">
        <label>Layer title<input v-model="title" class="form-control" maxlength="255"></label>
        <label>Attribution<input v-model="attribution" class="form-control" maxlength="500"></label>
        <label>GeoJSON (WGS84, up to 2 MB)<input type="file" accept=".json,.geojson,application/geo+json" @change="readFile"></label>
        <label>Style JSON<textarea v-model="styleText" class="form-control" rows="4" aria-describedby="layer-style-help"></textarea></label>
        <p id="layer-style-help">Modes: single, categorical (property and categories [{value,color}]), numeric (property, fixed bins [{max,color}], units). Colors use #RRGGBB; missingColor is required for unclassified values.</p>
        <button type="button" class="btn btn-primary" :disabled="busy || !title || !upload && !editing" @click="save">{{ editing ? 'Replace layer' : 'Upload layer' }}</button>
        <button v-if="editing" type="button" class="btn btn-default" @click="editing = null">Cancel editing</button>
      </template>
    </fieldset>
    <table class="table">
<caption>Mapped submission coordinates</caption><thead><tr><th>Submission</th><th>Longitude</th><th>Latitude</th></tr></thead>
      <tbody><tr v-for="f of data.features" :key="`${f.properties.sourceForm}:${f.properties.instanceId}`"><td>{{ f.properties.instanceId }}</td><td>{{ f.geometry.coordinates[0] }}</td><td>{{ f.geometry.coordinates[1] }}</td></tr></tbody>
</table>
  </div>
</template>
<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { addBasemap } from '../../util/basemap';
import useRequest from '../../composables/request';

defineOptions({ name: 'AnalysisMap' });
const props = defineProps({ data: { type: Object, required: true }, projectId: { type: String, required: true }, canEdit: Boolean });
const { request } = useRequest(); const layers = ref([]); const error = ref(''); const busy = ref(false);
const title = ref(''); const attribution = ref(''); const upload = ref(null); const editing = ref(null);
const styleText = ref('{"mode":"single","color":"#137d92","missingColor":"#777777"}');
const basemapError = ref(false); let basemap = null;
const mapEl = ref(null); let map = null; const rendered = new Map(); let generation = 0;
const retryBasemap = () => {
  if (!map) return;
  basemap?.remove(); basemapError.value = false;
  basemap = addBasemap(map, () => { basemapError.value = true; });
};
const base = () => `/v1/projects/${props.projectId}/map-layers`;
const legend = layer => { const s = layer.definition.style; return s.mode === 'numeric' ? s.bins.map(b => ({ color: b.color, label: `≤ ${b.max} ${s.units}` })) : s.categories.map(c => ({ color: c.color, label: c.value })); };
const fillColor = (feature, style) => {
  if (style.mode === 'single') return style.color;
  const value = feature.properties?.[style.property];
  if (value == null || value === '') return style.missingColor;
  if (style.mode === 'categorical') return style.categories.find(c => c.value === String(value))?.color || style.missingColor;
  return Number.isFinite(Number(value)) ? style.bins.find(b => Number(value) <= b.max)?.color || style.missingColor : style.missingColor;
};
const render = async () => {
  await nextTick(); if (!mapEl.value) return; if (map) map.remove(); rendered.clear();
  map = L.map(mapEl.value, { scrollWheelZoom: false }).setView([8.46, -11.79], 7);
  retryBasemap();
  for (const layer of layers.value) {
    const s = layer.definition.style;
    const geo = L.geoJSON(layer.data, {
      style: f => ({ color: fillColor(f, s), fillColor: fillColor(f, s), fillOpacity: 0.5 }),
      pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 6, color: fillColor(f, s) }),
      onEachFeature: (f, l) => { const text = document.createElement('span'); text.textContent = JSON.stringify(f.properties); l.bindPopup(text); }
    });
    rendered.set(layer.id, geo); if (layer.definition.visible) geo.addTo(map);
  }
  const points = L.geoJSON(props.data, { pointToLayer: (_, latlng) => L.circleMarker(latlng, { radius: 6, color: '#bd4c10' }) }).addTo(map);
  if (props.data.features.length) map.fitBounds(points.getBounds(), { maxZoom: 14 });
};
const load = async () => {
  generation += 1; const current = generation; error.value = '';
  try { const { data } = await request({ method: 'GET', url: base(), alert: false }); if (current !== generation) return; layers.value = data; await render(); } catch { if (current === generation) error.value = 'Reference layers could not be loaded. Retry by reopening the map.'; }
};
const update = (layer, data) => request({ method: 'PUT', url: `${base()}/${layer.id}`, headers: { 'If-Match': `"layer-${layer.revision}"` }, data });
const toggle = async (layer, visible) => { if (props.canEdit) { await update(layer, { visible }); await load(); } else { layers.value = layers.value.map(l => (l.id === layer.id ? { ...l, definition: { ...l.definition, visible } } : l)); render(); } };
const downloadLayer = async id => {
  const { data } = await request({ method: 'GET', url: base() }); const layer = data.find(l => l.id === id); if (!layer) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(layer.data)], { type: 'application/geo+json' })); const a = document.createElement('a'); a.href = url; a.download = `reference-${id}.geojson`; a.click(); URL.revokeObjectURL(url);
};
const fit = id => { const bounds = rendered.get(id)?.getBounds(); if (bounds?.isValid()) map.fitBounds(bounds); };
const move = async (index, delta) => { const a = layers.value[index]; await update(a, { position: index + delta }); await load(); };
const remove = async layer => { await request({ method: 'DELETE', url: `${base()}/${layer.id}`, headers: { 'If-Match': `"layer-${layer.revision}"` } }); await load(); };
const edit = layer => { editing.value = layer; title.value = layer.title; attribution.value = layer.definition.attribution; upload.value = null; styleText.value = JSON.stringify(layer.definition.style, null, 2); };
const readFile = async event => { const file = event.target.files[0]; if (!file) return; if (file.size > 2097152) { error.value = 'GeoJSON exceeds 2 MB.'; return; } try { upload.value = JSON.parse(await file.text()); } catch { error.value = 'Choose valid GeoJSON.'; } };
const save = async () => {
  busy.value = true; error.value = '';
  try {
    const data = { title: title.value, attribution: attribution.value, style: JSON.parse(styleText.value), ...(upload.value ? { data: upload.value } : {}) };
    if (editing.value) await update(editing.value, data); else await request({ method: 'POST', url: base(), data });
    editing.value = null; upload.value = null; await load();
  } catch (e) { error.value = e.response?.data?.message || 'Layer could not be saved. Check the GeoJSON and style.'; } finally { busy.value = false; }
};
onMounted(load); watch(() => props.data, render); watch(() => props.projectId, load);
onBeforeUnmount(() => { generation += 1; if (map) map.remove(); });
</script>
<style>.analysis-map { height: 380px; border-radius: 8px; } .layer-swatch { display: inline-block; width: 18px; height: 12px; margin-right: 6px; } .reference-layer { padding: 12px 0; border-bottom: 1px solid #ddd; }</style>
