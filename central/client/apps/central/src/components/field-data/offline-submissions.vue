<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="offline-submissions" aria-labelledby="offline-submissions-title">
    <h2 id="offline-submissions-title">Encrypted XML submission queue</h2>
    <p>Export new submission XML files from Collect using a supported file provider. Save up to 10 files, 1 MB each and 5 MB total, encrypted for 24 hours. Prepare this page for offline use first. Browser storage can be cleared; export a copy for recovery.</p>
    <p>Upload XML first, then recover its referenced media above. This queue uses the original collector's current permission. Keep Collect from sending different XML for the same instance. Edited submissions are unsupported.</p>
    <fieldset :disabled="busy">
      <label>New submission XML files <input type="file" accept=".xml,application/xml,text/xml" multiple :disabled="!connected" @change="select"></label>
      <label>Submission queue passphrase <input v-model="passphrase" type="password" class="form-control" autocomplete="off" minlength="12" maxlength="128" :disabled="opened != null"></label>
      <div class="actions">
        <button type="button" class="btn btn-primary" :disabled="!selected.length || !connected" @click="save">Encrypt and save submissions</button>
        <button type="button" class="btn btn-default" :disabled="opened != null" @click="unlock">Unlock submission queue</button>
        <button type="button" class="btn btn-default" :disabled="!opened" @click="exportPackage">Export encrypted submissions</button>
      </div>
      <label>Import encrypted submissions <input type="file" accept=".fdsubmissions,application/json" :disabled="opened != null" @change="importPackage"></label>
    </fieldset>
    <p v-if="selected.length">{{ selected.length }} XML files selected. Saving replaces the previous queue only after successful encryption.</p>
    <template v-if="opened">
      <p>Project {{ opened.projectId }} · Collector {{ opened.actorId }} · Expires {{ new Date(opened.expiresAt).toLocaleString() }}. Keep the package locked when sharing this device.</p>
      <ul><li v-for="row of opened.items" :key="row.instanceId">
        {{ row.xmlFormId }} · {{ row.instanceId }} · {{ row.delivered ? 'XML accepted; media may still be missing' : 'Pending' }}
        <label v-if="!row.delivered">Submission priority <select v-model.number="row.priority" :disabled="busy" class="form-control"><option :value="1">High</option><option :value="2">Normal</option><option :value="3">Low</option></select></label>
      </li></ul>
    </template>
    <div class="actions">
      <button type="button" class="btn btn-primary" :disabled="busy || !canUpload || automatic" @click="upload()">Upload queued XML now</button>
      <button type="button" class="btn btn-default" :disabled="!busy || !uploading" @click="pause">Pause after current XML</button>
      <button type="button" class="btn btn-default" @click="lock">Lock submission queue</button>
      <button type="button" class="btn btn-default" :disabled="busy" @click="remove">Delete saved submissions</button>
    </div>
    <label><input type="checkbox" :checked="automatic" :disabled="!automatic && (busy || !canUpload)" @change="toggleSync"> Automatically sync unlocked XML while this page is open</label>
    <p>Automatic sync is optional and ends on pause, lock, logout, reload or expiry. This page must remain open; mobile browsers may suspend it. Media recovery remains separate.</p>
    <p v-if="syncMessage" role="status">{{ syncMessage }}</p>
    <p v-if="opened && connected && !sameCollector" role="alert">Reconnect as the original collector in the saved project before uploading.</p>
    <p v-if="message" role="status">{{ message }}</p><p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>
<script setup>
/* eslint-disable no-await-in-loop */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { submissionRetryDelay } from '../../util/submission-sync';
import { decryptSubmissions, encryptSubmissions, prepareSubmissions, storedSubmissions } from '../../util/offline-submissions';

defineOptions({ name: 'FieldDataOfflineSubmissions' });
const props = defineProps({ connected: Boolean, sessionId: { type: Number, required: true }, identity: { type: Object, required: true }, send: { type: Function, required: true } });
const selected = ref([]); const opened = ref(null); const passphrase = ref(''); const busy = ref(false); const uploading = ref(false); const paused = ref(false); const message = ref(''); const error = ref('');
const automatic = ref(false); const syncMessage = ref('');
let generation = 0; let expiryTimer; let retryTimer; let retryAt = 0; let retryCount = 0;
const stopSync = (status = '') => { automatic.value = false; clearTimeout(retryTimer); retryTimer = null; retryAt = 0; retryCount = 0; syncMessage.value = status; };
const pause = () => { paused.value = true; stopSync('Automatic sync paused. An in-flight XML request may still finish.'); };
const sameCollector = computed(() => opened.value?.actorId === props.identity.actorId && opened.value?.projectId === props.identity.projectId);
const canUpload = computed(() => props.connected && sameCollector.value && opened.value?.items.some(row => !row.delivered));
const lock = () => {
  stopSync(); generation += 1; clearTimeout(expiryTimer); selected.value = []; opened.value = null; passphrase.value = ''; busy.value = false; uploading.value = false; paused.value = true; error.value = ''; message.value = 'Submission queue locked. The encrypted saved copy remains.';
};
watch(() => props.sessionId, lock); onBeforeUnmount(lock);
const perform = async (action, onFailure = null) => {
  if (busy.value) return;
  const current = generation; const isCurrent = () => generation === current;
  busy.value = true; error.value = ''; message.value = '';
  try { await action(isCurrent); } catch (failure) {
    if (isCurrent()) {
      if (onFailure) onFailure(failure);
      error.value = failure.status === 409 ? 'The server has different XML for this instance. Keep this package and ask your supervisor to resolve the conflict.' : 'Submission operation stopped. Check access, connectivity, passphrase, package expiry and storage. Retained XML can be retried with exactly the same bytes.';
    }
  } finally { if (isCurrent()) { busy.value = false; uploading.value = false; if (!opened.value) passphrase.value = ''; } }
};
const show = data => { opened.value = data; clearTimeout(expiryTimer); expiryTimer = setTimeout(lock, Math.max(0, data.expiresAt - Date.now())); };
const persist = async (data, isCurrent) => {
  const record = await encryptSubmissions(data, passphrase.value);
  if (isCurrent()) await storedSubmissions('write', record, isCurrent);
};
const select = event => { selected.value = Array.from(event.target.files ?? []); event.target.value = ''; };
const save = () => perform(async isCurrent => {
  stopSync();
  const data = await prepareSubmissions(selected.value, props.identity);
  await persist(data, isCurrent);
  if (isCurrent()) { selected.value = []; show(data); message.value = 'Encrypted submissions saved. Nothing has been uploaded.'; }
});
const unlock = () => perform(async isCurrent => {
  const record = await storedSubmissions('read', null, isCurrent); const data = await decryptSubmissions(record, passphrase.value);
  if (isCurrent()) { show(data); message.value = 'Queue unlocked. Upload requires the original collector and your explicit action.'; }
});
const importPackage = event => {
  const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
  perform(async isCurrent => {
    if (!file.size || file.size > 12 * 1024 * 1024) throw new Error('Package exceeds limit');
    const record = JSON.parse(await file.text()); const data = await decryptSubmissions(record, passphrase.value);
    if (!isCurrent()) return;
    await storedSubmissions('write', record, isCurrent);
    if (isCurrent()) { show(data); message.value = 'Encrypted submissions imported. Nothing has been uploaded.'; }
  });
};
const exportPackage = () => perform(async isCurrent => {
  await persist(opened.value, isCurrent); if (!isCurrent()) return;
  const record = await storedSubmissions('read', null, isCurrent); if (!isCurrent()) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(record)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'field-data-submissions.fdsubmissions'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  message.value = 'Encrypted submissions exported. Share the passphrase separately.';
});
const upload = (onFailure = null) => perform(async isCurrent => {
  if (!canUpload.value) return;
  uploading.value = true; paused.value = false;
  // Persist priority changes before sending; expiry never extends on retry/save.
  await persist(opened.value, isCurrent);
  const pending = opened.value?.items.filter(row => !row.delivered).sort((a, b) => a.priority - b.priority) ?? [];
  for (const row of pending) {
    if (!isCurrent() || paused.value || !props.connected || !sameCollector.value) return;
    const data = opened.value;
    if (data.expiresAt <= Date.now()) { lock(); return; }
    await props.send(data.projectId, row);
    if (!isCurrent()) return;
    // Commit acknowledgement only after its encrypted checkpoint is durable.
    const next = { ...data, items: data.items.map(item => item === row ? { ...item, delivered: true } : item) };
    await persist(next, isCurrent);
    if (!isCurrent()) return;
    show(next); message.value = 'XML accepted. Recover referenced media separately; receipt history can be checked after refresh.';
  }
}, onFailure);
const runSync = async () => {
  if (!automatic.value) return;
  if (busy.value) { retryTimer = setTimeout(runSync, 1000); return; }
  if (!canUpload.value) { stopSync('Automatic sync finished or its collector session is unavailable.'); return; }
  if (Date.now() < retryAt) { retryTimer = setTimeout(runSync, retryAt - Date.now()); return; }
  if (!navigator.onLine) { syncMessage.value = 'Automatic sync is waiting for connectivity.'; return; }
  const current = generation;
  let failure = null;
  syncMessage.value = 'Automatically synchronizing queued XML…';
  await upload(errorValue => { failure = errorValue; });
  if (!automatic.value || current !== generation) return;
  if (!failure) { stopSync('Automatic XML sync finished. Referenced media may still be missing.'); return; }
  const delay = submissionRetryDelay(failure, retryCount);
  if (delay == null) { stopSync('Automatic sync stopped. Resolve the error, then explicitly enable it again.'); return; }
  retryCount += 1; retryAt = Date.now() + delay;
  syncMessage.value = `Automatic sync retry ${retryCount} of 5 is scheduled for ${new Date(retryAt).toLocaleTimeString()}.`;
  retryTimer = setTimeout(runSync, delay);
};
const toggleSync = event => {
  if (!event.target.checked) { pause(); return; }
  if (busy.value || !canUpload.value) return;
  stopSync(); automatic.value = true; paused.value = false; runSync();
};
const online = () => {
  if (!automatic.value || busy.value) return;
  clearTimeout(retryTimer); retryTimer = null; runSync();
};
onMounted(() => window.addEventListener('online', online));
onBeforeUnmount(() => window.removeEventListener('online', online));
watch(sameCollector, value => { if (!value) pause(); });
const remove = () => perform(async isCurrent => {
  await storedSubmissions('delete', null, isCurrent);
  if (isCurrent()) { lock(); message.value = 'Saved submissions deleted. Server submissions remain.'; }
});
</script>
<style scoped>
.offline-submissions { margin-top: 24px; padding: 24px; background: #fff; border: 1px solid #d9e5e9; border-radius: 12px; }
fieldset { display: grid; gap: 12px; } label { display: block; } .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
p, li, label, button { overflow-wrap: anywhere; } .btn { max-width: 100%; white-space: normal; min-height: 44px; } input, select { max-width: 100%; }
@media (max-width: 480px) { .offline-submissions { padding: 16px; } }
</style>
