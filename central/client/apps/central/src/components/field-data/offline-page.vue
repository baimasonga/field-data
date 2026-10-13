<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="offline-page" aria-label="Offline page preparation">
    <h2>Prepare this page for offline use</h2>
    <p>Save public page assets for up to 24 hours so this inbox can reopen without a connection. Save your encrypted assignment snapshot separately; page preparation stores no credentials or task data.</p>
    <div class="actions">
      <button type="button" class="btn btn-default" :disabled="busy" @click="prepare">Prepare offline page</button>
      <button type="button" class="btn btn-default" :disabled="busy" @click="remove">Remove offline page</button>
    </div>
    <p v-if="message" role="status">{{ message }}</p><p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>
<script setup>
import { ref } from 'vue';

defineOptions({ name: 'FieldDataOfflinePage' });
const busy = ref(false); const message = ref(''); const error = ref('');
const send = (worker, data) => new Promise((resolve, reject) => {
  const channel = new MessageChannel();
  const timer = setTimeout(() => { channel.port1.close(); reject(new Error('Timed out')); }, 60000);
  channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); if (event.data?.ok) resolve(event.data); else reject(new Error('Preparation failed')); };
  worker.postMessage(data, [channel.port2]);
});
const perform = async operation => {
  if (busy.value) return;
  busy.value = true; message.value = ''; error.value = '';
  try { await operation(); } catch { error.value = 'Offline page preparation could not be confirmed. Use a supported browser, reload while online and retry.'; } finally { busy.value = false; }
};
const prepare = () => perform(async () => {
  if (!window.isSecureContext || !navigator.serviceWorker) throw new Error('Unsupported browser');
  const entry = [...document.querySelectorAll('script[type="module"][src]')].map(element => element.src).find(url => new URL(url).pathname.startsWith('/assets/'));
  if (!entry) throw new Error('Production build required');
  const registration = await navigator.serviceWorker.register('/fieldwork-sw.js', { scope: '/fieldwork', updateViaCache: 'none' });
  const worker = registration.installing ?? registration.waiting ?? registration.active;
  if (!worker) throw new Error('Worker unavailable');
  if (worker.state !== 'activated') await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Activation timed out')), 10000);
    worker.addEventListener('statechange', () => { if (worker.state === 'activated') { clearTimeout(timer); resolve(); } }, { once: false });
  });
  const assets = [...new Set([entry, ...performance.getEntriesByType('resource').map(resource => resource.name)].filter(value => {
    const url = new URL(value); return url.origin === window.location.origin && !url.search && !url.hash && /^\/(?:assets|fonts)\/[A-Za-z0-9_./-]+\.(?:js|css|woff2?|ttf)$/.test(url.pathname);
  }))];
  const result = await send(worker, { type: 'prepare-offline-page', entry, assets });
  message.value = `Offline page prepared. Public assets expire ${result.expiresAt}. Your encrypted snapshot has its own expiry.`;
});
const remove = () => perform(async () => {
  const registration = await navigator.serviceWorker?.getRegistration('/fieldwork');
  if (registration?.active) await send(registration.active, { type: 'remove-offline-page' });
  message.value = 'Prepared public page assets removed. Use Forget saved snapshot to remove encrypted instructions separately.';
});
</script>
<style scoped>
.offline-page { border: 1px solid #d8e5e9; border-radius: 12px; background: #fff; padding: 20px; margin: 24px 0; }
.offline-page h2 { font-size: 20px; margin-top: 0; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
