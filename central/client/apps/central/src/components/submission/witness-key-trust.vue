<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="witness-key-trust">
    <p v-if="record.keyTrust.status === 'revoked'" role="status">A signing key is revoked in this project. Signature bytes still verify; this statement is excluded from active corroboration.</p>
    <p v-else-if="record.keyTrust.status === 'unknown'" role="status">Key revocation status is unavailable or could not be checked. This statement is excluded from active corroboration.</p>
    <p v-else>Key status checked online: no recorded revocation in this project. This is not certified personal identity or proof of presence.</p>
    <ul v-if="revoked.length"><li v-for="key of revoked" :key="key.keyHash"><code>{{ key.keyHash }}</code><p>{{ key.details.reasonCode }}: {{ key.details.reason }}</p><p>Revoked <record-date-time :iso="key.details.revokedAt"/> · account #{{ key.details.revokedBy }}. Server-attested record; offline verification requires an independently trusted issuer key.</p></li></ul>
    <template v-if="record.keyTrust.canRevoke && available.length">
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
import { computed, ref } from 'vue';
import RecordDateTime from '../record-date-time.vue';
import useRequest from '../../composables/request';
defineOptions({ name: 'WitnessKeyTrust' });
const props = defineProps({ record: { type: Object, required: true }, base: { type: String, required: true } });
const emit = defineEmits(['refresh']);
const { request, awaitingResponse: busy } = useRequest();
const available = computed(() => props.record.keyTrust.keys.filter(key => key.revocation === null));
const revoked = computed(() => props.record.keyTrust.keys.filter(key => key.revocation !== null));
const selected = ref(available.value[0]?.keyHash ?? ''); const reasonCode = ref('compromised'); const reason = ref(''); const error = ref(false); const pending = ref(null);
const revoke = () => {
  if (busy.value || reason.value.trim().length < 10) return;
  pending.value ??= { requestId: crypto.randomUUID(), keyHash: selected.value, reasonCode: reasonCode.value, reason: reason.value.trim() };
  error.value = false;
  request({ method: 'POST', url: `${props.base}/${props.record.id}/key-revocations`, data: pending.value, alert: false })
    .then(() => emit('refresh')).catch(() => { error.value = true; });
};
</script>
<style scoped>
.witness-key-trust { margin: 10px 0; overflow-wrap: anywhere; }
label { display: block; margin: 8px 0; }
code, select { max-width: 100%; overflow-wrap: anywhere; }
</style>
