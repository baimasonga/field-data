<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="media-couriers" aria-labelledby="media-couriers-title">
    <h3 id="media-couriers-title">Delegated media couriers</h3>
    <p>Your collector ID is {{ identity.actorId }} in project {{ identity.projectId }}. A different App User in this project can transport a reserved file without receiving your access key. Share the encrypted media package and its passphrase separately. Challenged camera transfers cannot be delegated.</p>
    <p>Each transfer can authorize one courier. After revocation, cancel the pending transfer and reserve a new one to choose another recipient.</p>
    <fieldset :disabled="busy || pending != null">
      <label>Courier transfer ID <input v-model.trim="uploadId" class="form-control" maxlength="36"></label>
      <label>Recipient collector ID <input v-model.number="courierId" class="form-control" type="number" min="1"></label>
      <label>Courier permission duration <select v-model.number="minutes" class="form-control"><option :value="60">1 hour</option><option :value="240">4 hours</option><option :value="1440">Up to 24 hours</option></select></label>
      <label><input v-model="acknowledged" type="checkbox"> I checked the recipient account and authorize only this file transfer.</label>
      <label>Courier revocation reason <textarea v-model="reason" class="form-control" minlength="10" maxlength="2000"/></label>
    </fieldset>
    <div class="actions">
      <button type="button" class="btn btn-primary" :disabled="busy || !acknowledged || !uploadId || !courierId || (pending && pending.kind !== 'grant')" @click="write('grant')">Authorize media courier</button>
      <button type="button" class="btn btn-default" :disabled="busy || !uploadId || reason.trim().length < 10 || (pending && pending.kind !== 'revoke')" @click="write('revoke')">Revoke media courier</button>
      <button type="button" class="btn btn-default" :disabled="busy || pending != null || !uploadId" @click="read">Inspect courier proof</button>
      <button type="button" class="btn btn-default" :disabled="busy || !proof || pending != null" @click="download">Download courier custody proof</button>
      <button v-if="pending" type="button" class="btn btn-default" :disabled="busy" @click="pending = null">Discard courier retry</button>
    </div>
    <p v-if="pending">The previous acknowledgement was uncertain. Retry the same operation or discard its retry before changing details.</p>
    <p v-if="busy || message" role="status">{{ busy ? 'Checking courier authorization…' : message }}</p><p v-if="error" role="alert">{{ error }}</p>
    <p v-if="verified">{{ verified.revoked ? 'Courier permission revoked.' : 'No revocation recorded in this snapshot.' }} {{ verified.delivered ? 'A signed delivery receipt is recorded.' : 'No delivery receipt recorded.' }}<span v-if="verified.unsignedRevocation"> Revocation is effective server-side but its signing authority was unavailable.</span></p>
    <p>Proofs attest server account actions and bytes, not physical custody. A downloaded snapshot cannot show later revocations. Upload or resume matching files from the encrypted package through the queue above. Couriers cannot cancel the owner's transfer or delegate it again.</p>
  </section>
</template>
<script setup>
import { onBeforeUnmount, ref, watch } from 'vue';
import verifyCourierProof from '../../util/media-couriers';
defineOptions({ name: 'FieldDataMediaCouriers' });
const emit = defineEmits(['target']);
const props = defineProps({ send: { type: Function, required: true }, identity: { type: Object, required: true } });
const uploadId = ref(''); const courierId = ref(null); const minutes = ref(60); const acknowledged = ref(false); const reason = ref('');
const busy = ref(false); const pending = ref(null); const proof = ref(null); const verified = ref(null); const message = ref(''); const error = ref(''); let generation = 0;
watch(uploadId, () => { proof.value = null; verified.value = null; });
onBeforeUnmount(() => { generation += 1; proof.value = null; verified.value = null; pending.value = null; reason.value = ''; });
const path = () => `/${encodeURIComponent(uploadId.value)}/courier`;
const load = async current => {
  const data = await props.send(path(), 'GET'); const checked = await verifyCourierProof(data, props.identity.projectId);
  if (data.grant.uploadId !== uploadId.value || ![data.grant.ownerId, data.grant.courierId].includes(props.identity.actorId)) throw new Error('Wrong courier proof target');
  if (current === generation) { proof.value = data; verified.value = checked; emit('target', data.grant.uploadId); }
};
const perform = async action => {
  if (busy.value) return;
  const current = generation; busy.value = true; error.value = ''; message.value = '';
  try { await action(current); } catch (failure) {
    if (current === generation) { proof.value = null; verified.value = null; error.value = 'Courier operation failed. Check the transfer, recipient, permissions and signing availability. Saved files remain unchanged.'; if (failure.status >= 400 && failure.status < 500) pending.value = null; }
  } finally { if (current === generation) busy.value = false; }
};
const write = kind => perform(async current => {
  pending.value ??= { kind, path: `${path()}${kind === 'revoke' ? '/revoke' : ''}`, body: kind === 'grant' ? { requestId: crypto.randomUUID(), courierId: courierId.value, minutes: minutes.value } : { requestId: crypto.randomUUID(), reason: reason.value } };
  if (pending.value.kind !== kind) return;
  await props.send(pending.value.path, 'POST', pending.value.body);
  if (current !== generation) return;
  pending.value = null; message.value = kind === 'grant' ? 'Courier permission recorded. Share the encrypted file separately.' : 'Courier permission permanently revoked.';
  await load(current);
});
const read = () => perform(load);
const download = () => {
  if (!proof.value || busy.value) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(proof.value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `courier-${uploadId.value}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
</script>
<style scoped>
.media-couriers { border-top: 1px solid #d9e5e9; margin-top: 20px; padding-top: 20px; } fieldset { display: grid; gap: 12px; } label { display: block; } .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; } p, label, button { overflow-wrap: anywhere; } .btn { max-width: 100%; white-space: normal; min-height: 44px; } input, select, textarea { max-width: 100%; }
</style>
