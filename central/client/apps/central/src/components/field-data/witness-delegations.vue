<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section aria-label="Form witness delegation" class="witness-delegations">
    <h2>Witness delegation</h2>
    <p>Authorize an existing reader to sign witness statements for this form, without submission-edit access. Delegates cannot pass this permission to another account. Signatures do not prove independent people or physical presence.</p>
    <button type="button" class="btn btn-default" :disabled="busy" @click="load(false)">{{ catalogue ? 'Refresh witness delegations' : 'Open witness delegation' }}</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="catalogue">
      <p v-if="!catalogue.signingAvailable" role="status">Delegation changes are unavailable: the project is archived or server signing is not configured.</p>
      <p v-if="catalogue.candidatesTruncated">Only the first 200 readable accounts are listed. Search the existing project assignments to review access.</p>
      <form @submit.prevent="saveGrant"><fieldset :disabled="busy || pending != null || !catalogue.signingAvailable"><legend>Time-bounded form permission</legend>
        <label for="witness-delegate">Reader account</label><select id="witness-delegate" v-model="delegateId" class="form-control" required><option value="">Choose a current form reader</option><option v-for="person of catalogue.candidates" :key="person.id" :value="person.id">{{ person.displayName }} · account #{{ person.id }}</option></select>
        <label>Permission expires (UTC)<input v-model="expiresAt" type="datetime-local" class="form-control" required></label>
        <label>Reason for delegated witnessing<textarea v-model="reason" class="form-control" minlength="10" maxlength="2000" required/></label>
        <label><input v-model="confirmed" type="checkbox" required> I authorize this reader to witness challenged photos for this form until expiry or revocation.</label>
        <button type="submit" class="btn btn-primary" :disabled="!confirmed || reason.trim().length < 10">Grant witness permission</button>
      </fieldset></form>
      <button v-if="pending" type="button" class="btn btn-default" :disabled="busy" @click="sendPending">Retry exact delegation change</button>
      <p v-if="pending">An earlier change has not been confirmed. Retry it exactly, or refresh history before starting another change.</p>
      <h3>Active form permissions</h3><p v-if="!catalogue.active.length">No active delegated witnesses.</p>
      <ul><li v-for="item of catalogue.active" :key="item.id"><strong>{{ item.delegateName }}</strong> · expires {{ item.expiresAt }}<p>{{ item.reason }}</p>
        <label>Reason to revoke {{ item.delegateName }}<textarea v-model="revokeReasons[item.id]" class="form-control" maxlength="2000" :disabled="busy || pending != null || !catalogue.signingAvailable"/></label>
        <button type="button" class="btn btn-default" :disabled="busy || pending != null || !catalogue.signingAvailable || (revokeReasons[item.id] ?? '').trim().length < 10" @click="revoke(item)">Revoke permission for {{ item.delegateName }}</button>
      </li></ul>
      <h3>Signed permission history</h3><p>Expiry or revocation stops new statements and corrections. Previously authorized statements remain in history. With current read access, an owner can still withdraw a statement or revoke its signing key.</p>
      <ol><li v-for="item of catalogue.history.items" :key="item.id">{{ item.kind === 'grant' ? 'Granted' : 'Revoked' }} · {{ item.delegateName }} · {{ item.grantedAt ?? item.revokedAt }}<p>{{ item.reason }}</p><button type="button" class="btn btn-link" @click="download(item)">Download signed permission event</button></li></ol>
      <button v-if="catalogue.history.nextBefore != null" type="button" class="btn btn-default" :disabled="busy || pending != null" @click="load(true)">Load earlier permission history</button>
    </template>
  </section>
</template>
<script setup>
import { onBeforeUnmount, ref } from 'vue';
import useRequest from '../../composables/request';
import { verifyDelegationEnvelope } from '../../util/witness-delegations';

defineOptions({ name: 'FieldDataWitnessDelegations' });
const props = defineProps({ projectId: { type: [Number, String], required: true }, xmlFormId: { type: String, required: true } });
const { request } = useRequest(); const catalogue = ref(null); const busy = ref(false); const error = ref(''); const pending = ref(null); const delegateId = ref(''); const expiresAt = ref(''); const reason = ref(''); const confirmed = ref(false); const revokeReasons = ref({}); let generation = 0;
const base = () => `/v1/projects/${encodeURIComponent(props.projectId)}/forms/${encodeURIComponent(props.xmlFormId)}/witness-delegations`;
onBeforeUnmount(() => { generation += 1; });
const verifyItem = async item => {
  const details = await verifyDelegationEnvelope(item.attestation, item.kind === 'grant' ? 'delegation' : 'delegation-revocation');
  if ((item.kind === 'grant' && item.id !== details.delegationId) || !['grant', 'revoke'].includes(item.kind) || details.projectId !== Number(props.projectId) || details.xmlFormId !== props.xmlFormId || details.delegationId !== item.delegationId || Object.keys(details).some(key => !['purpose', 'issuer'].includes(key) && JSON.stringify(details[key]) !== JSON.stringify(item[key]))) throw new Error('Invalid permission history');
  return item;
};
const read = async earlier => {
  const { data } = await request({ method: 'GET', url: base(), params: earlier ? { before: catalogue.value.history.nextBefore } : {}, alert: false });
  if (data?.method !== 'form-witness-delegations@1' || !Array.isArray(data.active) || !Array.isArray(data.history?.items) || !Array.isArray(data.candidates)) throw new Error('Invalid permission list');
  await Promise.all([...data.active, ...data.history.items].map(verifyItem)); return data;
};
const load = async earlier => {
  if (busy.value) return; const current = ++generation; busy.value = true; error.value = '';
  try { const data = await read(earlier); if (current !== generation) return; catalogue.value = earlier ? { ...data, history: { ...data.history, items: [...catalogue.value.history.items, ...data.history.items] } } : data; pending.value = null; reason.value = ''; confirmed.value = false; revokeReasons.value = {}; }
  catch { if (current === generation) { catalogue.value = null; error.value = 'Witness permission history could not be loaded or verified. Refresh to check access.'; } }
  finally { if (current === generation) busy.value = false; }
};
const sendPending = async () => {
  if (busy.value || !pending.value) return; const current = generation; busy.value = true; error.value = ''; let saved = false;
  try { const { data } = await request({ method: 'POST', url: pending.value.url, data: pending.value.body, alert: false }); await verifyItem(data.item); if (current !== generation) return; pending.value = null; saved = true; const fresh = await read(false); if (current === generation) { catalogue.value = fresh; reason.value = ''; confirmed.value = false; revokeReasons.value = {}; } }
  catch (failure) { if (current === generation) { if ([400, 403, 404, 409].includes(failure.response?.status)) pending.value = null; if ([403, 404].includes(failure.response?.status)) catalogue.value = null; error.value = saved ? 'Permission was recorded, but history could not refresh. Refresh before relying on its status.' : 'Permission change could not be confirmed. Retry the exact change or refresh its history before making another change.'; } }
  finally { if (current === generation) busy.value = false; }
};
const saveGrant = () => {
  if (pending.value || !confirmed.value || !delegateId.value || !expiresAt.value || reason.value.trim().length < 10) return;
  pending.value = { url: base(), body: { requestId: crypto.randomUUID(), delegateId: Number(delegateId.value), expiresAt: new Date(`${expiresAt.value}:00Z`).toISOString(), reason: reason.value.trim() } }; sendPending();
};
const revoke = item => { if (pending.value) return; pending.value = { url: `${base()}/${item.id}/revoke`, body: { requestId: crypto.randomUUID(), reason: (revokeReasons.value[item.id] ?? '').trim() } }; sendPending(); };
const download = item => { const url = URL.createObjectURL(new Blob([JSON.stringify(item, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `witness-permission-${item.id}.json`; link.click(); URL.revokeObjectURL(url); };
</script>
<style scoped>
.witness-delegations { margin: 20px 0; padding: 16px; border: 1px solid #ccd6dd; overflow-wrap: anywhere; }
fieldset { display: grid; gap: 10px; min-width: 0; } label { display: block; } .btn { min-height: 44px; max-width: 100%; white-space: normal; } li { margin: 12px 0; }
</style>
