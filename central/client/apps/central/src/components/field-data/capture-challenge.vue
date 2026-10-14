<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="capture-challenge" aria-labelledby="capture-challenge-title">
    <h2 id="capture-challenge-title">Capture a challenged photo</h2>
    <p>Use a missing image attachment on your own synced submission. Write the challenge code on paper and include it beside the subject in the photo. Capture and upload within 20 minutes.</p>
    <p>The server checks the challenge, stored bytes and exact image reuse. A reviewer must still assess the code and scene. This does not prove location, device identity or capture time.</p>
    <fieldset :disabled="busy || challenge != null">
      <label>Capture form ID <input v-model.trim="xmlFormId" class="form-control" maxlength="1000"></label>
      <label>Capture submission instance ID <input v-model.trim="instanceId" class="form-control" maxlength="1000"></label>
      <label>Expected image filename <input v-model.trim="name" class="form-control" maxlength="255" placeholder="photo.jpg"></label>
    </fieldset>
    <div class="actions">
      <button type="button" class="btn btn-primary" :disabled="busy || challenge != null || !xmlFormId || !instanceId || !name" @click="issue">Get capture challenge</button>
      <button type="button" class="btn btn-default" :disabled="busy" @click="refresh">Recover issued challenge</button>
      <button v-if="challenge" type="button" class="btn btn-default" :disabled="busy" @click="cancel">Cancel challenge</button>
    </div>
    <template v-if="challenge">
      <p class="challenge-code">Write this code in the scene: <strong>{{ challenge.code }}</strong></p>
      <p>{{ challenge.xmlFormId }} · {{ challenge.instanceId }} · {{ challenge.name }} · Expires {{ new Date(challenge.expiresAt).toLocaleString() }}</p>
      <div class="actions">
        <button type="button" class="btn btn-default" :disabled="busy || streaming" @click="openCamera">Open camera</button>
        <button type="button" class="btn btn-primary" :disabled="busy || !streaming" @click="capture">Capture photo and add to queue</button>
        <button type="button" class="btn btn-default" :disabled="!streaming && !busy" @click="stopCamera">Close camera</button>
      </div>
      <div class="location-consent">
        <label><input v-model="includeLocation" type="checkbox" :disabled="busy"> Include an optional location reading with this photo</label>
        <p>Use this only where sharing your location is appropriate. One reading is taken on request, not continuously. Uploading the photo shares the reading with authorized reviewers.</p>
        <div v-if="includeLocation" class="actions">
          <button type="button" class="btn btn-default" :disabled="busy || !streaming" @click="readLocation">Read location for photo</button>
          <button type="button" class="btn btn-default" :disabled="!location" @click="clearLocation">Remove location reading</button>
        </div>
        <p v-if="location">Device-reported location: {{ location.latitude.toFixed(6) }}, {{ location.longitude.toFixed(6) }} · Reported accuracy ±{{ Math.ceil(location.accuracy) }} m. Capture within 60 seconds to include it.</p>
        <p v-if="locationMessage" role="status">{{ locationMessage }}</p>
      </div>
      <video ref="video" autoplay muted playsinline aria-label="Camera preview"></video>
    </template>
    <p v-if="busy || message" role="status">{{ busy ? 'Working on the capture challenge…' : message }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>
<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { checkedLocation } from '../../util/capture-location';

defineOptions({ name: 'FieldDataCaptureChallenge' });
const props = defineProps({ send: { type: Function, required: true } });
const emit = defineEmits(['capture']);
const xmlFormId = ref(''); const instanceId = ref(''); const name = ref(''); const challenge = ref(null);
const busy = ref(false); const streaming = ref(false); const video = ref(null); const message = ref(''); const error = ref('');
const includeLocation = ref(false); const location = ref(null); const locationMessage = ref('');
let locationGeneration = 0; let locationAbort = null;
const clearLocation = () => { locationGeneration += 1; locationAbort?.(); locationAbort = null; location.value = null; locationMessage.value = ''; };
watch(includeLocation, value => { if (!value) clearLocation(); });
let stream = null; let generation = 0; let cameraGeneration = 0; let pendingId = null; let timer;
const stopCamera = () => {
  clearLocation();
  cameraGeneration += 1; stream?.getTracks().forEach(track => track.stop()); stream = null; streaming.value = false;
  if (video.value) video.value.srcObject = null;
};
const clear = () => { generation += 1; clearTimeout(timer); stopCamera(); challenge.value = null; includeLocation.value = false; pendingId = null; busy.value = false; };
const visibility = () => { if (document.hidden) stopCamera(); };
onMounted(() => document.addEventListener('visibilitychange', visibility));
onBeforeUnmount(() => { document.removeEventListener('visibilitychange', visibility); clear(); });
watch(() => [xmlFormId.value, instanceId.value, name.value], () => { if (challenge.value == null) pendingId = null; });
const accept = row => {
  if (!row || row.status !== 'issued' || !/^[0-9a-f-]{36}$/i.test(row.id ?? '') || !/^[0-9a-f]{64}$/.test(row.nonce ?? '') ||
    row.code !== row.nonce.slice(0, 8).toUpperCase() || row.xmlFormId !== xmlFormId.value || row.instanceId !== instanceId.value || row.name !== name.value ||
    !Number.isFinite(Date.parse(row.issuedAt)) || !Number.isFinite(Date.parse(row.expiresAt)) || Date.parse(row.expiresAt) <= Date.now() ||
    Date.parse(row.expiresAt) - Date.parse(row.issuedAt) > 20 * 60000) throw new Error('Invalid challenge');
  challenge.value = row;
  clearTimeout(timer); timer = setTimeout(() => { clear(); error.value = 'Capture window ended. Start a new capture for any files that were not linked.'; }, Math.max(0, Date.parse(row.expiresAt) - Date.now()));
};
const perform = async action => {
  if (busy.value) return;
  const current = generation; busy.value = true; error.value = ''; message.value = '';
  try { await action(() => current === generation); } catch (failure) {
    if (current === generation) error.value = failure.status === 409
      ? 'Challenge unavailable, consumed or expired. Cancel it and start a new capture.'
      : 'Could not complete this step. Check camera permission, connectivity and the missing attachment target; retry or recover the issued challenge.';
  } finally { if (current === generation) busy.value = false; }
};
const issue = () => perform(async isCurrent => {
  pendingId ??= crypto.randomUUID();
  const row = await props.send('', 'POST', { id: pendingId, xmlFormId: xmlFormId.value, instanceId: instanceId.value, name: name.value });
  if (isCurrent()) { accept(row); message.value = 'Challenge issued. Include the paper code in your photo.'; }
});
const refresh = () => perform(async isCurrent => {
  const data = await props.send('', 'GET');
  if (!isCurrent()) return;
  if (!Array.isArray(data.items) || data.items.length > 20) throw new Error('Invalid challenge list');
  const row = data.items.find(item => ['issued', 'bound'].includes(item.status) && item.xmlFormId === xmlFormId.value && item.instanceId === instanceId.value && item.name === name.value);
  if (!row) throw new Error('No issued challenge');
  if (row.status === 'bound') { clear(); message.value = 'This challenge was already linked to an image. Review the submission evidence.'; return; }
  accept(row); pendingId = row.id; message.value = 'Issued challenge recovered. Capture a new photo before expiry.';
});
const cancel = () => perform(async isCurrent => {
  await props.send(`/${encodeURIComponent(challenge.value.id)}`, 'DELETE');
  if (isCurrent()) { clear(); message.value = 'Challenge cancelled. Remove any matching queued photo before starting again.'; }
});
const openCamera = () => perform(async isCurrent => {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera unavailable');
  cameraGeneration += 1; const camera = cameraGeneration;
  const acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  if (!isCurrent() || camera !== cameraGeneration) { acquired.getTracks().forEach(track => track.stop()); return; }
  stream = acquired; acquired.getTracks().forEach(track => { track.addEventListener('ended', stopCamera); }); await nextTick();
  if (!isCurrent() || camera !== cameraGeneration || !video.value) { stopCamera(); return; }
  video.value.srcObject = acquired;
  try { await video.value.play(); } catch (failure) { stopCamera(); throw failure; }
  if (isCurrent() && camera === cameraGeneration) { streaming.value = true; message.value = 'Camera ready. Keep the paper code and subject visible.'; }
});
const readLocation = () => perform(async isCurrent => {
  if (!includeLocation.value || !streaming.value || !navigator.geolocation) { locationMessage.value = 'Location is unavailable. You can capture without a location reading.'; return; }
  clearLocation(); const reading = locationGeneration;
  const position = await new Promise(resolve => {
    locationAbort = () => resolve(null);
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
  });
  if (!isCurrent() || reading !== locationGeneration || !includeLocation.value || !streaming.value || document.hidden) return;
  locationAbort = null;
  try {
    if (!position) throw new Error('Location denied or unavailable');
    const now = Date.now();
    const candidate = checkedLocation({
      source: 'browser-geolocation', latitude: position.coords.latitude, longitude: position.coords.longitude,
      accuracy: position.coords.accuracy, sampledAt: new Date(position.timestamp).toISOString(), capturedAt: new Date(now).toISOString()
    });
    const { capturedAt, ...sample } = candidate;
    location.value = sample; locationMessage.value = 'Reading ready. Its coordinates and accuracy are reported by the device and are not independently verified.';
  } catch { location.value = null; locationMessage.value = 'Location was denied, stale or unavailable. You can capture without a location reading.'; }
});
const capture = () => perform(async isCurrent => {
  const currentChallenge = challenge.value; const preview = video.value; const camera = cameraGeneration;
  if (!currentChallenge || Date.parse(currentChallenge.expiresAt) <= Date.now() || !preview?.videoWidth || !preview.videoHeight) throw new Error('Capture unavailable');
  const capturedAt = new Date().toISOString(); let captureLocation;
  if (includeLocation.value && location.value) {
    try { captureLocation = checkedLocation({ ...location.value, capturedAt }); } catch { captureLocation = undefined; }
  }
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1920 / Math.max(preview.videoWidth, preview.videoHeight));
  canvas.width = Math.round(preview.videoWidth * scale); canvas.height = Math.round(preview.videoHeight * scale);
  canvas.getContext('2d').drawImage(preview, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => { canvas.toBlob(resolve, 'image/jpeg', 0.9); });
  canvas.width = 0; canvas.height = 0;
  if (!isCurrent() || camera !== cameraGeneration) return;
  if (!blob || blob.type !== 'image/jpeg' || blob.size > 5 * 1024 * 1024 || Date.parse(currentChallenge.expiresAt) <= Date.now()) throw new Error('Invalid capture');
  emit('capture', [{
    file: new File([blob], currentChallenge.name, { type: 'image/jpeg' }), xmlFormId: currentChallenge.xmlFormId,
    instanceId: currentChallenge.instanceId, priority: 1, challengeId: currentChallenge.id, challengeNonce: currentChallenge.nonce, challengeIssuedAt: currentChallenge.issuedAt, challengeExpiresAt: currentChallenge.expiresAt, ...(captureLocation == null ? {} : { captureLocation })
  }]);
  stopCamera(); message.value = captureLocation == null
    ? 'Photo offered to the upload queue without a location reading. Review it, then upload before the challenge expires.'
    : 'Photo and device-reported location offered to the upload queue. Review them, then upload before the challenge expires.';
});
</script>
<style scoped>
.capture-challenge { margin-top: 24px; padding: 24px; background: #fff; border: 1px solid #d9e5e9; border-radius: 12px; }
fieldset { display: grid; gap: 12px; } label { display: block; } .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
video { display: block; width: 100%; max-height: 420px; background: #edf3f5; border-radius: 8px; }
.location-consent { margin: 16px 0; padding: 16px; border: 1px solid #d9e5e9; border-radius: 8px; }
.challenge-code { padding: 16px; background: #edf7f8; border-radius: 8px; } .challenge-code strong { font-family: monospace; font-size: 22px; }
p, label, button { overflow-wrap: anywhere; } .btn { max-width: 100%; white-space: normal; } input { max-width: 100%; }
@media (max-width: 480px) { .capture-challenge { padding: 16px; } }
</style>
