<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <fieldset class="sampling-polygon-areas">
    <legend>Geographic sampling areas</legend>
    <p>Upload a GeoJSON FeatureCollection with a distinct name property for each Polygon or MultiPolygon. Coordinates must be WGS84 longitude, latitude. Up to 20 areas, 2000 vertices and 64 KiB. Holes are supported; self-intersections and antimeridian crossings are unavailable.</p>
    <label>Sampling areas GeoJSON
      <input type="file" accept=".json,.geojson,application/json,application/geo+json" @change="upload">
    </label>
    <p v-if="loading" role="status">Reading sampling areas…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <ul v-if="modelValue.length"><li v-for="area of modelValue" :key="area.value">{{ area.value }}</li></ul>
    <p>Points on an area boundary belong to it. Points in more than one area use Overlapping areas; other points use Outside areas. Missing answers remain separate. Uses device-reported coordinates without an accuracy buffer or a claim of verified presence. Invalid location answers stop the draw. The polygons and group memberships are retained in sample history; raw coordinates are not added to it.</p>
  </fieldset>
</template>
<script setup>
import { onBeforeUnmount, ref } from 'vue';
defineOptions({ name: 'SamplingPolygonAreas' });
defineProps({ modelValue: { type: Array, required: true } });
const emit = defineEmits(['update:modelValue']);
const error = ref(''); const loading = ref(false);
let version = 0;
onBeforeUnmount(() => { version += 1; });
const upload = async event => {
  const current = ++version; const file = event.target.files?.[0];
  error.value = ''; emit('update:modelValue', []);
  if (!file) { loading.value = false; return; }
  loading.value = true;
  try {
    if (file.size > 65536) throw new Error('Use a GeoJSON file no larger than 64 KiB.');
    const data = JSON.parse(await file.text());
    if (data?.type !== 'FeatureCollection' || data.crs != null || !Array.isArray(data.features) || !data.features.length || data.features.length > 20 ||
      data.features.some(feature => feature.type !== 'Feature' || typeof feature.properties?.name !== 'string' || !['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)))
      throw new Error('Use 1–20 named Polygon or MultiPolygon features without a CRS declaration. Each feature needs a name property.');
    if (current === version) emit('update:modelValue', data.features.map(feature => ({ value: feature.properties.name, geometry: { type: feature.geometry.type, coordinates: feature.geometry.coordinates } })));
  } catch (e) { if (current === version) error.value = e instanceof SyntaxError ? 'This file is not valid GeoJSON JSON. Choose another file.' : e.message; }
  finally { if (current === version) loading.value = false; }
};
</script>
<style lang="scss">
.sampling-polygon-areas { width: 100%; min-width: 0; legend { font-size: 15px; margin-bottom: 6px; } input { max-width: 100%; } }
</style>
