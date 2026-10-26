<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="xml-couriers" aria-labelledby="xml-couriers-title">
    <h3 id="xml-couriers-title">XML courier delivery</h3>
    <p>Authorize exact XML before handing off its encrypted package. For an edit, first review the prior XML version and its fingerprint. The courier connects with their own App User key and imports the package above. No collector access key is shared. Each delivery keeps the original collector attribution; missing media is delivered separately.</p>
    <p v-if="connected">Your collector ID: {{ identity.actorId }} · Project {{ identity.projectId }}. Grants can be revoked; a new recipient requires expiry or revocation of the previous grant.</p>
    <p v-if="!connected">Connect as an App User to authorize, inspect or deliver XML.</p>
    <fieldset :disabled="busy || parentBusy || pending != null">
      <label>XML submission for courier <select v-model.number="selected" class="form-control" :disabled="!opened"><option v-for="(row, index) of opened?.items ?? []" :key="`${row.xmlFormId}/${row.instanceId}`" :value="index">{{ row.xmlFormId }} · {{ row.instanceId }}</option></select></label>
      <label>XML courier recipient ID <input v-model.number="recipient" class="form-control" type="number" min="1"></label>
      <label>XML courier duration <select v-model.number="minutes" class="form-control"><option :value="60">1 hour</option><option :value="240">4 hours</option><option :value="1440">Up to 24 hours</option></select></label>
      <label><input v-model="acknowledged" type="checkbox"> I verified the recipient and authorize these exact XML bytes.</label>
      <label>XML courier grant ID <input v-model.trim="grantId" class="form-control" maxlength="36"></label>
      <label>XML courier revocation reason <textarea v-model="reason" class="form-control" maxlength="2000"/></label>
    </fieldset>
    <p v-if="manifest?.deprecatedId">Replacement for {{ manifest.deprecatedId }}. The authorization binds the exact prior XML hash; a newer competing edit stops delivery.</p>
    <p v-if="baseSummary">Reviewed prior definition {{ baseSummary.baseSubmissionDefId }} · SHA-256 {{ baseSummary.baseSha256 }} · {{ baseSummary.current ? 'Current at review time' : 'Historical; only an exact already-received replacement can be acknowledged' }}.</p>
    <div class="actions">
      <button v-if="manifest?.deprecatedId" type="button" class="btn btn-default" :disabled="busy || parentBusy || pending != null || !connected || opened?.actorId !== identity.actorId" @click="reviewBase">Review prior XML version</button>
      <button type="button" class="btn btn-primary" :disabled="busy || parentBusy || !canAuthorize || (pending && pending.kind !== 'grant')" @click="write('grant')">Authorize XML courier</button>
      <button type="button" class="btn btn-default" :disabled="busy || parentBusy || pending != null || !connected || !manifest" @click="recover">Find XML courier grant</button>
      <button type="button" class="btn btn-default" :disabled="busy || parentBusy || pending != null || !connected || !grantId" @click="inspect">Inspect XML courier proof</button>
      <button type="button" class="btn btn-primary" :disabled="busy || parentBusy || !canDeliver || (pending && pending.kind !== 'deliver')" @click="write('deliver')">Deliver authorized XML</button>
      <button type="button" class="btn btn-default" :disabled="busy || parentBusy || !connected || !grantId || reason.trim().length < 10 || (pending && pending.kind !== 'revoke')" @click="write('revoke')">Revoke XML courier</button>
      <button type="button" class="btn btn-default" :disabled="busy || !proof || pending != null" @click="download">Download XML custody proof</button>
      <button v-if="pending" type="button" class="btn btn-default" :disabled="busy" @click="pending = null">Discard XML courier retry</button>
    </div>
    <button v-if="checked?.delivery && matches && !row?.delivered" type="button" class="btn btn-default" :disabled="busy || parentBusy || proof?.sourceAvailable !== true" @click="acknowledge">Save XML delivery acknowledgement</button>
    <p v-if="pending">An acknowledgement is uncertain. Retry this exact operation or discard its retry before changing details. After reload, unlock the package and use Find XML courier grant.</p>
    <p v-if="busy || message" role="status">{{ busy ? 'Checking XML courier delivery…' : message }}</p><p v-if="error" role="alert">{{ error }}</p>
    <template v-if="checked">
      <p v-if="checked.details.manifest.deprecatedId">Signed prior instance {{ checked.details.manifest.deprecatedId }} · Definition {{ checked.details.baseSubmissionDefId }} · SHA-256 {{ checked.details.manifest.baseSha256 }}</p>
      <p>Grant {{ checked.details.id }} · Owner {{ checked.details.ownerId }} → Courier {{ checked.details.courierId }} · Expires {{ new Date(checked.details.expiresAt).toLocaleString() }}</p>
      <p>{{ checked.details.manifest.xmlFormId }} · {{ checked.details.manifest.instanceId }} · {{ checked.details.manifest.size }} bytes · SHA-256 {{ checked.details.manifest.sha256 }}</p>
      <p>{{ checked.revoked ? 'XML courier permission revoked.' : 'No revocation recorded in this snapshot.' }} {{ checked.delivery ? (checked.delivery.alreadyReceived ? 'XML was already received; a courier receipt is recorded.' : 'Signed XML delivery receipt recorded.') : 'No delivery receipt recorded.' }}<span v-if="checked.unsignedRevocation"> Revocation is effective server-side; signing was unavailable.</span></p>
      <p v-if="checked.delivery && proof.sourceAvailable !== true">The signed receipt is historical; retained XML is no longer current or available.</p>
      <p v-if="manifest && !matches">The selected XML does not match this grant. Select the authorized submission.</p>
    </template>
    <p>Edits use the collector’s current collection permission and preserve native version history. This page must stay open for delivery. Package expiry is unchanged. Proofs attest account actions and exact bytes, not physical custody or absence of later events.</p>
  </section>
</template>
<script setup>
/* eslint-disable no-await-in-loop */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { decode } from '../../util/offline-media';
import { submissionIdentity, XML_LIMIT } from '../../util/offline-submissions';
import verifyXmlCourierProof from '../../util/xml-couriers';
defineOptions({ name: 'FieldDataXmlCouriers' });
const props = defineProps({ connected: Boolean, parentBusy: Boolean, identity: { type: Object, required: true }, opened: { type: Object, default: null }, send: { type: Function, required: true } });
const emit = defineEmits(['delivered']);
const selected = ref(0); const recipient = ref(null); const minutes = ref(60); const acknowledged = ref(false); const grantId = ref(''); const reason = ref('');
const baseHash = ref(''); const baseSummary = ref(null);
const busy = ref(false); const pending = ref(null); const proof = ref(null); const checked = ref(null); const message = ref(''); const error = ref(''); let generation = 0;
const row = computed(() => props.opened?.items[selected.value]);
const manifest = computed(() => {
  if (!row.value) return null;
  const bytes = decode(row.value.bytes, XML_LIMIT);
  const identity = submissionIdentity(bytes, true);
  return { ...identity, ...(identity.deprecatedId ? { baseSha256: baseHash.value || checked.value?.details.manifest.baseSha256 || '' } : {}), size: bytes.length, sha256: row.value.sha256 };
});
const matches = computed(() => checked.value && manifest.value && props.opened?.actorId === checked.value.details.ownerId && props.opened?.projectId === checked.value.details.projectId && Object.keys(manifest.value).every(key => manifest.value[key] === checked.value.details.manifest[key]));
const unexpiredPackage = () => props.opened && props.opened.expiresAt > Date.now();
const canAuthorize = computed(() => props.connected && row.value && !row.value.delivered && props.opened?.actorId === props.identity.actorId && props.opened?.projectId === props.identity.projectId && (!manifest.value?.deprecatedId || /^[a-f0-9]{64}$/.test(manifest.value.baseSha256)) && acknowledged.value && Number.isSafeInteger(recipient.value) && recipient.value > 0 && recipient.value !== props.identity.actorId);
const canDeliver = computed(() => props.connected && (pending.value?.kind === 'deliver' || (matches.value && checked.value.details.courierId === props.identity.actorId && !checked.value.revoked && row.value && !row.value.delivered)));
const clear = () => { generation += 1; baseHash.value = ''; baseSummary.value = null; selected.value = 0; recipient.value = null; grantId.value = ''; reason.value = ''; acknowledged.value = false; proof.value = null; checked.value = null; pending.value = null; busy.value = false; error.value = ''; message.value = ''; };
watch(() => props.opened ? `${props.opened.createdAt}/${props.opened.actorId}/${props.opened.projectId}` : null, clear);
watch(() => props.connected, value => { if (!value) clear(); }); onBeforeUnmount(clear);
watch(selected, () => { baseHash.value = ''; baseSummary.value = null; });
watch([grantId, selected], () => { proof.value = null; checked.value = null; });
const accept = async (data, current) => {
  const verified = await verifyXmlCourierProof(data, props.identity.projectId);
  if (![verified.details.ownerId, verified.details.courierId].includes(props.identity.actorId)) throw new Error('Wrong XML participant');
  if (current === generation) { proof.value = data; checked.value = verified; } return verified;
};
const perform = async action => {
  if (busy.value || props.parentBusy) return;
  const current = generation; busy.value = true; error.value = ''; message.value = '';
  try { await action(current); } catch (failure) {
    if (current === generation) { proof.value = null; checked.value = null; error.value = failure.status === 409 ? 'XML or target ownership conflicts with the server. Keep the package and resolve it with your supervisor.' : 'XML courier operation failed. Check access, expiry, signing availability and the exact authorized file. Saved XML remains available for retry.'; if (failure.status >= 400 && failure.status < 500) pending.value = null; }
  } finally { if (current === generation) busy.value = false; }
};
const reviewBase = () => perform(async current => {
  const m = manifest.value;
  if (!m?.deprecatedId || props.opened?.actorId !== props.identity.actorId) return;
  const data = await props.send(`/edit-base?xmlFormId=${encodeURIComponent(m.xmlFormId)}&version=${encodeURIComponent(m.version)}&deprecatedId=${encodeURIComponent(m.deprecatedId)}&instanceId=${encodeURIComponent(m.instanceId)}`, 'GET');
  if (data.deprecatedId !== m.deprecatedId || !/^[a-f0-9]{64}$/.test(data.baseSha256) || !Number.isSafeInteger(data.baseSubmissionDefId)) throw new Error('Invalid edit base');
  if (current === generation) { baseHash.value = data.baseSha256; baseSummary.value = data; acknowledged.value = false; message.value = 'Prior submission version checked. Review its fingerprint before authorizing this edit.'; }
});
const inspect = () => perform(async current => {
  const id = grantId.value; const data = await props.send(`/${encodeURIComponent(id)}`, 'GET');
  if (data.grant.id !== id) throw new Error('Wrong grant response'); await accept(data, current);
});
const recover = () => perform(async current => {
  const m = manifest.value; const data = await props.send(`?xmlFormId=${encodeURIComponent(m.xmlFormId)}&instanceId=${encodeURIComponent(m.instanceId)}`, 'GET');
  if (!Array.isArray(data.items) || data.items.length > 20) throw new Error('Invalid recovery response');
  const verified = [];
  for (const item of data.items) { const value = await verifyXmlCourierProof(item, props.identity.projectId); if (![value.details.ownerId, value.details.courierId].includes(props.identity.actorId)) throw new Error('Wrong participant'); verified.push({ item, value }); }
  verified.sort((a, b) => Date.parse(b.value.details.issuedAt) - Date.parse(a.value.details.issuedAt));
  if (current !== generation) return;
  if (!verified.length) { message.value = 'No XML courier grant found for this submission.'; return; }
  grantId.value = verified[0].item.grant.id; await accept(verified[0].item, current); message.value = 'Latest accessible XML courier grant recovered.';
});
const write = kind => perform(async current => {
  if ((kind === 'grant' || kind === 'deliver') && !unexpiredPackage()) throw new Error('Package expired');
  pending.value ??= { kind, path: kind === 'grant' ? '' : `/${encodeURIComponent(grantId.value)}/${kind === 'deliver' ? 'deliver' : 'revoke'}`, body: kind === 'grant' ? { requestId: crypto.randomUUID(), courierId: recipient.value, minutes: minutes.value, manifest: manifest.value } : kind === 'revoke' ? { requestId: crypto.randomUUID(), reason: reason.value } : decode(row.value.bytes, XML_LIMIT) };
  if (pending.value.kind !== kind) return;
  const request = pending.value;
  const data = await props.send(request.path, kind === 'deliver' ? 'PUT' : 'POST', request.body);
  if (current !== generation) return;
  if (kind === 'revoke') {
    pending.value = null; message.value = 'XML courier permission permanently revoked.';
    await accept(await props.send(`/${encodeURIComponent(grantId.value)}`, 'GET'), current); return;
  }
  if (kind === 'grant') grantId.value = data.grant.id;
  else if (data.grant.id !== grantId.value) throw new Error('Wrong delivery grant');
  const verified = await accept(data, current);
  if (current !== generation) return;
  pending.value = null;
  if (kind === 'deliver') {
    if (!verified.delivery || !matches.value || data.sourceAvailable !== true) throw new Error('Missing matching delivery receipt');
    emit('delivered', { ...manifest.value }); message.value = 'Authorized XML accepted. Missing media remains separate.';
  } else message.value = 'XML courier authorized. Share the grant ID and encrypted package separately.';
});
const acknowledge = () => {
  if (!matches.value || !checked.value.delivery || proof.value?.sourceAvailable !== true || !unexpiredPackage()) return;
  emit('delivered', { ...manifest.value }); message.value = 'Verified XML delivery receipt selected for local acknowledgement.';
};
const download = () => {
  if (!proof.value || busy.value) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(proof.value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `xml-courier-${grantId.value}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
</script>
<style scoped>
.xml-couriers { border-top: 1px solid #d9e5e9; margin-top: 20px; padding-top: 20px; } fieldset { display: grid; gap: 12px; } label { display: block; } .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; } p, label, button { overflow-wrap: anywhere; } .btn { max-width: 100%; white-space: normal; min-height: 44px; } input, select, textarea { max-width: 100%; }
</style>
