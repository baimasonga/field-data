<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section aria-label="Cited asset map">
    <p>Web Mercator display; WGS84 asset locations from cited fresh facts. Polygon membership uses the reported point; boundary flags use its reported accuracy. Missing accuracy is not certainty.</p>
    <div class="map-actions"><button type="button" class="btn btn-default" @click="fit">Fit asset points and areas</button><button type="button" class="btn btn-default" @click="step(-1)">Previous asset</button><button type="button" class="btn btn-default" @click="step(1)">Next asset</button><label><input v-model="interactive" type="checkbox" @change="setInteraction">Enable map dragging</label></div>
    <label><input v-model="useBackground" type="checkbox" @change="toggleBackground">Load OpenStreetMap background (external tile requests)</label><p v-if="backgroundFailed" role="status">Background tiles unavailable. Cited asset points and area boundaries remain visible; toggle the background to retry.</p>
    <div ref="mapEl" class="knowledge-map" aria-label="Asset coordinate map"></div>
    <p>The coordinate canvas works without tiles. OpenStreetMap tiles are optional and attributed; enabling them sends map-tile requests, without project paths or answer text. Named boundaries are supplied by the project. Co-located assets remain selectable in the table and with Previous/Next.</p>
    <p v-if="geography.areas.some(polarArea)">Polar boundary coordinates are outside Web Mercator display; classification and exported WGS84 geometry remain available.</p>
    <p v-if="polarCount">{{ polarCount }} polar locations are outside the map projection and remain available in the coordinate table/export.</p>
    <p v-if="!geography.features.length" role="status">No usable location facts. {{ geography.unavailable.length }} assets have unavailable or stale locations.</p>
    <p v-if="selected" role="status">Selected: {{ selected.properties.name }} · {{ selected.properties.area }} · reported accuracy {{ selected.properties.reportedAccuracyM ?? 'unknown' }} m · {{ selected.properties.boundaryUncertain ? 'boundary uncertain' : selected.properties.accuracyKnown ? 'no boundary intersection within reported radius' : 'boundary uncertainty unavailable' }}. <button type="button" class="btn btn-link" @click="emit('open', { assetId: selected.properties.assetId, xmlFormId: selected.properties.xmlFormId })">Open selected asset passport</button> <a :href="selected.properties.source.url" target="_blank" rel="noopener">Source claim</a></p>
    <div class="fd-table-scroll" role="region" aria-label="Asset coordinates table" tabindex="0">
<table class="table">
<thead><tr><th>Asset</th><th>Longitude</th><th>Latitude</th><th>Area</th><th>Accuracy / boundary</th></tr></thead><tbody>
      <tr v-for="feature of geography.features" :key="feature.properties.assetId"><td><button type="button" class="btn btn-link" @click="choose(feature)">{{ feature.properties.name }}</button></td><td>{{ feature.geometry.coordinates[0] }}</td><td>{{ feature.geometry.coordinates[1] }}</td><td>{{ feature.properties.area }}</td><td>{{ feature.properties.reportedAccuracyM ?? 'unknown' }} m · {{ feature.properties.boundaryUncertain ? 'uncertain' : feature.properties.accuracyKnown ? 'outside reported radius' : 'unknown' }}</td></tr>
    </tbody>
</table>
</div>
    <p v-for="(count, area) in geography.counts" :key="area">{{ area }}: {{ count }} assets.</p>
  </section>
</template>
<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { addBasemap } from '../../util/basemap';

defineOptions({ name: 'KnowledgeMap' });
const emit = defineEmits(['open']);
const props = defineProps({ geography: { type: Object, required: true } });
const polarArea = area => area.geometry.coordinates.flat(Infinity).some((value, i) => i % 2 === 1 && Math.abs(value) > 85.05112878);
const polarCount = computed(() => props.geography.features.filter(feature => Math.abs(feature.geometry.coordinates[1]) > 85.05112878).length);
const mapEl = ref(null); const selected = ref(null); const interactive = ref(false); let map; let layer; let markerLayer; let accuracyLayer; let background; let observer; const useBackground = ref(false); const backgroundFailed = ref(false);
const toggleBackground = () => { background?.remove(); background = null; backgroundFailed.value = false; if (useBackground.value && map) background = addBasemap(map, () => { backgroundFailed.value = true; useBackground.value = false; }); };
const fit = () => { if (!map || !layer) return; const bounds = layer.getBounds(); if (bounds.isValid()) map.fitBounds(bounds.pad(0.1), { maxZoom: 16 }); else map.setView([0, 0], 2); };
const choose = feature => { selected.value = feature; if (map && Math.abs(feature.geometry.coordinates[1]) <= 85.05112878) map.setView([feature.geometry.coordinates[1], feature.geometry.coordinates[0]], Math.max(map.getZoom(), 12)); };
const step = delta => { const items = props.geography.features; if (!items.length) return; const index = items.findIndex(feature => feature.properties.assetId === selected.value?.properties.assetId); choose(items[(index + delta + items.length) % items.length]); };
const setInteraction = () => { if (interactive.value) map?.dragging.enable(); else map?.dragging.disable(); };
const render = () => {
  if (!map) return; selected.value = null; if (layer) layer.remove(); if (markerLayer) markerLayer.remove(); if (accuracyLayer) accuracyLayer.remove();
  layer = L.geoJSON({ type: 'FeatureCollection', features: props.geography.areas.filter(area => !polarArea(area)).map(area => ({ type: 'Feature', geometry: area.geometry, properties: { name: area.value } })) }, { style: { color: '#52606d', weight: 2, fillOpacity: 0.05 } }).addTo(map);
  markerLayer = L.geoJSON({ type: 'FeatureCollection', features: props.geography.features.filter(feature => Math.abs(feature.geometry.coordinates[1]) <= 85.05112878) }, { pointToLayer: (_, point) => L.circleMarker(point, { radius: 5, color: '#153e75', fillColor: '#2b6cb0', fillOpacity: 0.7, weight: 1 }), onEachFeature: (feature, marker) => marker.on('click', () => choose(feature)) }).addTo(map);
  accuracyLayer = L.featureGroup(props.geography.features.filter(feature => feature.properties.reportedAccuracyM != null && Math.abs(feature.geometry.coordinates[1]) <= 85.05112878).map(feature => L.circle([feature.geometry.coordinates[1], feature.geometry.coordinates[0]], { radius: feature.properties.reportedAccuracyM, color: '#718096', weight: 1, fillOpacity: 0.03, interactive: false }))).addTo(map);
  for (const marker of markerLayer.getLayers()) layer.addLayer(marker); fit();
};
onMounted(() => { map = L.map(mapEl.value, { scrollWheelZoom: false, dragging: false, zoomControl: true }).setView([0, 0], 2); render(); observer = new ResizeObserver(() => map?.invalidateSize({ animate: false })); observer.observe(mapEl.value); });
watch(() => props.geography, render);
onBeforeUnmount(() => { observer?.disconnect(); map?.remove(); map = null; });
</script>
<style scoped>
.knowledge-map { height: 380px; background: #f4f7fa; border: 1px solid #bcccdc; }
.fd-table-scroll { overflow-x: auto; max-width: 100%; }
.fd-table-scroll table { min-width: 640px; }
.map-actions .btn { min-height: 44px; }
.map-actions { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0; }
@media (max-width: 600px) { .knowledge-map { height: 300px; } }
</style>
