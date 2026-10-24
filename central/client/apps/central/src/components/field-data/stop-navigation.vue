<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <div class="stop-navigation">
    <button type="button" class="btn btn-default" :disabled="busy" @click="prepare">{{ data == null ? 'Check stop for navigation' : 'Recheck navigation' }}</button>
    <p v-if="busy" role="status">Checking this approved stop…</p>
    <p v-if="error" role="alert">This stop could not be verified. Refresh your itinerary or retry; it may no longer be assigned or available.</p>
    <p v-if="expired" role="status">Navigation check expired. Recheck this stop before opening a map provider.</p>
    <template v-if="data && !expired">
      <p>Destination checked at <record-date-time :value="data.checkedAt"/>. Opening a link shares these coordinates with that provider. Your Field Data key and task details are not included.</p>
      <ul><li v-for="target of targets" :key="target.id"><a :href="target.url" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" @click="checkExpiry">{{ target.label }}</a></li></ul>
      <p>Provider routes may differ from the approved stop order. Confirm road access and local conditions; this is a handoff to a map service, not offline or built-in turn-by-turn navigation.</p>
    </template>
  </div>
</template>
<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import RecordDateTime from '../record-date-time.vue';
defineOptions({ name: 'FieldDataStopNavigation' });
const props = defineProps({ load: { type: Function, required: true } });
const data = ref(null); const busy = ref(false); const error = ref(false); const clock = ref(performance.now()); const deadline = ref(0);
let timer = null;
let version = 0;
onBeforeUnmount(() => { version += 1; clearInterval(timer); });
const allowed = { 'google-maps': 'www.google.com', openstreetmap: 'www.openstreetmap.org' };
const safeTarget = target => {
  try { const url = new URL(target.url); return url.protocol === 'https:' && url.hostname === allowed[target.id] && !url.username && !url.password && !url.port; } catch { return false; }
};
const targets = computed(() => (data.value?.targets ?? []).filter(safeTarget));
const expired = computed(() => data.value != null && clock.value >= deadline.value);
const checkExpiry = event => { clock.value = performance.now(); if (expired.value) event.preventDefault(); };
const prepare = async () => {
  if (busy.value) return;
  clearInterval(timer); timer = null;
  const started = performance.now();
  const current = ++version; data.value = null; error.value = false; busy.value = true;
  try {
    const response = await props.load();
    if (!Array.isArray(response?.targets) || !response.targets.length || !response.targets.every(safeTarget) || !Number.isFinite(Date.parse(response.expiresAt)) ||
      !Number.isFinite(Date.parse(response.checkedAt)) || Date.parse(response.expiresAt) <= Date.parse(response.checkedAt) || Date.parse(response.expiresAt) - Date.parse(response.checkedAt) > 60000) throw new Error('Invalid navigation response');
    if (current === version) {
      clock.value = performance.now(); deadline.value = started + (Date.parse(response.expiresAt) - Date.parse(response.checkedAt)); data.value = response;
      if (clock.value < deadline.value) timer = setInterval(() => {
        clock.value = performance.now();
        if (clock.value >= deadline.value) { clearInterval(timer); timer = null; }
      }, 1000);
    }
  } catch { if (current === version) error.value = true; }
  finally { if (current === version) busy.value = false; }
};
</script>
<style scoped>
.stop-navigation { margin-top: 12px; overflow-wrap: anywhere; }
ul { padding-left: 20px; }
</style>
