<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section aria-label="Signed sensor corroboration" class="sensor-corroboration"><h4>Signed sensor corroboration</h4>
    <p>External sensor readings can corroborate a challenged image under an enrolled project key. Signatures bind statements to keys; they do not establish hardware provenance, operator independence, calibration or physical presence.</p>
    <button type="button" class="btn btn-default" :disabled="busy" @click="load">{{ snapshot ? 'Refresh sensor readings' : 'Open sensor corroboration' }}</button><p v-if="error" role="alert">{{ error }}</p>
    <template v-if="snapshot">
      <p role="status">{{ snapshot.activeSupported }} current readings have a supporting human review. This is not a presence score or a count of independent people.</p><p>Image integrity: {{ snapshot.sourceIntegrity }} · {{ snapshot.bindingCurrent ? 'Current image/version binding' : 'Historical image/version binding' }}.</p>
      <button type="button" class="btn btn-default" @click="download({ method: 'sensor-challenge-context@1', context: snapshot.context }, `sensor-context-${item.id}.json`)">Download sensor challenge context</button>
      <p>Send this context to the external sensor/operator. Import the resulting ES256 envelope. Device counters and reading identities are unique across the project and stay consumed after source purge; out-of-order counters are allowed.</p>
      <label v-if="snapshot.canWrite">Import signed sensor envelope JSON<input type="file" accept=".json,application/json" :disabled="busy || pending != null" @change="readEnvelope"></label>
      <button v-if="pending" type="button" class="btn btn-default" :disabled="busy" @click="send">Retry exact sensor change</button><p v-if="pending">An earlier change is unconfirmed. Retry it exactly or refresh before changing the draft.</p>
      <p v-if="!snapshot.items.length">No signed sensor readings recorded.</p>
      <article v-for="reading of snapshot.items" :key="reading.id" :aria-label="`Sensor reading ${reading.data.readingId}`">
        <h5>{{ reading.device.label }} · {{ reading.data.measurement.kind }}</h5><p>External operator: {{ reading.device.operatorLabel }} · Device {{ reading.data.deviceId }} · Counter {{ reading.data.counter }}</p>
        <p>Sensor clock: {{ reading.data.sampledAt }} · Server receipt: {{ reading.receivedAt }}</p>
        <dl><template v-for="(value, name) of reading.data.measurement" :key="name"><dt>{{ name }}</dt><dd>{{ value }}</dd></template></dl>
        <p role="status">{{ reading.diagnostics.eligibleForReview ? 'Eligible for human review; not automatic verification.' : 'Supporting corroboration withheld.' }}</p><ul><li v-for="reason of reading.diagnostics.reasons" :key="reason">{{ reason }}</li></ul>
        <p>{{ reading.diagnostics.limitations }}</p><p>Latest human assessment: {{ reading.latestReview?.outcome ?? 'unreviewed' }}</p>
        <ol><li v-for="review of reading.verifiedReviews" :key="review.revision">Revision {{ review.revision }} · {{ review.outcome }} · {{ review.reviewerName }} · {{ review.reviewedAt }}<p>{{ review.reason }}</p></li></ol>
        <button type="button" class="btn btn-default" @click="download({ ...reading, sourceSnapshot: { context: snapshot.context, bindingCurrent: snapshot.bindingCurrent, sourceIntegrity: snapshot.sourceIntegrity } }, `sensor-reading-${reading.id}.json`)">Download signed sensor proof</button>
        <form v-if="snapshot.canReview && (snapshot.canWrite || reading.latestReview)" @submit.prevent="review(reading)"><fieldset :disabled="busy || pending != null || !snapshot.canReview || reading.revision >= 21"><legend>Review this sensor reading</legend>
          <label>Sensor assessment<select aria-label="Sensor assessment" v-model="draft(reading.id).outcome" class="form-control"><option value="inconclusive" :disabled="reading.revision >= 20 || !snapshot.canWrite">Inconclusive</option><option value="supports" :disabled="reading.revision >= 20 || !reading.diagnostics.eligibleForReview || !snapshot.canWrite">Supports the reviewed claim</option><option value="contradicts" :disabled="reading.revision >= 20 || !snapshot.canWrite">Contradicts the reviewed claim</option><option value="withdraw">Withdraw assessment</option></select></label>
          <label>Sensor review reason<textarea v-model="draft(reading.id).reason" class="form-control" minlength="10" maxlength="2000" required/></label><label><input v-model="draft(reading.id).reviewed" type="checkbox" required> {{ draft(reading.id).outcome === 'withdraw' ? 'I reviewed the retained assessment and am withdrawing it.' : 'I inspected the original challenged image and the sensor provenance, timing and uncertainty.' }}</label>
          <button type="submit" class="btn btn-default" :disabled="!draft(reading.id).reviewed || draft(reading.id).reason.trim().length < 10">Save sensor assessment</button>
        </fieldset></form>
      </article>
    </template>
  </section>
</template>
<script setup>
import { onBeforeUnmount, ref } from 'vue';
import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { verifySensorItem } from '../../util/sensor-corroboration';
defineOptions({ name: 'SubmissionSensorCorroboration' });
const props = defineProps({ item: { type: Object, required: true }, projectId: { type: String, required: true }, xmlFormId: { type: String, required: true }, instanceId: { type: String, required: true } });
const { request } = useRequest(); const snapshot = ref(null); const busy = ref(false); const error = ref(''); const pending = ref(null); const drafts = ref({}); let generation = 0;
const base = () => `${apiPaths.submission(props.projectId, props.xmlFormId, props.instanceId)}/capture-challenges/${encodeURIComponent(props.item.id)}/sensors`; onBeforeUnmount(() => { generation += 1; });
const draft = id => { drafts.value[id] ??= { outcome: (snapshot.value?.items.find(item => item.id === id)?.revision ?? 0) >= 20 ? 'withdraw' : 'inconclusive', reason: '', reviewed: false }; return drafts.value[id]; };
const read = async () => { const { data } = await request({ method: 'GET', url: base(), alert: false }); if (data.method !== 'signed-sensor-corroboration@1' || data.context?.challengeId !== props.item.id || data.context?.contentHash !== props.item.contentHash || !Array.isArray(data.items) || data.items.length > 20 || typeof data.bindingCurrent !== 'boolean') throw new Error('Invalid sensor source'); const items = await Promise.all(data.items.map(item => verifySensorItem(item, data.context))); return { ...data, items }; };
const load = async () => { if (busy.value) return; const current = ++generation; snapshot.value = null; error.value = ''; busy.value = true; try { const data = await read(); if (current === generation) { snapshot.value = data; pending.value = null; drafts.value = {}; } } catch { if (current === generation) error.value = 'Sensor readings could not be loaded or verified. Refresh to check source access and key status.'; } finally { if (current === generation) busy.value = false; } };
const send = async () => { if (busy.value || !pending.value) return; const current = generation; busy.value = true; error.value = ''; let saved = false; try { await request({ method: 'POST', url: pending.value.url, data: pending.value.body, alert: false }); if (current !== generation) return; pending.value = null; saved = true; const data = await read(); if (current === generation) { snapshot.value = data; drafts.value = {}; } } catch (failure) { if (current === generation) { if ([400,403,404,409,412].includes(failure.response?.status)) pending.value = null; if ([403,404].includes(failure.response?.status)) snapshot.value = null; error.value = saved ? 'Sensor change was recorded, but its history could not refresh. Refresh to verify current access.' : 'Sensor change could not be confirmed. Retry the exact change or refresh the history before another change.'; } } finally { if (current === generation) busy.value = false; } };
const readEnvelope = async event => { if (pending.value || busy.value) return; try { const file = event.target.files?.[0]; if (!file) return; if (file.size > 32768) throw new Error(); const envelope = JSON.parse(await file.text()); pending.value = { url: base(), body: { requestId: crypto.randomUUID(), envelope } }; send(); } catch { error.value = 'Use a signed sensor envelope JSON file of at most 32 KiB.'; } finally { event.target.value = ''; } };
const review = reading => { if (pending.value || busy.value) return; const value = draft(reading.id); if (!value.reviewed || value.reason.trim().length < 10) return; pending.value = { url: `${base()}/${reading.id}/reviews`, body: { requestId: crypto.randomUUID(), expectedRevision: reading.revision, outcome: value.outcome, reason: value.reason.trim(), reviewedOriginal: value.outcome !== 'withdraw' } }; send(); };
const download = (value, name) => { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url); };
</script>
<style scoped>
.sensor-corroboration { margin-top: 18px; border-top: 1px solid #ccd6dd; padding-top: 12px; overflow-wrap: anywhere; } article { margin: 14px 0; padding: 12px; background: #f6f9fa; } fieldset { display: grid; gap: 10px; min-width: 0; } label { display: block; } .btn { min-height: 44px; max-width: 100%; white-space: normal; } dd { margin-left: 12px; }
</style>
