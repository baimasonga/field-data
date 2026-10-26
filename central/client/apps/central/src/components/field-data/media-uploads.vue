<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="media-uploads" aria-labelledby="media-uploads-title">
    <h2 id="media-uploads-title">Recover media uploads</h2>
    <p>The submission XML must already be received by this server. Attach missing photos, audio or video from your own unedited submission. This does not change ODK Collect's native upload protocol.</p>
    <p>Verified chunks resume after an interruption. Temporary uploads expire after 24 hours. This queue keeps files in memory; after reopening, reconnect and reselect the same file or unlock an encrypted media package below. Access keys are never saved in browser storage.</p>
    <form @submit.prevent>
      <fieldset :disabled="busy">
        <label>Form ID <input v-model.trim="xmlFormId" class="form-control" maxlength="1000" required></label>
        <label>Synced submission instance ID <input v-model.trim="instanceId" class="form-control" maxlength="1000" required></label>
        <label>Media files (up to 20 MB each)
          <input type="file" multiple accept="image/*,audio/*,video/*" :disabled="!xmlFormId || !instanceId" @change="addFiles">
        </label>
      </fieldset>
    </form>
    <div class="actions">
      <button type="button" class="btn btn-primary" :disabled="busy || !queue.some(row => row.state !== 'completed')" @click="run()">Upload or resume queue</button>
      <button type="button" class="btn btn-default" :disabled="busy || !queue.some(row => row.state !== 'completed')" @click="run(true)">Reserve files for courier delivery</button>
      <button type="button" class="btn btn-default" :disabled="!busy" @click="paused = true">Pause after current chunk</button>
      <button type="button" class="btn btn-default" :disabled="busy" @click="refresh">Refresh saved transfers</button>
      <button type="button" class="btn btn-default" :disabled="busy || !queue.some(row => row.state !== 'completed')" @click="protect">Prepare queue for encrypted storage</button>
    </div>
    <p v-if="busy || message" role="status">{{ busy ? 'Working on transfers. Keep this tab open.' : message }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <ul class="upload-queue">
      <li v-for="row of queue" :key="row.localId">
        <h3>{{ row.file.name }}</h3>
        <p>{{ row.xmlFormId }} · {{ Math.ceil(row.file.size / 1024) }} KB · {{ row.state }}</p>
        <p v-if="row.captureLocation">Includes device-reported location: {{ row.captureLocation.latitude.toFixed(6) }}, {{ row.captureLocation.longitude.toFixed(6) }} · Reported accuracy ±{{ Math.ceil(row.captureLocation.accuracy) }} m. Uploading shares this location with authorized reviewers.</p>
        <button v-if="row.captureLocation" type="button" class="btn btn-default" :disabled="busy || row.id != null" @click="delete row.captureLocation">Remove location before upload: {{ row.file.name }}</button>
        <label>Priority for {{ row.file.name }}
          <select v-model.number="row.priority" :disabled="busy || row.id != null">
            <option :value="1">High</option><option :value="2">Normal</option><option :value="3">Large media</option>
          </select>
        </label>
        <progress :value="row.offset" :max="row.file.size" :aria-label="`Upload progress for ${row.file.name}`"></progress>
        <p>{{ row.offset }} of {{ row.file.size }} bytes confirmed by the server</p>
        <button type="button" class="btn btn-default" :disabled="busy" @click="discard(row)">Remove from queue: {{ row.file.name }}</button>
      </li>
    </ul>
    <details v-if="saved.length">
      <summary>Server transfers ({{ saved.length }})</summary>
      <ul>
<li v-for="row of saved" :key="row.id">
{{ row.name }} · Transfer {{ row.id }} · Owner {{ row.ownerId }} · {{ row.xmlFormId }} · {{ row.status }} · {{ row.offset }} / {{ row.size }} bytes. Reselect the same file to resume.
        <button v-if="row.status === 'pending' && (row.ownerId == null || row.ownerId === identity.actorId)" type="button" class="btn btn-default" :disabled="busy" @click="cancelSaved(row)">Cancel saved transfer: {{ row.name }}</button>
      </li>
</ul>
    </details>
    <field-data-media-couriers :send="send" :identity="identity"/>
  </section>
</template>
<script setup>
// Transfers deliberately run serially to honor priority and confirmed offsets.
/* eslint-disable no-await-in-loop, no-continue */
import { onBeforeUnmount, ref } from 'vue';
import FieldDataMediaCouriers from './media-couriers.vue';
import { challengeContext } from '../../util/offline-media';
import { checkedLocation, sameLocation } from '../../util/capture-location';

defineOptions({ name: 'FieldDataMediaUploads' });
const emit = defineEmits(['protect']);
const props = defineProps({ send: { type: Function, required: true }, identity: { type: Object, default: () => ({}) } });
const xmlFormId = ref(''); const instanceId = ref(''); const queue = ref([]); const saved = ref([]);
const busy = ref(false); const paused = ref(false); const message = ref(''); const error = ref('');
let generation = 0;
onBeforeUnmount(() => { generation += 1; paused.value = true; queue.value = []; saved.value = []; });
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
const valid = row => row != null && /^[0-9a-f-]{36}$/i.test(row.id ?? '') && Number.isInteger(row.offset) && Number.isInteger(row.size) &&
  row.size > 0 && row.size <= 20 * 1024 * 1024 && row.offset >= 0 && row.offset <= row.size && row.chunkSize === 262144 &&
  ['pending', 'completed'].includes(row.status) && (row.status !== 'completed' || row.offset === row.size) && [1, 2, 3].includes(row.priority) && typeof row.name === 'string' &&
  typeof row.xmlFormId === 'string' && typeof row.instanceId === 'string' && /^[0-9a-f]{64}$/.test(row.sha256 ?? '');
const accept = row => { if (row?.captureLocation != null) checkedLocation(row.captureLocation); if (!valid(row)) throw new Error('Invalid upload response'); return row; };
const readSaved = async () => {
  const data = await props.send('', 'GET');
  if (!Array.isArray(data.items) || data.items.length > 50) throw new Error('Invalid upload list');
  return data.items.map(accept);
};
const fail = failure => {
  if (failure.code === 'COURIER_CHALLENGE') { error.value = 'Challenged camera photos must be uploaded by the original collector. Reserve ordinary files separately.'; return; }
  if (failure.code === 'SOURCE_CHANGED') { error.value = 'This file differs from the saved transfer. Reselect the original file, or cancel that saved transfer before uploading a different file.'; return; }
  error.value = ({
    400: 'File details, chunk contents or stored bytes failed verification. Reselect the original file; ask your supervisor if it is already correct.',
    404: 'The target is unavailable. Check the form ID, instance ID, expected filename and that your submission XML has synced.',
    403: 'Access changed or the attachment is already present. Refresh your inbox and check with your supervisor.',
    409: 'The transfer or attachment target changed, or temporary capacity is full. Refresh saved transfers, then retry.'
  })[failure.status] ??
    'Transfer interrupted. Confirmed chunks remain on the server. Reconnect and resume; do not close this tab unless you can reselect the original file.';
};
const refresh = async () => {
  if (busy.value) return;
  const current = generation; error.value = ''; busy.value = true;
  try { const rows = await readSaved(); if (current === generation) { saved.value = rows; message.value = 'Saved transfers refreshed. Reselect the original files to resume.'; } } catch (failure) { if (current === generation) fail(failure); } finally { if (current === generation) busy.value = false; }
};
const addFiles = event => {
  error.value = '';
  const input = event.target; const files = Array.from(input.files ?? []); input.value = '';
  for (const file of files) {
    if (!file.size || file.size > 20 * 1024 * 1024 || queue.value.length >= 10 || queue.value.reduce((n, r) => n + r.file.size, 0) + file.size > 100 * 1024 * 1024) {
      error.value = 'Choose non-empty files up to 20 MB each; at most 10 files and 100 MB per queue.'; continue;
    }
    if (queue.value.some(r => r.file.name === file.name && r.xmlFormId === xmlFormId.value && r.instanceId === instanceId.value)) continue;
    queue.value.push({
      localId: crypto.randomUUID(), id: null, file, xmlFormId: xmlFormId.value, instanceId: instanceId.value,
      priority: file.size > 1024 * 1024 ? 3 : 2, offset: 0, state: 'Ready'
    });
  }
};
const restoreFiles = rows => {
  if (busy.value) { error.value = 'Pause the current upload before adding unlocked files.'; return; }
  if (rows.some(row => queue.value.some(item => item.file.name === row.file.name && item.xmlFormId === row.xmlFormId && item.instanceId === row.instanceId))) {
    error.value = 'A file for this submission is already queued. Remove it before restoring the package.'; return;
  }
  const additions = rows;
  if (queue.value.length + additions.length > 10 || [...queue.value, ...additions].reduce((n, row) => n + row.file.size, 0) > 100 * 1024 * 1024) {
    error.value = 'The upload queue is full. Remove files before restoring this package.'; return;
  }
  for (const row of additions) queue.value.push({ ...row, localId: crypto.randomUUID(), id: null, offset: 0, state: 'Ready' });
  error.value = ''; message.value = 'Unlocked files added. Review the queue, then explicitly upload or resume.';
};
const protect = () => {
  if (busy.value) return;
  const rows = queue.value.filter(row => row.state !== 'completed').map(row => ({ file: row.file, xmlFormId: row.xmlFormId, instanceId: row.instanceId, priority: row.priority, ...challengeContext(row) }));
  if (rows.length) emit('protect', rows);
};
defineExpose({ restoreFiles });
const run = async (reserveOnly = false) => {
  if (busy.value) return;
  const current = generation; busy.value = true; paused.value = false; error.value = ''; message.value = '';
  try {
    if (reserveOnly && queue.value.some(row => row.challengeId)) { const failure = new Error('Challenged transfer'); failure.code = 'COURIER_CHALLENGE'; throw failure; }
    const rows = await readSaved(); if (current !== generation) return; saved.value = rows;
    const jobs = [];
    // Restore saved priorities only after matching the complete file hash.
    for (const row of queue.value) {
      if (paused.value || current !== generation) break;
      if (row.state === 'completed') continue;
      row.state = 'Checking original file';
      const sha256 = await digest(await row.file.arrayBuffer()); if (current !== generation) return;
      if (paused.value) { row.state = 'Paused'; break; }
      const sameTarget = r => r.name === row.file.name && r.xmlFormId === row.xmlFormId && r.instanceId === row.instanceId;
      const existing = rows.find(r => sameTarget(r) && r.size === row.file.size && r.sha256 === sha256);
      if (existing == null && rows.some(r => sameTarget(r) && r.status === 'pending')) {
        const failure = new Error('Original file changed'); failure.code = 'SOURCE_CHANGED'; throw failure;
      }
      if (existing != null && (existing.challengeId !== row.challengeId || existing.challengeNonce !== row.challengeNonce || !sameLocation(existing.captureLocation, row.captureLocation))) throw new Error('Capture challenge changed');
      if (existing != null) { row.id = existing.id; row.priority = existing.priority; } else row.id ??= crypto.randomUUID();
      jobs.push({ row, sha256, existing });
    }
    const ordered = jobs.sort((a, b) => a.row.priority - b.row.priority || a.row.file.size - b.row.file.size);
    for (const { row, sha256, existing } of ordered) {
      if (paused.value || current !== generation) break;
      let status = existing != null && existing.id === row.id ? existing : accept(await props.send('', 'POST', {
        id: row.id, xmlFormId: row.xmlFormId, instanceId: row.instanceId, name: row.file.name, size: row.file.size, sha256,
        contentType: /^(image|audio|video)\//.test(row.file.type) ? row.file.type : 'application/octet-stream', priority: row.priority,
        ...(row.challengeId == null ? {} : { challengeId: row.challengeId, challengeNonce: row.challengeNonce }),
        ...(row.captureLocation == null ? {} : { captureLocation: checkedLocation(row.captureLocation) })
      }));
      if (current !== generation) return;
      const checked = value => {
        const response = accept(value);
        if (response.id !== row.id || response.sha256 !== sha256 || response.size !== row.file.size || response.name !== row.file.name ||
          response.xmlFormId !== row.xmlFormId || response.instanceId !== row.instanceId || response.challengeId !== row.challengeId || response.challengeNonce !== row.challengeNonce || !sameLocation(response.captureLocation, row.captureLocation)) throw new Error('Upload identity changed');
        return response;
      };
      status = checked(status); row.priority = status.priority; row.offset = status.offset;
      if (reserveOnly) { saved.value = [...saved.value.filter(item => item.id !== status.id), status]; row.state = 'Reserved for courier'; continue; }
      while (status.status !== 'completed' && row.offset < row.file.size && !paused.value && current === generation) {
        row.state = 'Uploading';
        const bytes = await row.file.slice(row.offset, row.offset + status.chunkSize).arrayBuffer();
        const chunkHash = await digest(bytes); if (current !== generation) return;
        status = checked(await props.send(`/${encodeURIComponent(row.id)}/chunks/${row.offset}`, 'PUT', bytes, chunkHash));
        if (current !== generation) return;
        if (status.offset < row.offset + bytes.byteLength) throw new Error('Chunk was not confirmed');
        row.offset = status.offset;
      }
      if (current !== generation) return;
      if (paused.value) { row.state = 'Paused'; break; }
      if (status.status !== 'completed') status = checked(await props.send(`/${encodeURIComponent(row.id)}/complete`, 'POST'));
      if (status.status !== 'completed') throw new Error('Upload was not completed');
      if (current !== generation) return; row.state = status.status;
    }
    if (current === generation) message.value = reserveOnly ? 'Transfers reserved without uploading bytes. Use their transfer IDs below to authorize a courier.' : paused.value ? 'Paused. Confirmed chunks are retained; resume when ready.' : 'Queue finished. Completed attachments were verified and linked to their submissions.';
  } catch (failure) { if (current === generation) { fail(failure); for (const row of queue.value) if (row.state === 'Uploading' || row.state === 'Checking original file') row.state = 'Interrupted'; } } finally { if (current === generation) busy.value = false; }
};
const discard = async row => {
  if (busy.value) return;
  const current = generation; busy.value = true; error.value = '';
  try {
    if (row.id != null && row.state !== 'completed' && (saved.value.find(item => item.id === row.id)?.ownerId == null || saved.value.find(item => item.id === row.id)?.ownerId === props.identity.actorId)) {
      try { await props.send(`/${encodeURIComponent(row.id)}`, 'DELETE'); } catch (failure) { if (failure.status !== 404) throw failure; }
    }
    if (current === generation) queue.value = queue.value.filter(r => r !== row);
  } catch (failure) { if (current === generation) fail(failure); } finally { if (current === generation) busy.value = false; }
};
const cancelSaved = async row => {
  if (busy.value) return;
  const current = generation; busy.value = true; error.value = '';
  try {
    try { await props.send(`/${encodeURIComponent(row.id)}`, 'DELETE'); } catch (failure) { if (failure.status !== 404) throw failure; }
    if (current !== generation) return;
    saved.value = saved.value.filter(r => r.id !== row.id);
    for (const item of queue.value) if (item.id === row.id) { item.id = null; item.offset = 0; item.state = 'Ready'; }
    message.value = 'Saved transfer cancelled. Submission attachments are unchanged.';
  } catch (failure) { if (current === generation) fail(failure); } finally { if (current === generation) busy.value = false; }
};
</script>
<style scoped>
.media-uploads { margin-top: 24px; padding: 24px; border: 1px solid #d9e5e9; border-radius: 12px; background: #fff; }
fieldset { display: grid; gap: 12px; } label { display: block; } .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
.upload-queue { list-style: none; padding: 0; } .upload-queue li { padding: 16px; margin-top: 12px; background: #f6f9fa; border-radius: 8px; }
progress { display: block; width: 100%; margin-top: 12px; } h3, p, details, label, button { overflow-wrap: anywhere; } .btn { max-width: 100%; white-space: normal; } input, select { max-width: 100%; }
@media (max-width: 480px) { .media-uploads { padding: 16px; } }
</style>
