<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section aria-label="Sensor signing keys" class="sensor-keys"><h2>Sensor signing keys</h2>
    <p>Enroll a public key supplied by an external sensor operator. The operator keeps its private key. Project enrollment is a reviewed trust assertion, not hardware attestation, calibration or proof of independent people.</p>
    <button type="button" class="btn btn-default" :disabled="busy" @click="load(false)">{{ catalogue ? 'Refresh sensor key registry' : 'Open sensor key registry' }}</button><p v-if="error" role="alert">{{ error }}</p>
    <template v-if="catalogue">
      <p v-if="!catalogue.signingAvailable">New enrollment is unavailable: the project is archived or server signing is not configured.</p>
      <form @submit.prevent="enroll"><fieldset :disabled="busy || pending != null || !catalogue.signingAvailable"><legend>Enroll an external sensor key</legend>
        <label>Sensor label<input v-model="label" class="form-control" maxlength="100" required></label><label>External operator label<input v-model="operatorLabel" class="form-control" maxlength="200" required></label>
        <label>Sensor measurement type<select v-model="sensorKind" class="form-control"><option value="proximity">Proximity distance and uncertainty</option><option value="location">Location and reported accuracy</option><option value="measurement">Named scalar measurement</option></select></label>
        <label>Public P-256 key JSON<textarea v-model="publicKey" class="form-control" rows="4" maxlength="4000" required/></label>
        <label>Sensor key expires (UTC)<input v-model="expiresAt" type="datetime-local" class="form-control" required></label><label>Provisioning and independence review note<textarea v-model="verificationNote" class="form-control" minlength="10" maxlength="2000" required/></label>
        <p>Labels and provisioning notes accompany reading exports to source readers. Do not include private credentials or document numbers.</p><label><input v-model="reviewed" type="checkbox" required> I checked the external public key, operator provenance and stated sensor type.</label>
        <button type="submit" class="btn btn-primary">Enroll sensor signing key</button>
      </fieldset></form>
      <button v-if="pending" type="button" class="btn btn-default" :disabled="busy" @click="send">Retry exact sensor key change</button>
      <h3>Active sensor keys</h3><p v-if="!catalogue.devices.length">No active sensor keys.</p>
      <ul><li v-for="device of catalogue.devices" :key="device.id"><strong>{{ device.label }}</strong> · {{ device.operatorLabel }} · {{ device.sensorKind }} · expires {{ device.expiresAt }}<p><code>{{ device.keyHash }}</code></p><button type="button" class="btn btn-link" @click="download(device, `sensor-enrollment-${device.id}.json`)">Download signed enrollment</button></li></ul>
      <h3>Signed enrollment and revocation history</h3><ol><li v-for="item of catalogue.history.items" :key="item.id">{{ item.kind }} · {{ item.label ?? item.deviceId }} · {{ item.enrolledAt ?? item.revokedAt }}<p>{{ item.verificationNote ?? item.reason }}</p>
        <template v-if="item.kind === 'enroll'"><label>Revocation reason for {{ item.label }}<textarea v-model="reasons[item.deviceId]" class="form-control" maxlength="2000" :disabled="busy || pending != null"/></label><button type="button" class="btn btn-default" :disabled="busy || pending != null || !catalogue.revocationAvailable || (reasons[item.deviceId] ?? '').trim().length < 10" @click="revoke(item)">Revoke sensor key {{ item.label }}</button></template>
      </li></ol><button v-if="catalogue.history.nextBefore != null" type="button" class="btn btn-default" :disabled="busy || pending != null" @click="load(true)">Load earlier sensor key history</button>
    </template>
  </section>
</template>
<script setup>
import { onBeforeUnmount, ref } from 'vue';
import useRequest from '../../composables/request';
import { verifySensorAuthority } from '../../util/sensor-corroboration';
defineOptions({ name: 'FieldDataSensorKeys' });
const props = defineProps({ projectId: { type: [String, Number], required: true } }); const { request } = useRequest();
const catalogue = ref(null); const busy = ref(false); const error = ref(''); const pending = ref(null); const label = ref(''); const operatorLabel = ref(''); const sensorKind = ref('proximity'); const publicKey = ref(''); const expiresAt = ref(''); const verificationNote = ref(''); const reviewed = ref(false); const reasons = ref({}); let generation = 0;
const base = () => `/v1/projects/${encodeURIComponent(props.projectId)}/sensor-keys`; onBeforeUnmount(() => { generation += 1; });
const verified = async item => { const details = await verifySensorAuthority(item.attestation, item.kind === 'enroll' ? 'enrollment' : 'key-revocation', props.projectId); if (!['enroll','revoke'].includes(item.kind) || details.deviceId !== item.deviceId || Object.keys(details).some(key => !['purpose','issuer'].includes(key) && (key === 'publicKey' ? ['kty','crv','x','y'].some(part => details[key][part] !== item[key]?.[part]) : details[key] !== item[key]))) throw new Error('Invalid sensor key history'); return item; };
const read = async earlier => { const { data } = await request({ method: 'GET', url: base(), params: earlier ? { before: catalogue.value.history.nextBefore } : {}, alert: false }); if (data.method !== 'sensor-key-registry@1' || !Array.isArray(data.devices) || !Array.isArray(data.history?.items)) throw new Error(); await Promise.all([...data.devices, ...data.history.items].map(verified)); return data; };
const load = async earlier => { if (busy.value) return; const current = ++generation; busy.value = true; error.value = ''; try { const data = await read(earlier); if (current === generation) { catalogue.value = earlier ? { ...data, history: { ...data.history, items: [...catalogue.value.history.items, ...data.history.items] } } : data; pending.value = null; } } catch { if (current === generation) { catalogue.value = null; error.value = 'Sensor key registry could not be loaded or verified. Refresh to check access.'; } } finally { if (current === generation) busy.value = false; } };
const send = async () => { if (busy.value || !pending.value) return; const current = generation; busy.value = true; error.value = ''; try { const { data } = await request({ method: 'POST', url: pending.value.url, data: pending.value.body, alert: false }); await verified(data.item); if (current !== generation) return; pending.value = null; catalogue.value = await read(false); verificationNote.value = ''; reviewed.value = false; reasons.value = {}; } catch (failure) { if (current === generation) { if ([400,403,404,409].includes(failure.response?.status)) pending.value = null; if ([403,404].includes(failure.response?.status)) catalogue.value = null; error.value = 'Sensor key change could not be confirmed. Retry the exact change or refresh its history before another change.'; } } finally { if (current === generation) busy.value = false; } };
const enroll = () => { if (pending.value || !reviewed.value) return; try { pending.value = { url: base(), body: { requestId: crypto.randomUUID(), label: label.value.trim(), operatorLabel: operatorLabel.value.trim(), sensorKind: sensorKind.value, publicKey: JSON.parse(publicKey.value), expiresAt: new Date(`${expiresAt.value}:00Z`).toISOString(), verificationNote: verificationNote.value.trim(), reviewed: true } }; send(); } catch { error.value = 'Use public key JSON and a valid UTC expiry.'; } };
const revoke = item => { pending.value = { url: `${base()}/${item.deviceId}/revoke`, body: { requestId: crypto.randomUUID(), reason: (reasons.value[item.deviceId] ?? '').trim() } }; send(); };
const download = (value, name) => { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); };
</script>
<style scoped>
.sensor-keys { margin: 20px 0; padding: 16px; border: 1px solid #ccd6dd; overflow-wrap: anywhere; } fieldset { display: grid; gap: 10px; min-width: 0; } label { display: block; } .btn { min-height: 44px; max-width: 100%; white-space: normal; } code { overflow-wrap: anywhere; } li { margin: 12px 0; }
</style>
