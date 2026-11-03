<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="background-media" aria-labelledby="background-media-title">
    <h3 id="background-media-title">Media delivery after closing this page</h3>
    <p>Reserve the file above first. You or its named courier can authorize this exact file after Fieldwork closes. Submission XML must already be received. Challenged camera photos use foreground delivery.</p>
    <p>The browser retains a separate encrypted outbound copy and a non-extractable key that can open it without the package passphrase. Locking the package or signing out does not cancel it. File names and transfer metadata remain visible in local history. Scheduling is best effort; check the receipt after returning.</p>
    <fieldset :disabled="busy || parentBusy">
      <label>Background media file <select v-model="selected" class="form-control"><option value="">Choose a reserved file</option><option v-for="value of eligible" :key="value.localId" :value="value.localId">{{ value.file.name }} · {{ value.instanceId }}</option></select></label>
      <label>Background media duration <select v-model.number="minutes" class="form-control"><option :value="60">1 hour</option><option :value="240">4 hours</option><option :value="1440">Until transfer expiry, at most 24 hours</option></select></label>
      <label><input v-model="consent" type="checkbox"> I authorize this exact media file after the page closes and understand that locking does not cancel delivery.</label>
    </fieldset>
    <div class="actions">
      <button type="button" class="btn btn-primary" :disabled="busy || parentBusy || !row || !consent" @click="authorize">Authorize background media</button>
      <button type="button" class="btn btn-default" :disabled="busy || parentBusy" @click="refresh">Refresh background media deliveries</button>
    </div>
    <p v-if="message" role="status">{{ message }}</p><p v-if="error" role="alert">{{ error }}</p>
    <ul><li v-for="job of jobs" :key="job.id">
      {{ job.manifest.name }} · {{ job.manifest.instanceId }} · {{ job.status }} · Expires {{ new Date(job.expiresAt).toLocaleString() }}
      <p v-if="job.checked">Collector {{ job.checked.details.ownerId }} · Sender {{ job.checked.details.senderId }}</p>
      <p v-if="job.checked?.delivery">Signed background media delivery receipt recorded. {{ job.proof.sourceAvailable === true ? 'Attachment was available at the last server check.' : 'Historical receipt; attachment is no longer available.' }}</p>
      <p v-if="job.checked?.unsignedRevocation">Revocation is effective server-side; its signature was unavailable.</p>
      <div class="actions">
        <button v-if="job.status === 'authorizing'" type="button" class="btn btn-default" :disabled="busy || parentBusy" @click="retry(job)">Retry exact background media authorization</button>
        <button v-if="['queued', 'retry', 'running'].includes(job.status)" type="button" class="btn btn-default" :disabled="busy || parentBusy" @click="schedule">Ask browser to retry background media</button>
        <button type="button" class="btn btn-default" :disabled="busy || parentBusy" @click="inspect(job)">Inspect background media receipt</button>
        <button type="button" class="btn btn-default" :disabled="busy || parentBusy" @click="cancel(job)">Cancel background media authorization</button>
        <button v-if="job.proof" type="button" class="btn btn-default" :disabled="busy" @click="download(job)">Download background media proof</button>
        <button v-if="['accepted', 'cancelled', 'expired', 'stopped', 'server-only'].includes(job.status)" type="button" class="btn btn-default" :disabled="busy || parentBusy" @click="forget(job)">Remove local background media history</button>
      </div>
    </li></ul>
    <p>Cancellation stops the local copy first and requests permanent server revocation. Confirmed server chunks remain available to foreground delivery until the transfer expires or is cancelled. An accepted attachment cannot be undone by revocation.</p>
  </section>
</template>
<script setup>
/* eslint-disable no-await-in-loop */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { backgroundWorker, mediaBackgroundRequest as request } from '../../util/background-submissions';
defineOptions({ name: 'FieldDataBackgroundMedia' });
const props = defineProps({ rows: { type: Array, required: true }, parentBusy: Boolean, send: { type: Function, required: true }, mediaSend: { type: Function, required: true }, identity: { type: Object, required: true } });
const emit = defineEmits(['received']);
const selected = ref(''); const minutes = ref(60); const consent = ref(false); const jobs = ref([]); const busy = ref(false); const error = ref(''); const message = ref(''); let generation = 0;
const eligible = computed(() => props.rows.filter(value => value.id && !value.challengeId && value.state !== 'completed'));
const row = computed(() => eligible.value.find(value => value.localId === selected.value));
watch(selected, () => { consent.value = false; });
onBeforeUnmount(() => { generation += 1; jobs.value = []; });
const perform = async action => {
  if (busy.value || props.parentBusy) return; const current = generation; busy.value = true; error.value = ''; message.value = '';
  try { await action(current); } catch { if (current === generation) error.value = 'Background media operation stopped. Check Background Sync support, the original reserved file, current permissions, expiry and storage. Retry an uncertain authorization exactly; the original file remains unchanged.'; }
  finally { if (current === generation) busy.value = false; }
};
const local = async current => { const data = await request('list'); if (current === generation) jobs.value = data.filter(value => value.ownerId === props.identity.actorId && value.projectId === props.identity.projectId); };
const activate = async (body, current) => {
  const proof = await props.send('', 'POST', body); if (current !== generation) return;
  await request('authorize', { proof }, true); await local(current); if (current === generation) message.value = 'Background media authorized. Check the signed receipt after returning.';
};
const authorize = () => perform(async current => {
  const file = row.value; if (!file || !consent.value) return;
  await backgroundWorker(true, 'field-data-media-background@1'); if (current !== generation) return;
  const status = await props.mediaSend(`/${encodeURIComponent(file.id)}`, 'GET');
  const bytes = new Uint8Array(await file.file.arrayBuffer()); const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  if (current !== generation) return;
  if (status.status !== 'pending' || status.challengeId != null || status.id !== file.id || status.name !== file.file.name || status.xmlFormId !== file.xmlFormId || status.instanceId !== file.instanceId || status.size !== bytes.length || status.sha256 !== sha256) throw new Error('Wrong media transfer');
  let courierExpiry = Infinity;
  if (status.ownerId !== props.identity.actorId) {
    const custody = await props.mediaSend(`/${encodeURIComponent(file.id)}/courier`, 'GET'); courierExpiry = Date.parse(custody.grant.expiresAt);
    if (custody.grant.courierId !== props.identity.actorId || custody.grant.ownerId !== status.ownerId || custody.grant.uploadId !== file.id) throw new Error('Wrong named courier');
  }
  if (current !== generation) return;
  const manifest = Object.fromEntries(['id', 'xmlFormId', 'instanceId', 'name', 'size', 'sha256', 'contentType', 'priority'].map(k => [k, status[k]]));
  const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const staged = await request('stage', { id: crypto.randomUUID(), token, bytes, manifest, ownerId: props.identity.actorId, collectorId: status.ownerId, projectId: props.identity.projectId, expiresAt: Math.min(Date.now() + minutes.value * 60000, Date.parse(status.expiresAt), file.packageExpiresAt ?? Infinity, courierExpiry), priority: status.priority }, true);
  await local(current); if (current === generation) await activate(staged.body, current);
});
const retry = job => perform(async current => { await activate(job.body, current); });
const refresh = () => perform(async current => {
  await local(current); const data = await props.send('', 'GET'); if (!Array.isArray(data.items) || data.items.length > 50) throw new Error('Invalid media history'); const recovered = [];
  for (const proof of data.items) {
    const checked = await request('verify', { proof, projectId: props.identity.projectId }); if (![checked.details.ownerId, checked.details.senderId].includes(props.identity.actorId)) throw new Error('Wrong participant');
    const known = jobs.value.find(value => value.id === checked.details.id);
    recovered.push({ ...known, id: checked.details.id, body: known?.body ?? { id: checked.details.id, uploadId: checked.details.uploadId, tokenHash: checked.details.tokenHash, expiresAt: checked.details.expiresAt }, manifest: checked.details.manifest, expiresAt: Date.parse(checked.details.expiresAt), proof, checked, status: checked.delivery ? 'accepted' : checked.revoked ? 'cancelled' : known?.status ?? 'server-only' });
  }
  if (current === generation) { jobs.value = [...jobs.value.filter(value => !recovered.some(item => item.id === value.id)), ...recovered]; message.value = 'Background media deliveries refreshed.'; }
});
const inspect = job => perform(async current => {
  const proof = await props.send(`/${encodeURIComponent(job.id)}`, 'GET'); const checked = await request('verify', { proof, projectId: props.identity.projectId });
  if (checked.details.id !== job.id || ![checked.details.ownerId, checked.details.senderId].includes(props.identity.actorId)) throw new Error('Wrong media receipt');
  if (current === generation) { jobs.value = jobs.value.map(value => value.id === job.id ? { ...value, proof, checked, status: checked.delivery ? 'accepted' : checked.revoked ? 'cancelled' : value.status } : value); if (checked.delivery && proof.sourceAvailable === true) emit('received', checked.delivery); message.value = 'Background media receipt inspected.'; }
});
const cancel = job => perform(async current => {
  await request('cancel', { id: job.id }); await local(current);
  try { await props.send(`/${encodeURIComponent(job.id)}/revoke`, 'POST', { requestId: crypto.randomUUID(), reason: 'Collector or named courier cancelled this browser media authorization.' }); }
  catch { if (current === generation) error.value = 'Local outbound media stopped. Server revocation is unconfirmed; retry cancellation after reconnecting.'; return; }
  if (current === generation) message.value = 'Local media copy stopped and server authorization permanently revoked.';
});
const schedule = () => perform(async current => { await request('schedule', {}, true); await local(current); if (current === generation) message.value = 'Browser asked to retry background media. Scheduling remains best effort.'; });
const forget = job => perform(async current => { await request('forget', { id: job.id }); await local(current); });
const download = job => { const url = URL.createObjectURL(new Blob([JSON.stringify(job.proof, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `media-background-${job.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
</script>
<style scoped>
.background-media { border-top: 1px solid #d9e5e9; margin-top: 20px; padding-top: 20px; } fieldset { display: grid; gap: 12px; } label { display: block; } .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; } p, li, label, button { overflow-wrap: anywhere; } .btn { max-width: 100%; white-space: normal; min-height: 44px; } input, select { max-width: 100%; }
</style>
