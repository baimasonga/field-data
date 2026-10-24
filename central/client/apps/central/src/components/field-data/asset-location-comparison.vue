<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="asset-location-comparison" aria-label="Recorded asset location comparison">
    <form @submit.prevent="load">
      <label>Location fact name <input v-model="predicate" class="form-control" required maxlength="100" @input="clear"></label>
      <p>Choose the exact recorded fact name. Values must use latitude longitude, optionally altitude and reported accuracy in metres. This compares recorded facts, not verified asset positions.</p>
      <button type="submit" class="btn btn-default" :disabled="busy || !predicate.trim()">Compare recorded locations</button>
    </form>
    <p v-if="error" role="alert">Location comparison could not be loaded. Check access to both assets and all their evidence sources, then retry.</p>
    <template v-if="result">
      <p v-if="result.distanceMetres != null" role="status">Straight-line separation: {{ Math.round(result.distanceMetres) }} metres.</p>
      <p v-else role="status">Distance withheld: both latest applicable facts must be fresh, source-verified and parseable.</p>
      <p v-if="result.reportedAccuracyRangeMetres">Range using the two reported accuracy radii: {{ Math.floor(result.reportedAccuracyRangeMetres.minimum) }}–{{ Math.ceil(result.reportedAccuracyRangeMetres.maximum) }} metres. Device estimates are not confidence bounds.</p>
      <p v-else-if="result.distanceMetres != null">Reported accuracy is incomplete; no accuracy range is available.</p>
      <ul><li v-for="(side, index) in [result.a, result.b]" :key="index">
        {{ index === 0 ? aName : bName }}: {{ side.status }}
        <template v-if="side.citation"> · <a :href="side.citation.sourceUrl" target="_blank" rel="noopener">Source claim</a> · observation {{ side.citation.observationId }} · valid from {{ side.citation.validFrom }} · recorded {{ side.citation.recordedAt }} · freshness {{ side.citation.freshness }}</template>
      </li></ul>
      <p>Facts may describe different visit times or reference points. Nearness does not prove the same asset; separation does not prove different assets. Check source context before deciding.</p>
    </template>
  </section>
</template>
<script setup>
import { onBeforeUnmount, ref } from 'vue';
import useRequest from '../../composables/request';
defineOptions({ name: 'FieldDataAssetLocationComparison' });
const props = defineProps({ projectId: { type: [String, Number], required: true }, aId: { type: String, required: true }, bId: { type: String, required: true }, aName: { type: String, required: true }, bName: { type: String, required: true } });
const { request } = useRequest(); const predicate = ref('location'); const result = ref(null); const error = ref(false); const busy = ref(false); let generation = 0;
const clear = () => { generation += 1; result.value = null; error.value = false; busy.value = false; };
const load = async () => {
  clear(); const current = generation; busy.value = true;
  try {
    const { data } = await request({ method: 'GET', url: `/v1/field-data/projects/${encodeURIComponent(props.projectId)}/assets/${props.aId}/location-comparison/${props.bId}`, params: { predicate: predicate.value.trim() }, alert: false });
    if (data?.method !== 'asset-recorded-location@1' || data.predicate !== predicate.value.trim() || !data.a || !data.b || (data.distanceMetres !== null && (!Number.isFinite(data.distanceMetres) || data.distanceMetres < 0))) throw new Error();
    for (const side of [data.a, data.b]) {
      if (typeof side.status !== 'string' || (side.citation && !/^\/v1\/field-data\/claim-versions\/[0-9a-f-]{36}$/i.test(side.citation.sourceUrl))) throw new Error();
    }
    const range = data.reportedAccuracyRangeMetres;
    if (range != null && (!Number.isFinite(range.minimum) || !Number.isFinite(range.maximum) || range.minimum < 0 || range.maximum < range.minimum)) throw new Error();
    if (current === generation) result.value = data;
  } catch { if (current === generation) error.value = true; } finally { if (current === generation) busy.value = false; }
};
onBeforeUnmount(clear);
</script>
<style scoped>
.asset-location-comparison { margin: 12px 0; overflow-wrap: anywhere; }
</style>
