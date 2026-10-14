<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="offline-media" aria-labelledby="offline-media-title">
    <h2 id="offline-media-title">Encrypted offline media</h2>
    <p>Keep up to 10 files and 20 MB in an encrypted package for 24 hours. Prepare this page for offline use before leaving connectivity. Browser storage may be cleared by the device; export a copy if needed.</p>
    <p>To preserve a challenged camera photo, use Prepare queue for encrypted storage above, then explicitly encrypt it here. Its challenge still expires after 20 minutes; package storage does not extend the upload deadline.</p>
    <p>One package is saved per browser. A successful save or import replaces it. Expiry follows this device's clock; use Delete saved media to remove the encrypted copy.</p>
    <p>A courier can carry the encrypted file. Share the passphrase separately with an authorized collector. Upload requires the original collector's App User access and submission XML already synced. Encryption verifies stored bytes, not the capture or the courier's identity.</p>
    <fieldset :disabled="busy">
      <label>Offline media form ID <input v-model.trim="xmlFormId" class="form-control" maxlength="1000"></label>
      <label>Offline media submission instance ID <input v-model.trim="instanceId" class="form-control" maxlength="1000"></label>
      <label>Files to protect <input type="file" multiple accept="image/*,audio/*,video/*" @change="selectFiles"></label>
      <label>Media package passphrase <input v-model="passphrase" type="password" class="form-control" minlength="12" maxlength="128" autocomplete="off"></label>
      <ul v-if="selected.length"><li v-for="row of selected" :key="`${row.xmlFormId}/${row.instanceId}/${row.file.name}`">Selected: {{ row.file.name }} · {{ row.xmlFormId }} · {{ row.instanceId }}<span v-if="row.challengeId"> · Challenge {{ row.challengeNonce.slice(0, 8).toUpperCase() }} expires {{ new Date(row.challengeExpiresAt).toLocaleString() }}{{ row.captureLocation ? ' · Includes device-reported location' : '' }}</span></li></ul>
      <div class="actions">
        <button type="button" class="btn btn-primary" :disabled="!selected.length" @click="save">Encrypt and save files</button>
        <button type="button" class="btn btn-default" @click="unlock">Unlock saved media</button>
        <button type="button" class="btn btn-default" @click="exportPackage">Export encrypted package</button>
      </div>
      <label>Import encrypted media package <input type="file" accept=".fdmedia,application/json" @change="importPackage"></label>
    </fieldset>
    <div class="actions">
      <button type="button" class="btn btn-default" @click="lock">Lock and clear open files</button>
      <button type="button" class="btn btn-default" :disabled="busy" @click="remove">Delete saved media</button>
      <button type="button" class="btn btn-primary" :disabled="busy || !connected || !opened.length" @click="restore">Add unlocked files to upload queue</button>
    </div>
    <p v-if="busy || message" role="status">{{ busy ? 'Working on the encrypted package…' : message }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="opened.length">
      <p>Unlocked until {{ new Date(expiresAt).toLocaleString() }}. Lock this package before sharing the device.</p>
      <ul><li v-for="row of opened" :key="`${row.xmlFormId}/${row.instanceId}/${row.file.name}`">{{ row.file.name }} · {{ row.xmlFormId }} · {{ Math.ceil(row.file.size / 1024) }} KB<span v-if="row.challengeId"> · Challenge {{ row.challengeNonce.slice(0, 8).toUpperCase() }} expires {{ new Date(row.challengeExpiresAt).toLocaleString() }}{{ row.captureLocation ? ' · Includes device-reported location' : '' }}</span></li></ul>
    </template>
  </section>
</template>
<script setup>
import { onBeforeUnmount, ref, watch } from 'vue';
import { ARCHIVE_LIMIT, challengeContext, decryptMedia, encryptMedia, storedMedia } from '../../util/offline-media';

defineOptions({ name: 'FieldDataOfflineMedia' });
const props = defineProps({ connected: Boolean, sessionId: { type: Number, required: true } });
const emit = defineEmits(['restore']);
const xmlFormId = ref(''); const instanceId = ref(''); const selected = ref([]); const opened = ref([]);
const passphrase = ref(''); const busy = ref(false); const message = ref(''); const error = ref(''); const expiresAt = ref(0);
let generation = 0; let expiryTimer;
const lock = () => {
  generation += 1; clearTimeout(expiryTimer); selected.value = []; opened.value = []; passphrase.value = '';
  xmlFormId.value = ''; instanceId.value = ''; expiresAt.value = 0; busy.value = false; error.value = ''; message.value = 'Media locked. The encrypted saved copy remains.';
};
watch(() => props.sessionId, lock);
onBeforeUnmount(lock);
const perform = async action => {
  if (busy.value) return;
  const current = generation; busy.value = true; error.value = ''; message.value = '';
  const isCurrent = () => current === generation;
  try { await action(isCurrent); } catch (failure) {
    if (isCurrent()) error.value = 'Unable to open or save media. Check the passphrase, package expiry, file limits and available storage. The previous saved package is unchanged.';
  } finally { if (isCurrent()) { busy.value = false; passphrase.value = ''; } }
};
const show = data => {
  clearTimeout(expiryTimer); opened.value = data.items; expiresAt.value = data.expiresAt;
  expiryTimer = setTimeout(lock, Math.max(0, data.expiresAt - Date.now()));
};
const selectFiles = event => {
  const input = event.target; const files = Array.from(input.files ?? []); input.value = '';
  selected.value = files.map(file => ({ file, xmlFormId: xmlFormId.value, instanceId: instanceId.value, priority: file.size > 1024 * 1024 ? 3 : 2 }));
  message.value = `${files.length} files selected for encryption.`;
};
const stageFiles = rows => {
  if (busy.value || !props.connected) return;
  selected.value = rows.map(row => ({ file: row.file, xmlFormId: row.xmlFormId, instanceId: row.instanceId, priority: row.priority, ...challengeContext(row) }));
  message.value = 'Queue selected for encryption. The previous saved package remains until you explicitly encrypt and save these files.';
};
defineExpose({ stageFiles });
const save = () => perform(async isCurrent => {
  const record = await encryptMedia(selected.value, passphrase.value);
  if (!isCurrent()) return;
  await storedMedia('write', record, isCurrent);
  if (isCurrent()) { selected.value = []; opened.value = []; clearTimeout(expiryTimer); message.value = 'Encrypted media saved. Unlock to inspect or restore it.'; }
});
const unlock = () => perform(async isCurrent => {
  const record = await storedMedia('read', null, isCurrent);
  const data = await decryptMedia(record, passphrase.value);
  if (isCurrent()) { show(data); message.value = 'Media unlocked. Nothing has been uploaded.'; }
});
const importPackage = event => {
  const input = event.target; const file = input.files?.[0]; input.value = '';
  if (file == null) return;
  perform(async isCurrent => {
    if (!file.size || file.size > ARCHIVE_LIMIT) throw new Error('Archive exceeds its limit');
    const record = JSON.parse(await file.text());
    if (!isCurrent()) return;
    const data = await decryptMedia(record, passphrase.value);
    if (!isCurrent()) return;
    // Only a completely decrypted, validated package may replace the saved copy.
    await storedMedia('write', record, isCurrent);
    if (isCurrent()) { show(data); message.value = 'Encrypted package imported. Nothing has been uploaded.'; }
  });
};
const exportPackage = () => perform(async isCurrent => {
  const record = await storedMedia('read', null, isCurrent);
  // Require successful unlock to avoid exporting an expired or corrupt archive.
  await decryptMedia(record, passphrase.value);
  if (!isCurrent()) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(record)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'field-data-media.fdmedia'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  message.value = 'Encrypted package exported. Share its passphrase separately.';
});
const remove = () => perform(async isCurrent => {
  await storedMedia('delete', null, isCurrent);
  if (isCurrent()) { lock(); message.value = 'Saved media deleted. Server attachments are unchanged.'; }
});
const restore = () => {
  if (busy.value || !props.connected || !opened.value.length) return;
  if (expiresAt.value <= Date.now()) { lock(); return; }
  if (opened.value.some(row => row.challengeId && Date.parse(row.challengeExpiresAt) <= Date.now())) { error.value = 'A capture challenge expired. Its image remains in the encrypted package, but it cannot be restored for challenged upload. Start a new challenge and photo; the server enforces the original deadline.'; return; }
  emit('restore', opened.value);
};
</script>
<style scoped>
.offline-media { margin-top: 24px; padding: 24px; background: #fff; border: 1px solid #d9e5e9; border-radius: 12px; }
fieldset { display: grid; gap: 12px; } label { display: block; } .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
p, li, label, button { overflow-wrap: anywhere; } .btn { max-width: 100%; white-space: normal; } input { max-width: 100%; }
@media (max-width: 480px) { .offline-media { padding: 16px; } }
</style>
