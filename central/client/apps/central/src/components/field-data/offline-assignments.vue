<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="offline-assignments" aria-label="Protected offline assignments">
    <h2>Protected offline assignments</h2>
    <p>Save a read-only snapshot on this device. Load this page before going offline; the page itself is not cached.</p>
    <p>Your separate passphrase protects the saved instructions. App User keys and passphrases are never saved.</p>
    <p>A successful live inbox refresh removes the older snapshot. Save a new one after checking the current instructions.</p>
    <form v-if="connected" @submit.prevent="save">
      <label for="offline-save-password">New offline passphrase (12–128 characters)</label>
      <input id="offline-save-password" v-model="savePassword" type="password" class="form-control"
        autocomplete="new-password" minlength="12" maxlength="128" required>
      <label for="offline-confirm-password">Confirm offline passphrase</label>
      <input id="offline-confirm-password" v-model="confirmation" type="password" class="form-control"
        autocomplete="new-password" minlength="12" maxlength="128" required>
      <p v-if="hasSaved">Saving replaces the one encrypted snapshot stored on this device.</p>
      <button type="submit" class="btn btn-default" :disabled="busy">Save encrypted snapshot</button>
    </form>
    <template v-if="hasSaved">
      <form v-if="!snapshot" @submit.prevent="unlock">
        <label for="offline-unlock-password">Saved snapshot passphrase</label>
        <input id="offline-unlock-password" v-model="unlockPassword" type="password" class="form-control"
          autocomplete="off" minlength="12" maxlength="128" required>
        <button type="submit" class="btn btn-default" :disabled="busy">Unlock saved snapshot</button>
      </form>
      <button v-else type="button" class="btn btn-default" @click="lock">Lock snapshot</button>
      <button type="button" class="btn btn-default" :disabled="busy" @click="forget">Forget saved snapshot</button>
    </template>
    <p v-if="message" role="status">{{ message }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="snapshot">
      <p>{{ snapshot.appUser.name }} · {{ snapshot.appUser.projectName }}</p>
      <p>Read-only snapshot from {{ snapshot.issuedAt }}. Expires {{ snapshot.expiresAt }}.</p>
      <p>Assignments may have changed or access may have been revoked since this snapshot. Reconnect to check before acting.</p>
      <p v-if="!snapshot.complete">Only the newest 50 instructions are included.</p>
      <p v-if="snapshot.items.length === 0">No instructions were available when this snapshot was saved.</p>
      <ul>
        <li v-for="item of snapshot.items" :key="item.id">
          <h3>{{ item.formName || item.xmlFormId }} ({{ item.xmlFormId }})</h3>
          <p>{{ item.question }}</p>
          <p>Snapshot status: {{ item.status }} · Due: {{ item.dueAt || 'Not set' }}</p>
          <p v-if="!item.actionable">This request was unavailable for collection at the time of the snapshot.</p>
          <p>Request ID: {{ item.id }}</p>
        </li>
      </ul>
      <p>This snapshot cannot acknowledge a request, complete a visit or submit a decision.</p>
    </template>
  </section>
</template>
<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { decryptSnapshot, encryptSnapshot, storedSnapshot, validateTime, verifySnapshot } from '../../util/offline-assignments';

defineOptions({ name: 'FieldDataOfflineAssignments' });
const props = defineProps({
  connected: Boolean, sessionId: { type: Number, required: true },
  revocation: { type: Number, required: true }, fetchBundle: { type: Function, required: true }
});
const snapshot = ref(null);
const hasSaved = ref(false);
const savePassword = ref('');
const confirmation = ref('');
const unlockPassword = ref('');
const busy = ref(false);
const error = ref('');
const message = ref('');
let generation = 0;
let disposed = false;
let timer;
const lock = () => {
  generation += 1;
  snapshot.value = null;
  savePassword.value = '';
  confirmation.value = '';
  unlockPassword.value = '';
  busy.value = false;
  message.value = '';
};
const active = current => !disposed && generation === current;
const save = async () => {
  if (savePassword.value !== confirmation.value) { error.value = 'Passphrases do not match.'; return; }
  const password = savePassword.value;
  savePassword.value = '';
  confirmation.value = '';
  generation += 1;
  const current = generation;
  busy.value = true;
  error.value = '';
  message.value = '';
  snapshot.value = null;
  try {
    const response = await props.fetchBundle();
    if (!active(current)) return;
    if (!response.enabled) { message.value = 'Offline signing is not configured on this server.'; return; }
    await verifySnapshot(response.bundle);
    if (!active(current)) return;
    const record = await encryptSnapshot(response.bundle, password);
    if (!active(current)) return;
    await storedSnapshot('write', record, () => active(current));
    if (active(current)) {
      hasSaved.value = true;
      message.value = 'Encrypted snapshot saved on this device. Unlock it with your separate passphrase.';
    }
  } catch {
    if (active(current)) error.value = 'Snapshot could not be saved. Check access, signing configuration and device storage, then retry.';
  } finally { if (active(current)) busy.value = false; }
};
const unlock = async () => {
  const password = unlockPassword.value;
  unlockPassword.value = '';
  generation += 1;
  const current = generation;
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    const record = await storedSnapshot('read');
    const data = await decryptSnapshot(record, password);
    if (active(current)) snapshot.value = data;
  } catch {
    if (active(current)) error.value = 'Snapshot could not be unlocked. Check the passphrase, expiry and device clock; corrupted or unsupported snapshots are rejected.';
  } finally { if (active(current)) busy.value = false; }
};
const forget = async (notify = true) => {
  lock();
  const current = generation;
  busy.value = true;
  error.value = '';
  try {
    await storedSnapshot('delete');
    if (active(current)) { hasSaved.value = false; message.value = notify ? 'Saved snapshot forgotten.' : ''; }
  } catch {
    if (active(current)) error.value = 'Saved snapshot could not be removed. Retry or clear this site’s browser storage.';
  } finally { if (active(current)) busy.value = false; }
};
watch(() => props.sessionId, () => { lock(); error.value = ''; });
watch(() => props.revocation, () => forget(false));
onMounted(async () => {
  const current = generation;
  try { const record = await storedSnapshot('read'); if (active(current)) hasSaved.value = record != null; } catch {
    if (active(current)) error.value = 'Offline storage is unavailable in this browser.';
  }
  if (disposed) return;
  timer = setInterval(() => {
    if (snapshot.value) {
      try { validateTime(snapshot.value); } catch { lock(); error.value = 'Snapshot expired or the device clock changed. Reconnect for a new snapshot.'; }
    }
  }, 30000);
});
onBeforeUnmount(() => { disposed = true; clearInterval(timer); lock(); });
</script>
<style scoped>
.offline-assignments { border-top: 1px solid #bbb; margin-top: 24px; padding-top: 16px; overflow-wrap: anywhere; }
.offline-assignments input { margin-bottom: 8px; }
.offline-assignments button { margin: 4px 8px 4px 0; }
</style>
