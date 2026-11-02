<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="background-submissions" aria-labelledby="background-submissions-title">
    <h3 id="background-submissions-title">Delivery after closing this page</h3>
    <p>Optionally authorize the browser to deliver exact XML for the original collector. Background Sync must be supported. Delivery is best effort: closing the browser, device power settings or browser scheduling can delay it. Check the receipt after reopening. Referenced media is separate.</p>
    <p>This keeps a separate encrypted outbound copy and a browser-held decryption key until it is sent, cancelled or expires. The collector access key is never stored. Locking, disconnecting or deleting the passphrase-protected queue does not cancel an authorized background copy.</p>
    <fieldset :disabled="busy || parentBusy">
      <label>XML for background delivery <select v-model.number="selected" class="form-control" :disabled="!opened"><option v-for="(item, index) of opened?.items ?? []" :key="item.instanceId" :value="index">{{ item.xmlFormId }} · {{ item.instanceId }}</option></select></label>
      <label>Background authorization duration <select v-model.number="minutes" class="form-control"><option :value="60">1 hour</option><option :value="240">4 hours</option><option :value="1440">Until package expiry, at most 24 hours</option></select></label>
      <label><input v-model="consent" type="checkbox"> I authorize this exact XML after the page closes and understand that queue lock does not cancel it.</label>
    </fieldset>
    <p v-if="manifest?.deprecatedId">Edit of {{ manifest.deprecatedId }}. Review the original version before authorizing.</p>
    <p v-if="baseHash">Reviewed prior SHA-256 {{ baseHash }}</p>
    <div class="actions">
      <button v-if="manifest?.deprecatedId" type="button" class="btn btn-default" :disabled="busy || parentBusy || !ownPackage || !connected" @click="reviewBase">Review background edit base</button>
      <button type="button" class="btn btn-primary" :disabled="busy || parentBusy || !canAuthorize" @click="authorize">Authorize background XML</button>
      <button type="button" class="btn btn-default" :disabled="busy || parentBusy || !connected" @click="refresh()">Refresh background deliveries</button>
      <button type="button" class="btn btn-default" :disabled="busy || parentBusy || !connected || !manifest" @click="refresh(true)">Find selected background receipt</button>
    </div>
    <p v-if="message" role="status">{{ message }}</p><p v-if="error" role="alert">{{ error }}</p>
    <ul>
      <li v-for="job of jobs" :key="job.id">
        {{ job.body.manifest.xmlFormId }} · {{ job.body.manifest.instanceId }} · {{ job.status }} · Expires {{ new Date(job.expiresAt).toLocaleString() }}
        <p v-if="job.checked?.delivery">Signed background delivery receipt recorded. {{ job.proof.sourceAvailable === true ? 'XML was available at the last server check.' : 'The receipt is historical; XML is no longer current or available.' }}</p>
        <p v-if="job.checked?.unsignedRevocation">Revocation is effective server-side; its signature was unavailable.</p>
        <div class="actions">
          <button v-if="job.status === 'authorizing'" type="button" class="btn btn-default" :disabled="busy || parentBusy || !connected" @click="retry(job)">Retry exact background authorization</button>
          <button v-if="['queued', 'retry', 'running'].includes(job.status)" type="button" class="btn btn-default" :disabled="busy || parentBusy" @click="schedule">Ask browser to retry background delivery</button>
          <button type="button" class="btn btn-default" :disabled="busy || parentBusy || !connected" @click="inspect(job)">Inspect background receipt</button>
          <button type="button" class="btn btn-default" :disabled="busy || parentBusy || !connected" @click="cancel(job)">Cancel background authorization</button>
          <button v-if="job.checked?.delivery" type="button" class="btn btn-default" :disabled="busy || parentBusy || !canAcknowledge(job)" @click="acknowledge(job)">Save background delivery acknowledgement</button>
          <button v-if="job.proof" type="button" class="btn btn-default" :disabled="busy" @click="download(job)">Download background proof</button>
          <button v-if="['accepted', 'cancelled', 'expired', 'stopped', 'server-only'].includes(job.status)" type="button" class="btn btn-default" :disabled="busy || parentBusy" @click="forget(job)">Remove local background history</button>
        </div>
      </li>
    </ul>
    <p>Cancellation stops the local copy first and requests permanent server revocation. A request already accepted by the server cannot be undone. Keep the original encrypted package until a verified receipt has been saved back to it.</p>
  </section>
</template>
<script setup>
/* eslint-disable no-await-in-loop */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { backgroundRequest, backgroundWorker } from '../../util/background-submissions';
import { decode } from '../../util/offline-media';
import { submissionIdentity, XML_LIMIT } from '../../util/offline-submissions';
defineOptions({ name: 'FieldDataBackgroundSubmissions' });
const props = defineProps({ connected: Boolean, parentBusy: Boolean, identity: { type: Object, required: true }, opened: { type: Object, default: null }, send: { type: Function, required: true }, courierSend: { type: Function, required: true } });
const emit = defineEmits(['delivered']);
const selected = ref(0); const minutes = ref(60); const consent = ref(false); const baseHash = ref(''); const jobs = ref([]); const busy = ref(false); const message = ref(''); const error = ref(''); let generation = 0;
const row = computed(() => props.opened?.items[selected.value]);
const manifest = computed(() => { if (!row.value) return null; const bytes = decode(row.value.bytes, XML_LIMIT); const identity = submissionIdentity(bytes, true); return { ...identity, ...(identity.deprecatedId ? { baseSha256: baseHash.value } : {}), size: bytes.length, sha256: row.value.sha256 }; });
const ownPackage = computed(() => props.opened?.actorId === props.identity.actorId && props.opened?.projectId === props.identity.projectId);
const canAuthorize = computed(() => props.connected && ownPackage.value && row.value && !row.value.delivered && consent.value && (!manifest.value?.deprecatedId || /^[a-f0-9]{64}$/.test(baseHash.value)));
const clear = () => { generation += 1; selected.value = 0; consent.value = false; baseHash.value = ''; jobs.value = []; busy.value = false; message.value = ''; error.value = ''; };
watch(() => props.connected, value => { if (!value) clear(); });
watch(() => `${props.identity.actorId}/${props.identity.projectId}`, clear);
watch(selected, () => { baseHash.value = ''; consent.value = false; });
watch(() => props.opened ? `${props.opened.createdAt}/${props.opened.actorId}/${props.opened.projectId}` : null, () => { generation += 1; busy.value = false; selected.value = 0; baseHash.value = ''; consent.value = false; });
const perform = async action => {
  if (busy.value || props.parentBusy) return;
  const current = generation; busy.value = true; message.value = ''; error.value = '';
  try { await action(current); } catch { if (current === generation) error.value = 'Background operation stopped. Check Background Sync support, access, connectivity, expiry and storage. An uncertain authorization can be retried exactly. The original encrypted package remains available.'; }
  finally { if (current === generation) busy.value = false; }
};
const local = async current => {
  const rows = await backgroundRequest('list');
  if (current === generation && props.connected) jobs.value = rows.filter(job => job.ownerId === props.identity.actorId && job.projectId === props.identity.projectId);
};
const reviewBase = () => perform(async current => {
  const m = manifest.value; if (!m?.deprecatedId || !ownPackage.value) return;
  const data = await props.courierSend(`/edit-base?xmlFormId=${encodeURIComponent(m.xmlFormId)}&version=${encodeURIComponent(m.version)}&deprecatedId=${encodeURIComponent(m.deprecatedId)}&instanceId=${encodeURIComponent(m.instanceId)}`, 'GET');
  if (data.deprecatedId !== m.deprecatedId || !/^[a-f0-9]{64}$/.test(data.baseSha256)) throw new Error('Invalid edit base');
  if (current === generation) { baseHash.value = data.baseSha256; consent.value = false; message.value = 'Background edit base reviewed. Check its fingerprint before authorizing.'; }
});
const activate = async (body, current) => {
  const proof = await props.send('', 'POST', body);
  if (current !== generation) return;
  await backgroundRequest('authorize', { proof }, true); await local(current);
  if (current === generation) message.value = 'Background XML authorized. The browser may deliver it after this page closes. Check the signed receipt after reopening.';
};
const authorize = () => perform(async current => {
  if (!canAuthorize.value || props.opened.expiresAt <= Date.now()) return;
  await backgroundWorker(true); if (current !== generation) return;
  const bytes = decode(row.value.bytes, XML_LIMIT); const random = crypto.getRandomValues(new Uint8Array(32)); const token = btoa(String.fromCharCode(...random)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const staged = await backgroundRequest('stage', { id: crypto.randomUUID(), token, bytes, manifest: manifest.value, ownerId: props.identity.actorId, projectId: props.identity.projectId, expiresAt: Math.min(props.opened.expiresAt, Date.now() + minutes.value * 60000), priority: row.value.priority }, true);
  await local(current); if (current === generation) await activate(staged.body, current);
});
const retry = job => perform(async current => { await backgroundWorker(true); await activate(job.body, current); });
const refresh = (selectedOnly = false) => perform(async current => {
  await local(current); const m = manifest.value; const path = selectedOnly && m ? `?xmlFormId=${encodeURIComponent(m.xmlFormId)}&instanceId=${encodeURIComponent(m.instanceId)}` : ''; const data = await props.send(path, 'GET'); if (!Array.isArray(data.items) || data.items.length > 50) throw new Error('Invalid background history');
  const extras = [];
  for (const proof of data.items) {
    const checked = await backgroundRequest('verify', { proof, projectId: props.identity.projectId }); if (checked.details.ownerId !== props.identity.actorId) throw new Error('Wrong background owner');
    const known = jobs.value.find(job => job.id === checked.details.id);
    const job = { ...(known ?? {}), id: checked.details.id, body: known?.body ?? { id: checked.details.id, manifest: checked.details.manifest, tokenHash: checked.details.tokenHash, expiresAt: checked.details.expiresAt }, ownerId: checked.details.ownerId, projectId: props.identity.projectId, expiresAt: Date.parse(checked.details.expiresAt), status: checked.delivery ? 'accepted' : checked.revoked ? 'cancelled' : known?.status ?? 'server-only', proof, checked };
    extras.push(job);
  }
  if (current === generation) { jobs.value = [...jobs.value.filter(job => !extras.some(other => other.id === job.id)), ...extras]; message.value = 'Background deliveries refreshed. Only a verified current receipt can acknowledge the encrypted queue.'; }
});
const inspect = job => perform(async current => {
  const proof = await props.send(`/${encodeURIComponent(job.id)}`, 'GET'); const checked = await backgroundRequest('verify', { proof, projectId: props.identity.projectId });
  if (checked.details.id !== job.id || checked.details.ownerId !== props.identity.actorId) throw new Error('Wrong background receipt');
  if (current === generation) { jobs.value = jobs.value.map(item => item.id === job.id ? { ...item, proof, checked, status: checked.delivery ? 'accepted' : checked.revoked ? 'cancelled' : item.status } : item); message.value = 'Background receipt inspected.'; }
});
const cancel = job => perform(async current => {
  await backgroundRequest('cancel', { id: job.id }); await local(current);
  if (current === generation) message.value = 'Local outbound copy stopped. Server revocation is not yet confirmed.';
  await props.send(`/${encodeURIComponent(job.id)}/revoke`, 'POST', { requestId: crypto.randomUUID(), reason: 'Collector cancelled this exact-file browser background authorization.' });
  if (current === generation) message.value = 'Local outbound copy stopped and server authorization permanently revoked. Already accepted XML remains.';
});
const schedule = () => perform(async current => { await backgroundRequest('schedule', {}, true); await local(current); if (current === generation) message.value = 'The browser was asked to retry. Delivery timing remains controlled by the browser.'; });
const canAcknowledge = job => props.connected && ownPackage.value && props.opened?.expiresAt > Date.now() && job.checked?.delivery && job.proof?.sourceAvailable === true && props.opened.items.some(item => item.xmlFormId === job.body.manifest.xmlFormId && item.instanceId === job.body.manifest.instanceId && item.sha256 === job.body.manifest.sha256 && !item.delivered);
const acknowledge = job => perform(async current => {
  if (!canAcknowledge(job)) return;
  const proof = await props.send(`/${encodeURIComponent(job.id)}`, 'GET'); const checked = await backgroundRequest('verify', { proof, projectId: props.identity.projectId });
  if (current !== generation) return;
  jobs.value = jobs.value.map(item => item.id === job.id ? { ...item, proof, checked } : item);
  if (!checked.delivery || checked.details.id !== job.id || checked.details.ownerId !== props.identity.actorId || proof.sourceAvailable !== true || checked.details.manifest.sha256 !== job.body.manifest.sha256) throw new Error('Current XML is unavailable');
  emit('delivered', checked.details.manifest);
});
const forget = job => perform(async current => { await backgroundRequest('forget', { id: job.id }); await local(current); if (current === generation) message.value = 'Local background history removed. Server custody history remains.'; });
const download = job => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(job.proof, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `xml-background-${job.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const update = event => { if (event.data?.type === 'fieldwork-background-update' && props.connected && !busy.value) local(generation).catch(() => {}); };
onMounted(() => navigator.serviceWorker?.addEventListener?.('message', update));
onBeforeUnmount(() => { navigator.serviceWorker?.removeEventListener?.('message', update); clear(); });
</script>
<style scoped>
.background-submissions { border-top: 1px solid #d9e5e9; margin-top: 20px; padding-top: 20px; } fieldset { display: grid; gap: 12px; } label { display: block; } .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; } p, li, label, button { overflow-wrap: anywhere; } .btn { max-width: 100%; white-space: normal; min-height: 44px; } input, select { max-width: 100%; }
</style>
