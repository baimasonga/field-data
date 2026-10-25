<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="witness-key-trust">
    <p v-if="record.keyTrust.status === 'revoked'" role="status">A signing key is revoked in this project. Signature bytes still verify; this statement is excluded from active corroboration.</p>
    <p v-else-if="record.keyTrust.status === 'unknown'" role="status">Key revocation status is unavailable or could not be checked. This statement is excluded from active corroboration.</p>
    <p v-else>Key status checked online: no recorded revocation in this project. This is not certified personal identity or proof of presence.</p>
    <p v-if="certified.length">Certificate expiry limits future key use; it does not withdraw retained statements. Revocation is a separate permanent trust decision.</p>
    <ul v-if="certified.length"><li v-for="key of certified" :key="key.keyHash"><strong>Reviewed signing-key certificate: {{ key.certificateStatus }}</strong><p>{{ key.certificateDetails.identityLabel }} · account #{{ key.certificateDetails.subjectAccountId }} · {{ key.certificateDetails.assuranceMethod }}</p><p>{{ key.certificateDetails.verificationNote }}</p><p>Reviewed by {{ key.certificateDetails.reviewerName }} · {{ key.certificateDetails.certifiedAt }} · expires {{ key.certificateDetails.expiresAt }}. This records a manager's identity review and retained key proof; it does not independently establish personal identity, presence or scene truth.</p><p v-if="key.revocation">The certified key is revoked. Its historical certificate remains readable.</p></li></ul>
    <form v-if="record.keyTrust.canCertify && uncertified.length && record.keyTrust.signingAvailable && pending == null" @submit.prevent="certify">
      <h5>Certify a retained witness key</h5><p>A different project manager must review this account/key binding. Identity labels and review notes accompany witness exports visible to form readers; keep private document numbers out of these fields. Certification does not approve the submission or establish presence.</p>
      <fieldset :disabled="busy || pendingCertificate != null">
        <label>Key to certify<select v-model="certificateKey" class="form-control"><option v-for="key of uncertified" :key="key.keyHash" :value="key.keyHash">{{ key.keyHash }}</option></select></label>
        <label>Reviewed identity label<input v-model="identityLabel" class="form-control" maxlength="200" required></label>
        <label>Identity review method<select v-model="method" class="form-control"><option value="account-control">Authenticated account control only</option><option value="organization-record">Organization record reviewed by manager</option><option value="in-person-review">In-person identity review reported by manager</option></select></label>
        <label>Identity review note<textarea v-model="verificationNote" class="form-control" minlength="10" maxlength="2000" required/></label>
        <label>Certificate expires (UTC)<input v-model="certificateExpiry" type="datetime-local" class="form-control" required></label>
        <label><input v-model="reviewed" type="checkbox" required> I reviewed this account identity and retained signing-key proof using the stated method.</label>
        <button type="submit" class="btn btn-default" :disabled="!reviewed || verificationNote.trim().length < 10">Issue witness key certificate</button>
      </fieldset>
      <button v-if="pendingCertificate" type="button" class="btn btn-default" :disabled="busy" @click="sendCertificate">Retry exact key certification</button>
      <button type="button" class="btn btn-link" :disabled="busy" @click="emit('refresh')">Refresh certificate status</button>
    </form>
    <p v-if="certificateError" role="alert">Key certification could not be confirmed. Retry the exact request or refresh certificate history before making another change.</p>
    <ul v-if="revoked.length"><li v-for="key of revoked" :key="key.keyHash"><code>{{ key.keyHash }}</code><p>{{ key.details.reasonCode }}: {{ key.details.reason }}</p><p>Revoked <record-date-time :iso="key.details.revokedAt"/> · account #{{ key.details.revokedBy }}. Server-attested record; offline verification requires an independently trusted issuer key.</p></li></ul>
    <template v-if="record.keyTrust.canRevoke && available.length && pendingCertificate == null">
      <p v-if="!record.keyTrust.signingAvailable" role="status">Server revocation signing is unavailable; no revocation can be recorded.</p>
      <form v-else @submit.prevent="revoke">
        <h5>Revoke a retained signing key</h5>
        <p>Revocation is permanent for this key throughout the project, including other statements or changes using it. History remains. New signatures using it are refused; existing records using it no longer count as active corroboration.</p>
        <label>Signing key<select v-model="selected" class="form-control" :disabled="busy || pending != null"><option v-for="key of available" :key="key.keyHash" :value="key.keyHash">{{ key.keyHash }}</option></select></label>
        <label>Revocation reason type<select v-model="reasonCode" class="form-control" :disabled="busy || pending != null"><option value="compromised">Compromised</option><option value="retired">Retired</option><option value="other">Other</option></select></label>
        <label>Reason for key revocation<textarea v-model="reason" class="form-control" minlength="10" maxlength="2000" required :disabled="busy || pending != null"/></label>
        <button type="submit" class="btn btn-default" :disabled="busy || reason.trim().length < 10">Revoke witness signing key</button>
        <button type="button" class="btn btn-link" :disabled="busy" @click="emit('refresh')">Refresh key status</button>
      </form>
    </template>
    <p v-if="error" role="alert">Revocation could not be confirmed. Retry the same request or refresh key status before changing it.</p>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import RecordDateTime from '../record-date-time.vue';
import useRequest from '../../composables/request';
defineOptions({ name: 'WitnessKeyTrust' });
const props = defineProps({ record: { type: Object, required: true }, base: { type: String, required: true } });
const emit = defineEmits(['refresh']);
const { request, awaitingResponse: busy } = useRequest();
let alive = true; onBeforeUnmount(() => { alive = false; });
const certified = computed(() => props.record.keyTrust.keys.filter(key => key.certificate != null));
const uncertified = computed(() => props.record.keyTrust.keys.filter(key => key.certificate == null && key.revocation === null));
const available = computed(() => props.record.keyTrust.keys.filter(key => key.revocation === null && key.canRevoke !== false));
const revoked = computed(() => props.record.keyTrust.keys.filter(key => key.revocation !== null));
const selected = ref(available.value[0]?.keyHash ?? ''); const reasonCode = ref('compromised'); const reason = ref(''); const error = ref(false); const pending = ref(null);
const certificateKey = ref(uncertified.value[0]?.keyHash ?? ''); const identityLabel = ref(''); const method = ref('account-control'); const verificationNote = ref(''); const certificateExpiry = ref(''); const reviewed = ref(false); const pendingCertificate = ref(null); const certificateError = ref(false);
const sendCertificate = async () => {
  if (!alive || busy.value || !pendingCertificate.value) return; certificateError.value = false;
  try { await request({ method: 'POST', url: `${props.base}/${props.record.id}/key-certificates`, data: pendingCertificate.value, alert: false }); if (alive) emit('refresh'); }
  catch { if (alive) certificateError.value = true; }
};
const certify = () => {
  if (busy.value || pendingCertificate.value || !reviewed.value || !identityLabel.value.trim() || verificationNote.value.trim().length < 10 || !certificateExpiry.value) return;
  pendingCertificate.value = { requestId: crypto.randomUUID(), keyHash: certificateKey.value, identityLabel: identityLabel.value.trim(), method: method.value, verificationNote: verificationNote.value.trim(), expiresAt: new Date(`${certificateExpiry.value}:00Z`).toISOString(), reviewed: true }; sendCertificate();
};
const revoke = () => {
  if (busy.value || reason.value.trim().length < 10) return;
  pending.value ??= { requestId: crypto.randomUUID(), keyHash: selected.value, reasonCode: reasonCode.value, reason: reason.value.trim() };
  error.value = false;
  request({ method: 'POST', url: `${props.base}/${props.record.id}/key-revocations`, data: pending.value, alert: false })
    .then(() => { if (alive) emit('refresh'); }).catch(() => { error.value = true; });
};
</script>
<style scoped>
.witness-key-trust { margin: 10px 0; overflow-wrap: anywhere; }
label { display: block; margin: 8px 0; }
code, select { max-width: 100%; overflow-wrap: anywhere; }
</style>
