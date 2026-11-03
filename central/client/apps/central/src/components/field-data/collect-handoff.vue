<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="collect-handoff" aria-labelledby="collect-handoff-title">
    <h2 id="collect-handoff-title">Collect instance handoff</h2>
    <p>Choose one finalized instance folder exported through an Android-supported file provider, or select its files together. Review them before binding this package to the connected collector. Fieldwork preserves the files and uses the native OpenRosa submission endpoint. Collect retains control of its own send status.</p>
    <p>When present, submission.xml takes priority over the original instance XML. Only referenced media is included; encrypted envelopes require all their ciphertext files. Settings, databases, hidden files and unrelated files are excluded. Keep Collect and these files unchanged until verification completes.</p>
    <fieldset :disabled="busy || opened != null">
      <label>Collect instance folder <input type="file" webkitdirectory multiple :disabled="!connected" @change="select"></label>
      <label>Collect instance files <input type="file" multiple :disabled="!connected" @change="select"></label>
      <button type="button" class="btn btn-default" :disabled="!connected || !selected.length" @click="review">Review Collect files</button>
      <label>Collect handoff passphrase <input v-model="passphrase" class="form-control" type="password" minlength="12" maxlength="128" autocomplete="off"></label>
      <label><input v-model="consent" type="checkbox"> I confirmed these finalized files belong to the connected collector and project.</label>
      <button type="button" class="btn btn-primary" :disabled="!connected || !preview || !consent" @click="save">Encrypt and save Collect handoff</button>
      <button type="button" class="btn btn-default" @click="unlock">Unlock Collect handoff</button>
      <label>Import encrypted Collect handoff <input type="file" accept=".fdcollect,application/json" @change="importPackage"></label>
    </fieldset>
    <template v-if="current">
      <p>Collector {{ current.actorId }} · Project {{ current.projectId }} · {{ manifest.xmlFormId }} · {{ manifest.instanceId }} · Expires {{ new Date(current.expiresAt).toLocaleString() }}</p>
      <p>XML: {{ current.xml.name }} · {{ current.xml.size }} bytes · SHA-256 {{ current.xml.sha256 }}</p>
      <ul><li v-for="file of current.media" :key="file.name">{{ file.name }} · {{ file.size }} bytes · SHA-256 {{ file.sha256 }}</li></ul>
      <p v-if="preview?.excluded.length">Excluded: {{ preview.excluded.join(', ') }}</p>
      <p v-if="current.snapshot">{{ verifiedInSession ? 'Snapshot verified with this server in this session; recheck when needed.' : 'Package contains a historical snapshot. Use Verify received Collect files to check it with this server.' }}</p>
    </template>
    <div class="actions">
      <button type="button" class="btn btn-primary" :disabled="busy || !sameCollector || verifiedInSession" @click="send">Send Collect files</button>
      <button type="button" class="btn btn-default" :disabled="busy || !sameCollector" @click="verify">Verify received Collect files</button>
      <button type="button" class="btn btn-default" :disabled="busy || !opened" @click="exportPackage">Export encrypted Collect handoff</button>
      <button type="button" class="btn btn-default" :disabled="busy || !opened?.snapshot" @click="download">Download Collect verification snapshot</button>
      <button type="button" class="btn btn-default" @click="lock">Lock Collect handoff</button>
      <button type="button" class="btn btn-default" :disabled="busy" @click="remove">Delete saved Collect handoff</button>
    </div>
    <p v-if="busy || message" role="status">{{ busy ? 'Working on the Collect handoff…' : message }}</p><p v-if="error" role="alert">{{ error }}</p>
    <p>One encrypted package is saved for 24 hours: one XML up to 1 MB and up to 10 referenced files, 20 MB total. Saving or importing replaces only this handoff package after validation. No upload starts automatically. A successful XML response alone does not verify media. Verify received files can recover an uncertain response without resending.</p>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { checkpointCollectHandoff, collectManifest, decryptCollectHandoff, encryptCollectHandoff, prepareCollectHandoff, storedCollectHandoff, verifyCollectSnapshot } from '../../util/collect-handoff';

defineOptions({ name: 'FieldDataCollectHandoff' });
const props = defineProps({ connected: Boolean, sessionId: { type: Number, required: true }, identity: { type: Object, required: true }, sendFiles: { type: Function, required: true }, verifyFiles: { type: Function, required: true } });
const verifiedInSession = ref(false);
const selected = ref([]); const preview = ref(null); const opened = ref(null); const consent = ref(false); const passphrase = ref(''); const busy = ref(false); const message = ref(''); const error = ref(''); let generation = 0; let expiry; let savedRecord = null;
const current = computed(() => opened.value ?? preview.value?.data); const manifest = computed(() => (current.value ? collectManifest(current.value) : null));
const sameCollector = computed(() => props.connected && opened.value?.actorId === props.identity.actorId && opened.value?.projectId === props.identity.projectId && opened.value.expiresAt > Date.now());
const lock = () => { generation += 1; clearTimeout(expiry); selected.value = []; preview.value = null; opened.value = null; savedRecord = null; verifiedInSession.value = false; consent.value = false; passphrase.value = ''; busy.value = false; error.value = ''; message.value = 'Collect handoff locked. The encrypted saved copy remains.'; };
watch(() => props.sessionId, lock); onBeforeUnmount(lock);
const perform = async action => {
  if (busy.value) return; const revision = generation; const active = () => revision === generation; busy.value = true; error.value = ''; message.value = '';
  try { await action(active); } catch (failure) { if (active()) error.value = 'Collect handoff stopped. Check the selected instance, passphrase, expiry, storage and original collector access. Files may already be received: use Verify received Collect files before resending. Collect files and send status remain unchanged.'; } finally { if (active()) busy.value = false; }
};
const show = data => { verifiedInSession.value = false; opened.value = data; preview.value = null; selected.value = []; clearTimeout(expiry); expiry = setTimeout(lock, Math.max(0, data.expiresAt - Date.now())); };
const persist = async (data, active, checkpoint = false) => { const encrypted = await encryptCollectHandoff(data, passphrase.value); if (!active()) return; if (checkpoint) await checkpointCollectHandoff(encrypted, savedRecord, active); else await storedCollectHandoff('write', encrypted, active); if (active()) savedRecord = encrypted; };
const select = event => { const input = event.target; selected.value = Array.from(input.files ?? []); input.value = ''; preview.value = null; consent.value = false; };
const review = () => perform(async active => { const value = await prepareCollectHandoff(selected.value, props.identity); if (active()) { preview.value = value; consent.value = false; message.value = 'Collect files reviewed locally. Confirm the collector and file list before saving.'; } });
const save = () => perform(async active => { if (!preview.value || !consent.value || !props.connected) return; const { data } = preview.value; if (data.actorId !== props.identity.actorId || data.projectId !== props.identity.projectId) throw new Error('Collector changed'); await persist(data, active); if (active()) { show(data); message.value = 'Collect handoff encrypted and saved. Nothing has been uploaded.'; } });
const unlock = () => perform(async active => { const record = await storedCollectHandoff('read', null, active); const data = await decryptCollectHandoff(record, passphrase.value); if (active()) { savedRecord = record; show(data); message.value = 'Collect handoff unlocked. Reconnect as its original collector to send or verify.'; } });
const importPackage = event => { const input = event.target; const file = input.files?.[0]; input.value = ''; if (!file) return; perform(async active => { if (!file.size || file.size > 48 * 1024 * 1024) throw new Error('Archive too large'); const record = JSON.parse(await file.text()); const data = await decryptCollectHandoff(record, passphrase.value); if (active()) await storedCollectHandoff('write', record, active); if (active()) { savedRecord = record; show(data); message.value = 'Encrypted Collect handoff imported. Nothing has been uploaded.'; } }); };
const verifyCurrent = async active => { const data = opened.value; const response = await props.verifyFiles(collectManifest(data)); await verifyCollectSnapshot(response.snapshot, data); if (!active()) return; const confirmed = { ...data, snapshot: response.snapshot }; await persist(confirmed, active, true); if (active()) { show(confirmed); verifiedInSession.value = true; message.value = 'Collect XML and all expected files verified. Signed snapshot saved in the encrypted handoff. Collect send status remains under Collect control.'; } };
const send = () => perform(async active => { if (!sameCollector.value || verifiedInSession.value) return; await props.sendFiles(opened.value); if (active()) await verifyCurrent(active); });
const verify = () => perform(async active => { if (sameCollector.value) await verifyCurrent(active); });
const downloadFile = (data, name) => { const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
const exportPackage = () => perform(async active => { const record = await storedCollectHandoff('read', null, active); await decryptCollectHandoff(record, passphrase.value); if (active()) downloadFile(record, 'field-data-collect.fdcollect'); });
const download = () => { if (opened.value?.snapshot && !busy.value) downloadFile(opened.value.snapshot, 'collect-handoff-snapshot.json'); };
const remove = () => perform(async active => { await storedCollectHandoff('delete', null, active); if (active()) { lock(); message.value = 'Saved Collect handoff deleted. Collect originals and server submissions remain unchanged.'; } });
</script>
<style scoped>
.collect-handoff { margin-top: 24px; padding: 24px; background: #fff; border: 1px solid #d9e5e9; border-radius: 12px; } fieldset { display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; gap: 12px; } label { display: block; } .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; } p, li, label, button { overflow-wrap: anywhere; } .btn { max-width: 100%; white-space: normal; min-height: 44px; } input { max-width: 100%; } input[type="file"] { width: 100%; }
</style>
