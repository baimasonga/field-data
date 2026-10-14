<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="capture-witness" aria-label="Signed witness statements">
    <h4>Witness statements</h4>
    <p>A signature protects the statement and image fingerprint. Account identity is recorded at submission; it does not prove physical presence, independence of people or the truth of the claim.</p>
    <p v-if="loading" role="status">Loading witness statements…</p>
    <template v-else>
      <p v-if="records.length && !bindingCurrent" class="outdated" role="status">These statements refer to an earlier image or submission version.</p>
      <ol v-if="records.length">
        <li v-for="record of records" :key="record.id">
          <strong>{{ record.witnessName }}</strong> · Signature verified
          <p>{{ record.statement }}</p>
          <p>Recorded <record-date-time :iso="record.receivedAt"/></p>
          <button type="button" class="btn btn-default" @click="download(record)">Download signed statement</button>
        </li>
      </ol>
      <p v-else-if="!error">No witness statements recorded.</p>
      <form v-if="context" @submit.prevent="save">
        <h5>Add your witness statement</h5>
        <fieldset :disabled="busy">
          <label>Describe what you personally observed and any limitations
            <textarea v-model="statement" class="form-control" rows="3" minlength="10" maxlength="2000" required></textarea>
          </label>
          <label class="confirmation"><input v-model="confirmed" type="checkbox" required> I reviewed the original challenged image and am signing my own statement for this photo.</label>
          <button type="submit" class="btn btn-primary" :disabled="!confirmed || statement.trim().length < 10">Sign and submit witness statement</button>
        </fieldset>
      </form>
    </template>
    <p v-if="error" role="alert">{{ error }}</p>
    <button v-if="error" type="button" class="btn btn-default" :disabled="busy || loading" @click="load">Refresh witness statements</button>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import RecordDateTime from '../record-date-time.vue';
import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { signWitness, verifyWitness } from '../../util/capture-witness';

defineOptions({ name: 'SubmissionCaptureWitness' });
const props = defineProps({ item: { type: Object, required: true }, projectId: { type: String, required: true }, xmlFormId: { type: String, required: true }, instanceId: { type: String, required: true } });
const { request } = useRequest(); const loading = ref(false); const busy = ref(false); const error = ref('');
const records = ref([]); const context = ref(null); const bindingCurrent = ref(false); const statement = ref(''); const confirmed = ref(false);
const base = computed(() => `${apiPaths.submission(props.projectId, props.xmlFormId, props.instanceId)}/capture-challenges/${encodeURIComponent(props.item.id)}/witnesses`);
let generation = 0; let pending = null;
onBeforeUnmount(() => { generation += 1; pending = null; });
const load = async () => {
  generation += 1; const current = generation; pending = null; statement.value = ''; confirmed.value = false; records.value = []; context.value = null; busy.value = false; loading.value = true; error.value = '';
  try {
    const response = await request({ method: 'GET', url: base.value, alert: false });
    const { data } = response;
    if (!Array.isArray(data.items) || data.items.length > 10 || typeof data.bindingCurrent !== 'boolean' || typeof data.canWitness !== 'boolean') throw new Error('Invalid witness history');
    const verified = await Promise.all(data.items.map(record => verifyWitness(record, props.item)));
    if (current !== generation) return;
    records.value = verified; bindingCurrent.value = data.bindingCurrent;
    context.value = data.canWitness && data.bindingCurrent && data.context?.challengeId === props.item.id && data.context?.contentHash === props.item.contentHash ? data.context : null;
  } catch { if (current === generation) error.value = 'Witness statements could not be loaded or verified. Refresh to try again.'; } finally { if (current === generation) loading.value = false; }
};
const save = async () => {
  if (busy.value || !context.value || !confirmed.value || statement.value.trim().length < 10) return;
  const current = generation; const text = statement.value.trim();
  if (pending && pending.statement !== text) { error.value = 'An earlier submission was interrupted. Retry that statement or refresh before changing it.'; return; }
  busy.value = true; error.value = '';
  try {
    const envelope = pending ?? await signWitness(context.value, text);
    if (current !== generation) return;
    pending = envelope;
    const response = await request({ method: 'POST', url: base.value, data: envelope, alert: false });
    await verifyWitness(response.data.witness, props.item);
    if (current === generation) await load();
  } catch (failure) {
    if (current !== generation) return;
    error.value = [400, 409].includes(failure.response?.status) ? 'The signing context expired, the image changed, or a statement already exists. Refresh before signing again.' : 'Submission could not be confirmed. Retry the same statement or refresh to check its history.';
  } finally { if (current === generation) busy.value = false; }
};
const download = record => {
  const { statement: text, signedAt, ...envelope } = record;
  const url = URL.createObjectURL(new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `witness-${record.id}.json`; link.click(); URL.revokeObjectURL(url);
};
watch(() => [props.item, props.projectId, props.xmlFormId, props.instanceId], load, { immediate: true });
</script>
<style scoped>
.capture-witness { border-top: 1px solid #e8eef0; margin-top: 20px; padding-top: 16px; } h4, h5 { font-size: 16px; font-weight: 700; }
form { background: #f6f9fa; padding: 16px; border-radius: 8px; } fieldset { display: grid; gap: 12px; } label { display: block; } .confirmation { display: flex; align-items: flex-start; gap: 8px; }
p, label, strong { overflow-wrap: anywhere; } .btn { max-width: 100%; white-space: normal; } ol { padding-left: 20px; } li { margin-bottom: 16px; } .outdated { color: #805619; }
</style>
