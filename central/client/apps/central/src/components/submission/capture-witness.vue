<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="capture-witness" aria-label="Signed witness statements">
    <h4>Witness statements</h4>
    <p>A signature protects the statement and image fingerprint. Account identity is recorded at submission; it does not prove physical presence, independence of people or the truth of the claim.</p>
    <p v-if="loading" role="status">Loading witness statements…</p>
    <template v-else>
      <p v-if="records.length && !bindingCurrent" class="outdated" role="status">These statements refer to an earlier image or submission version.</p>
      <p v-if="records.length" role="status">{{ activeCount }} active statements for the current image. This is not a count of supporting votes or independent people.</p>
      <ol v-if="records.length">
        <li v-for="record of records" :key="record.id">
          <strong>{{ record.witnessName }}</strong> · Signature verified
          <p v-if="record.status === 'withdrawn'" role="status">Withdrawn — not active corroboration.</p>
          <p v-else-if="record.status === 'unknown'" role="status">Lifecycle history unavailable. Refresh before relying on this statement as active.</p>
          <p v-else role="status">{{ record.keyTrust.status === 'clear' ? (bindingCurrent ? 'Active statement for this image.' : 'Historical statement for an earlier image or version.') : 'Retained signed statement; current key trust is withheld.' }}</p>
          <witness-key-trust :record="record" :base="base" @refresh="load"/>
          <p v-if="record.effectiveStatement">{{ record.effectiveStatement }}</p>
          <details v-if="record.verifiedEvents.length">
            <summary>Original statement and signed change history</summary>
            <p><strong>Original:</strong> {{ record.statement }}</p>
            <ol>
<li v-for="event of record.verifiedEvents" :key="event.id">
              <strong>{{ event.action === 'withdraw' ? 'Withdrawal' : 'Correction' }} {{ event.sequence }}</strong> · Signature verified
              <p v-if="event.statement">{{ event.statement }}</p><p>Reason: {{ event.reason }}</p>
              <p>{{ event.actorName }} · Recorded <record-date-time :iso="event.receivedAt"/></p>
            </li>
</ol>
          </details>
          <p>Recorded <record-date-time :iso="record.receivedAt"/></p>
          <button type="button" class="btn btn-default" @click="download(record)">Download signed statement</button>
          <button v-if="record.changeContext" type="button" class="btn btn-link" :disabled="busy" @click="edit(record)">Correct or withdraw your statement</button>
          <form v-if="editing === record.id" @submit.prevent="saveChange(record)">
            <h5>Change your witness statement</h5>
            <p>The original signature remains in history. Withdrawal is final. Changes refer to the original image, including when it has been replaced.</p>
            <fieldset :disabled="busy">
              <label>Change type <select v-model="action" class="form-control"><option value="correct" :disabled="!record.canCorrect || record.keyTrust.status !== 'clear'">Correction</option><option value="withdraw">Withdrawal</option></select></label>
              <label v-if="action === 'correct'">Corrected statement <textarea v-model="replacement" class="form-control" rows="3" minlength="10" maxlength="2000" required></textarea></label>
              <label>Reason for this change <textarea v-model="reason" class="form-control" rows="2" minlength="10" maxlength="2000" required></textarea></label>
              <label class="confirmation"><input v-model="changeConfirmed" type="checkbox" required> I am signing this change to my own witness statement.</label>
              <button type="submit" class="btn btn-primary" :disabled="!changeConfirmed || reason.trim().length < 10 || (action === 'correct' && replacement.trim().length < 10)">{{ action === 'withdraw' ? 'Sign and withdraw statement' : 'Sign and submit correction' }}</button>
              <button type="button" class="btn btn-default" @click="cancelEdit">Cancel change</button>
            </fieldset>
          </form>
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
import WitnessKeyTrust from './witness-key-trust.vue';
import verifyKeyTrust from '../../util/witness-key-trust';
import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { signWitness, signWitnessChange, verifyWitness } from '../../util/capture-witness';

defineOptions({ name: 'SubmissionCaptureWitness' });
const props = defineProps({ item: { type: Object, required: true }, projectId: { type: String, required: true }, xmlFormId: { type: String, required: true }, instanceId: { type: String, required: true } });
const { request } = useRequest(); const loading = ref(false); const busy = ref(false); const error = ref('');
const records = ref([]); const context = ref(null); const bindingCurrent = ref(false); const statement = ref(''); const confirmed = ref(false);
const base = computed(() => `${apiPaths.submission(props.projectId, props.xmlFormId, props.instanceId)}/capture-challenges/${encodeURIComponent(props.item.id)}/witnesses`);
const editing = ref(null); const action = ref('correct'); const replacement = ref(''); const reason = ref(''); const changeConfirmed = ref(false);
const activeCount = computed(() => (bindingCurrent.value ? records.value.filter(record => record.status === 'active' && record.keyTrust.status === 'clear').length : 0));
let pendingChange = null;
const cancelEdit = () => { editing.value = null; pendingChange = null; replacement.value = ''; reason.value = ''; changeConfirmed.value = false; };
const edit = record => {
  if (pendingChange) { error.value = 'Retry the interrupted change or refresh its history before starting another change.'; return; }
  editing.value = record.id; action.value = record.canCorrect && record.keyTrust.status === 'clear' ? 'correct' : 'withdraw'; replacement.value = record.effectiveStatement ?? '';
  reason.value = ''; changeConfirmed.value = false; error.value = '';
};
let generation = 0; let pending = null;
onBeforeUnmount(() => { generation += 1; pending = null; cancelEdit(); });
const load = async () => {
  generation += 1; const current = generation; pending = null; cancelEdit(); statement.value = ''; confirmed.value = false; records.value = []; context.value = null; busy.value = false; loading.value = true; error.value = '';
  try {
    const response = await request({ method: 'GET', url: base.value, alert: false });
    const { data } = response;
    if (!Array.isArray(data.items) || data.items.length > 10 || typeof data.bindingCurrent !== 'boolean' || typeof data.canWitness !== 'boolean') throw new Error('Invalid witness history');
    const verified = await Promise.all(data.items.map(async record => ({ ...await verifyWitness(record, props.item), keyTrust: await verifyKeyTrust(record, props.projectId) })));
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
const saveChange = async record => {
  if (busy.value || !record.changeContext || !changeConfirmed.value || reason.value.trim().length < 10 ||
    (action.value === 'correct' && replacement.value.trim().length < 10)) return;
  const fields = { action: action.value, statement: action.value === 'withdraw' ? null : replacement.value.trim(), reason: reason.value.trim() };
  if (pendingChange && (pendingChange.recordId !== record.id || Object.keys(fields).some(key => fields[key] !== pendingChange.envelope[key]))) {
    error.value = 'An earlier change was interrupted. Retry that exact change or refresh its history before changing it.'; return;
  }
  const current = generation; busy.value = true; error.value = '';
  try {
    const envelope = pendingChange?.envelope ?? await signWitnessChange(record.changeContext, fields.action, fields.statement, fields.reason);
    if (current !== generation) return;
    pendingChange = { recordId: record.id, envelope };
    const response = await request({ method: 'POST', url: `${base.value}/${encodeURIComponent(record.id)}/events`, data: envelope, alert: false });
    await verifyWitness(response.data.witness, props.item);
    if (current === generation) await load();
  } catch (failure) {
    if (current !== generation) return;
    error.value = [400, 409].includes(failure.response?.status) ? 'The statement history changed or the signing context expired. Refresh before signing again.'
      : 'Change could not be confirmed. Retry the same change or refresh to check its history.';
  } finally { if (current === generation) busy.value = false; }
};
const download = record => {
  const { id, witnessId, witnessName, receivedAt, algorithm, payload, publicKey, signature, events, status, revision } = record;
  const envelope = {
    id, witnessId, witnessName, receivedAt, algorithm, payload, publicKey, signature,
    keyTrust: { status: record.keyTrust.status, checkedAt: record.keyTrust.checkedAt, keys: record.keyTrust.keys.map(key => ({ keyHash: key.keyHash, revocation: key.revocation })) },
    ...(events === undefined ? {} : { events, status, revision })
  };
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
