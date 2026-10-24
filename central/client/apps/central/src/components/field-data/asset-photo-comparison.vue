<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="asset-photo-comparison" aria-label="Referenced asset photo comparison">
    <form @submit.prevent="load">
      <label>Photo fact name <input v-model="predicate" class="form-control" required maxlength="100" @input="clear"></label>
      <p>Choose the exact fact name whose value names a PNG or JPEG attachment in its cited submission version. Images are loaded only when you request comparison.</p>
      <button type="submit" class="btn btn-default" :disabled="busy || !predicate.trim()">Compare referenced photos</button>
    </form>
    <p v-if="error" role="alert">Photo comparison could not be loaded or verified. Check access to both assets and their sources, then retry.</p>
    <template v-if="result">
      <p>Attachment snapshot checked at {{ result.checkedAt }}.</p>
      <p role="status">{{ result.identicalBytes === null ? 'Photo byte comparison unavailable.' : result.identicalBytes ? 'The two retained files have identical bytes.' : 'The two retained files have different bytes.' }}</p>
      <div class="photos"><figure v-for="(side, index) in [result.a, result.b]" :key="index">
        <figcaption>{{ index === 0 ? aName : bName }}: {{ side.status }}</figcaption>
        <img v-if="side.url" :src="side.url" :alt="`${index === 0 ? aName : bName}: ${side.photo.name}`" @error="failedPreview(side.url)">
        <p v-if="side.photo">{{ side.photo.name }} · SHA-256 <code>{{ side.photo.sha256 }}</code></p>
        <p v-if="side.citation"><a :href="side.citation.sourceUrl" target="_blank" rel="noopener">Source claim</a> · observation {{ side.citation.observationId }} · valid from {{ side.citation.validFrom }} · recorded {{ side.citation.recordedAt }} · freshness {{ side.citation.freshness }}</p>
      </figure></div>
      <p>These are the attachment bytes retained when this comparison was checked. File equality does not prove asset identity, capture time, presence or truth. Different files may show the same asset; identical files may have been reused. Inspect context and source history before deciding.</p>
    </template>
  </section>
</template>
<script setup>
import { onBeforeUnmount, ref } from 'vue';
import useRequest from '../../composables/request';
defineOptions({ name: 'FieldDataAssetPhotoComparison' });
const props = defineProps({ projectId: { type: [String, Number], required: true }, aId: { type: String, required: true }, bId: { type: String, required: true }, aName: { type: String, required: true }, bName: { type: String, required: true } });
const { request } = useRequest(); const predicate = ref('photo'); const result = ref(null); const error = ref(false); const busy = ref(false); let generation = 0; let urls = [];
const clear = () => { generation += 1; urls.forEach(url => URL.revokeObjectURL(url)); urls = []; result.value = null; error.value = false; busy.value = false; };
const failedImage = () => { clear(); error.value = true; };
const failedPreview = url => { if (urls.includes(url)) failedImage(); };
const verify = async side => {
  if (!side || typeof side.status !== 'string' || (side.citation && !/^\/v1\/field-data\/claim-versions\/[0-9a-f-]{36}$/i.test(side.citation.sourceUrl))) throw new Error();
  if (side.status !== 'usable') { if (side.photo) throw new Error(); return { side, bytes: null }; }
  const item = side.photo;
  if (!item || !['image/png', 'image/jpeg'].includes(item.contentType) || !Number.isInteger(item.size) || item.size < 1 || item.size > 5 * 1024 * 1024 || typeof item.base64 !== 'string' || item.base64.length > 6990508 || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error();
  const bytes = Uint8Array.from(atob(item.base64), c => c.charCodeAt(0));
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  if (bytes.length !== item.size || hash !== item.sha256) throw new Error();
  const { base64, ...photo } = item;
  return { side: { ...side, photo }, bytes };
};
const load = async () => {
  clear(); const current = generation; busy.value = true;
  try {
    const { data } = await request({ method: 'GET', url: `/v1/field-data/projects/${encodeURIComponent(props.projectId)}/assets/${props.aId}/photo-comparison/${props.bId}`, params: { predicate: predicate.value.trim() }, alert: false });
    if (data?.method !== 'asset-referenced-photo@1' || !Number.isFinite(Date.parse(data.checkedAt)) || data.predicate !== predicate.value.trim()) throw new Error();
    const checked = await Promise.all([data.a, data.b].map(verify));
    if (current !== generation) return;
    const sides = checked.map(({ side, bytes }) => { if (!bytes) return side; const url = URL.createObjectURL(new Blob([bytes], { type: side.photo.contentType })); urls.push(url); return { ...side, url }; });
    result.value = { checkedAt: data.checkedAt, a: sides[0], b: sides[1], identicalBytes: checked.every(item => item.bytes) ? sides[0].photo.sha256 === sides[1].photo.sha256 : null };
  } catch { if (current === generation) failedImage(); } finally { if (current === generation) busy.value = false; }
};
onBeforeUnmount(clear);
</script>
<style scoped>
.asset-photo-comparison { margin: 12px 0; overflow-wrap: anywhere; }
.photos { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
figure { margin: 0; min-width: 0; } img { max-width: 100%; max-height: 400px; object-fit: contain; }
@media (max-width: 600px) { .photos { grid-template-columns: 1fr; } }
</style>
