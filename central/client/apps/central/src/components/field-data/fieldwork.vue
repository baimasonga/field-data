<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="fieldwork" aria-label="App User fieldwork inbox">
    <h1>Fieldwork inbox</h1>
    <p>Backchecks assigned to your App User. Collect and submit the selected form in ODK Collect, then give its synced instance ID to your reviewer.</p>
    <form v-if="!connected" @submit.prevent="connect">
      <label for="fieldwork-key">App User access key or Collect server URL</label>
      <input id="fieldwork-key" v-model.trim="inputKey" type="password" class="form-control"
        autocomplete="off" required maxlength="4096">
      <p>Your project supervisor can provide this from your App User QR panel. The key stays in this tab's memory; closing or disconnecting clears it.</p>
      <button type="submit" class="btn btn-primary" :disabled="loading">Open my inbox</button>
    </form>
    <template v-else>
      <p>{{ identity.name }} · {{ identity.projectName }}</p>
      <div class="actions">
        <button type="button" class="btn btn-default" :disabled="loading" @click="load()">Refresh inbox</button>
        <button type="button" class="btn btn-default" :disabled="pushBusy" @click="disconnect">Disconnect</button>
      </div>
      <p v-if="pushEnabled">Browser push is available. Notifications show a generic update; open this inbox to read it.</p>
      <p v-else>Browser push is not configured on this server. Refresh this inbox to check for updates.</p>
      <button v-if="pushEnabled && !pushActive" type="button" class="btn btn-default"
        :disabled="pushBusy" @click="enablePush">
Enable browser notifications
</button>
      <button v-if="pushActive" type="button" class="btn btn-default"
        :disabled="pushBusy" @click="disablePush">
Turn off browser notifications
</button>
      <p v-if="pushMessage" role="status">{{ pushMessage }}</p>
      <p v-if="!loading && items.length === 0">No backchecks are available for this App User.</p>
      <ul class="tasks">
        <li v-for="item of items" :key="item.id">
          <h2>{{ item.formName || item.xmlFormId }} ({{ item.xmlFormId }})</h2>
          <p class="question">{{ item.question }}</p>
          <p>Status: {{ item.status }} · Due: {{ item.dueAt || 'Not set' }}</p>
          <p>Request ID: {{ item.id }}</p>
          <p v-if="!item.actionable">This task is no longer available for collection. Check with your reviewer before continuing.</p>
          <p v-if="item.seenAt">Acknowledged: {{ item.seenAt }}</p>
          <button v-else type="button" class="btn btn-default" :disabled="acknowledging === item.id"
            @click="acknowledge(item)">
Acknowledge request
</button>
          <p>Acknowledging confirms you saw the request; it does not complete the visit or submit a review decision.</p>
        </li>
      </ul>
      <button v-if="nextCursor" type="button" class="btn btn-default" :disabled="loading" @click="load(nextCursor)">Load older requests</button>
      <h2>Re-verification visits</h2>
      <p>Assets your supervisor asked you to check again. Visit the site, then collect and submit the form in ODK Collect. Your supervisor links the submission to close the visit.</p>
      <p v-if="visitsError" role="alert">{{ visitsError }}</p>
      <p v-else-if="!loading && visits.length === 0">No re-verification visits are assigned to you.</p>
      <ul class="tasks visits">
        <li v-for="visit of visits" :key="visit.id">
          <h3>{{ visit.assetName }} · {{ visit.externalId }}</h3>
          <p>{{ visit.assetType }} · Check: {{ visit.predicate }}</p>
          <p v-if="visit.instruction" class="question">{{ visit.instruction }}</p>
          <p>Form: {{ visit.formName || visit.xmlFormId }} ({{ visit.xmlFormId }}) · Visit by: {{ visit.visitBy || 'Not set' }}</p>
          <p v-if="!visit.actionable">This form is closed for collection. Check with your supervisor before continuing.</p>
        </li>
      </ul>
      <p v-if="visits.length && !visitsComplete">Showing your 50 most recent visits.</p>
    </template>
    <p v-if="loading" role="status">Loading your inbox…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <field-data-offline-assignments :connected="connected" :session-id="sessionId"
      :revocation="offlineRevocation" :fetch-bundle="fetchOfflineBundle"/>
  </section>
</template>
<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import FieldDataOfflineAssignments from './offline-assignments.vue';

defineOptions({ name: 'FieldDataFieldwork' });
const inputKey = ref('');
const connected = ref(false);
const loading = ref(false);
const error = ref('');
const identity = ref({});
const items = ref([]);
const nextCursor = ref(null);
const visits = ref([]);
const visitsComplete = ref(true);
const visitsError = ref('');
const acknowledging = ref(null);
const pushEnabled = ref(false);
const pushActive = ref(false);
const pushBusy = ref(false);
const pushMessage = ref('');
const sessionId = ref(0);
const offlineRevocation = ref(0);
let token = '';
let publicKey = null;
let subscriptionId = null;
let generation = 0;
let controller = new AbortController();
const clear = () => {
  sessionId.value += 1;
  generation += 1;
  controller.abort();
  controller = new AbortController();
  token = '';
  inputKey.value = '';
  connected.value = false;
  items.value = [];
  visits.value = [];
  visitsError.value = '';
  identity.value = {};
  nextCursor.value = null;
  pushEnabled.value = false;
  pushActive.value = false;
  subscriptionId = null;
  publicKey = null;
  loading.value = false;
  pushBusy.value = false;
  acknowledging.value = null;
};
const api = async (path, method = 'GET', body = null) => {
  const current = generation;
  const result = await fetch(`/v1/field-data/app-user/${path}`, {
    method, credentials: 'omit', cache: 'no-store', signal: controller.signal,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body == null ? {} : { body: JSON.stringify(body) })
  });
  if (!result.ok) {
    if ((result.status === 401 || result.status === 403) && current === generation) {
      offlineRevocation.value += 1;
      clear();
      error.value = 'Access is unavailable. Ask your supervisor for an active App User key.';
    }
    const failure = new Error('Request failed');
    failure.status = result.status;
    throw failure;
  }
  return result.json();
};
const parseKey = (value) => {
  if (!value.includes('://')) return value;
  const url = new URL(value);
  if (url.origin !== window.location.origin) throw new Error('Wrong server');
  const match = /^\/v1\/key\/([^/]+)\/projects\/\d+\/?$/.exec(url.pathname);
  if (match == null || url.search || url.hash) throw new Error('Invalid URL');
  return decodeURIComponent(match[1]);
};
// Visits load beside backchecks; a failure here must not hide the backcheck inbox.
const loadVisits = async (current) => {
  try {
    const data = await api('reverification');
    if (current !== generation) return;
    visits.value = data.items;
    visitsComplete.value = data.complete;
    visitsError.value = '';
  } catch {
    if (current === generation) visitsError.value = 'Re-verification visits could not be loaded. Refresh to retry.';
  }
};
const load = async (cursor = null) => {
  const current = generation;
  loading.value = true;
  error.value = '';
  try {
    const data = await api(`backchecks${cursor == null ? '' : `?cursor=${encodeURIComponent(cursor)}`}`);
    if (current !== generation) return;
    if (cursor == null) offlineRevocation.value += 1;
    identity.value = data.appUser;
    items.value = cursor == null ? data.items : [...items.value, ...data.items];
    nextCursor.value = data.nextCursor;
    connected.value = true;
    if (cursor == null) await loadVisits(current);
  } catch (failure) {
    if (current !== generation) return;
    error.value = 'The inbox could not be loaded. Refresh or try opening it again.';
  } finally { if (current === generation) loading.value = false; }
};
const fetchOfflineBundle = () => api('offline-assignments');
const handlePushUpdate = (event) => {
  if (event.origin === window.location.origin && event.data?.type === 'fieldwork-inbox-update' &&
    connected.value && !loading.value && acknowledging.value == null) load();
};
onMounted(() => navigator.serviceWorker?.addEventListener?.('message', handlePushUpdate));
onBeforeUnmount(() => {
  navigator.serviceWorker?.removeEventListener?.('message', handlePushUpdate);
  clear();
});
const connect = async () => {
  const { value } = inputKey;
  clear();
  error.value = '';
  pushMessage.value = '';
  try { token = parseKey(value); } catch {
    error.value = 'Enter an App User key or its Collect server URL for this server.';
    return;
  }
  const current = generation;
  await load();
  if (current !== generation || !connected.value) return;
  try {
    const config = await api('push');
    if (current !== generation) return;
    pushEnabled.value = config.enabled;
    publicKey = config.publicKey;
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      const registration = await navigator.serviceWorker.getRegistration('/fieldwork');
      const subscription = await registration?.pushManager.getSubscription();
      if (current !== generation) return;
      if (subscription) {
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subscription.endpoint));
        const hash = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        const existing = config.subscriptions.find(item => item.endpointHash === hash);
        if (current !== generation) return;
        if (existing) { subscriptionId = existing.id; pushActive.value = true; } else pushMessage.value = 'This browser has a subscription for another or older App User. Turn it off in browser site settings before enabling notifications here.';
      }
    }
  } catch {
    if (current === generation) pushMessage.value = 'Notification settings could not be loaded. Reconnect to retry.';
  }
};
const acknowledge = async (item) => {
  const current = generation;
  acknowledging.value = item.id;
  error.value = '';
  try {
    const result = await api(`backchecks/${encodeURIComponent(item.id)}/seen`, 'POST', {});
    if (current === generation) items.value = items.value.map(row => (row.id === item.id ? { ...row, seenAt: result.seenAt } : row));
  } catch {
    if (current === generation) error.value = 'Acknowledgment failed. Refresh to check access or retry.';
  } finally { if (current === generation) acknowledging.value = null; }
};
const keyBytes = (key) => Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
const enablePush = async () => {
  const current = generation;
  pushBusy.value = true;
  pushMessage.value = '';
  let subscription;
  let created = false;
  try {
    if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
      throw new Error('Unsupported');
    const permission = await Notification.requestPermission();
    if (current !== generation) return;
    if (permission !== 'granted') {
      pushMessage.value = 'Notifications were not permitted. You can still refresh the inbox.';
      return;
    }
    const registration = await navigator.serviceWorker.register('/fieldwork-sw.js', { scope: '/fieldwork', updateViaCache: 'none' });
    // Wait for this registration to activate; navigator.serviceWorker.ready can
    // wait forever if another page outside our scope is controlling this tab.
    if (!registration.active) await new Promise((resolve, reject) => {
      const worker = registration.installing || registration.waiting;
      if (!worker) { reject(new Error('No worker')); return; }
      const timer = setTimeout(() => reject(new Error('Activation timeout')), 15000);
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated') { clearTimeout(timer); resolve(); } else if (worker.state === 'redundant') { clearTimeout(timer); reject(new Error('Worker redundant')); }
      });
    });
    if (current !== generation) return;
    subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      created = true;
    }
    if (current !== generation) { if (created) await subscription.unsubscribe(); return; }
    const result = await api('push', 'POST', subscription.toJSON());
    if (current !== generation) return;
    subscriptionId = result.id;
    pushActive.value = true;
    pushMessage.value = 'Browser notifications enabled. Requests remain available in the inbox if delivery is delayed.';
  } catch {
    if (created && subscription) await subscription.unsubscribe().catch(() => {});
    if (current === generation) pushMessage.value = 'Notifications could not be enabled. Check browser support, permission, or server setup, then retry.';
  } finally { if (current === generation) pushBusy.value = false; }
};
const disablePush = async () => {
  const current = generation;
  pushBusy.value = true;
  pushMessage.value = '';
  try {
    const registration = await navigator.serviceWorker.getRegistration('/fieldwork');
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
    if (current !== generation) return;
    if (subscriptionId) await api(`push/${encodeURIComponent(subscriptionId)}`, 'DELETE');
    if (current !== generation) return;
    subscriptionId = null;
    pushActive.value = false;
    pushMessage.value = 'Browser notifications turned off.';
  } catch {
    if (current === generation) pushMessage.value = 'Could not finish turning notifications off. Retry or disable them in browser site settings.';
  } finally { if (current === generation) pushBusy.value = false; }
};
const disconnect = async () => {
  // Disconnect ends notification access on shared devices as well as clearing
  // the in-memory credential. No key is put in a URL or browser storage.
  if (pushActive.value) await disablePush();
  const cleanupFailed = pushActive.value;
  clear();
  pushMessage.value = '';
  error.value = cleanupFailed
    ? 'Disconnected. Notification cleanup could not be confirmed. Disable notifications in browser site settings.' : '';
};
</script>
<style scoped>
.fieldwork { max-width: 760px; margin: 24px auto; padding: 0 12px; overflow-wrap: anywhere; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
.tasks { list-style: none; padding: 0; }
.tasks li { border: 1px solid #bbb; border-radius: 4px; padding: 16px; margin-top: 16px; }
.tasks h2 { font-size: 20px; margin-top: 0; }
.question { white-space: pre-wrap; }
</style>
