// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
importScripts('/fieldwork-background.js');
// Only explicitly prepared public page assets are cached; API responses and credentials never are.
self.addEventListener('push', (event) => {
  let payload;
  try { payload = event.data.json(); } catch { return; }
  if (payload == null || payload.type !== 'backcheck-update' || !/^backcheck-[0-9a-f-]{36}$/i.test(payload.tag)) return;
  event.waitUntil(self.registration.showNotification('Fieldwork inbox updated', {
    body: 'Open your fieldwork inbox to check your assigned backchecks.',
    tag: payload.tag
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
    const existing = clients.find(client => new URL(client.url).pathname === '/fieldwork');
    if (existing) {
      await existing.focus();
      existing.postMessage({ type: 'fieldwork-inbox-update' });
      return existing;
    }
    return self.clients.openWindow('/fieldwork');
  }));
});


const SHELL_PREFIX = 'fieldwork-public-shell-v1-';
const SHELL_AGE = 24 * 3600000;
const PUBLIC_CONFIG = ['/client-config.json', '/version.txt'];
const assetUrl = value => {
  try {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin && !url.search && !url.hash
      && /^\/(?:assets|fonts)\/[A-Za-z0-9_./-]+\.(?:js|css|woff2?|ttf)$/.test(url.pathname) ? url.href : null;
  } catch { return null; }
};
const shellNames = async () => (await caches.keys()).filter(name => name.startsWith(SHELL_PREFIX)).sort().reverse();
const prepareShell = async data => {
  if (!Array.isArray(data.assets) || data.assets.length > 60 || !assetUrl(data.entry)) throw new Error('Production page required');
  const urls = [...new Set(data.assets.map(assetUrl))];
  if (urls.some(url => url == null) || !urls.includes(assetUrl(data.entry))) throw new Error('Invalid assets');
  const name = `${SHELL_PREFIX}${Date.now()}-${crypto.randomUUID()}`;
  const cache = await caches.open(name); let size = 0; const deadline = Date.now() + 45000;
  const store = async (path, expectedType) => {
    const url = new URL(path, self.location.origin);
    const timeout = Math.min(10000, deadline - Date.now());
    if (timeout <= 0) throw new Error('Preparation timed out');
    const response = await fetch(url, { credentials: 'omit', redirect: 'error', cache: 'no-cache', signal: AbortSignal.timeout(timeout) });
    if (!response.ok || response.redirected || !response.headers.get('content-type')?.includes(expectedType)) throw new Error('Public asset unavailable');
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length; size += chunk.length;
      if (bytes > 10 * 1024 * 1024 || size > 32 * 1024 * 1024) throw new Error('Page exceeds cache limit');
      chunks.push(chunk);
    }
    const body = new Blob(chunks);
    // Fetch exposes decoded bytes. Transport encoding/length headers from the
    // compressed network response must not describe this reconstructed body.
    const headers = new Headers(response.headers);
    for (const header of ['content-encoding', 'content-length', 'transfer-encoding']) headers.delete(header);
    await cache.put(url, new Response(body, { status: response.status, headers }));
    return body;
  };
  try {
    const html = await store('/fieldwork', 'text/html');
    // Preparing an index for another release without its lazy chunks would
    // create an unusable offline copy. Reload online before trying again.
    if (!(await html.text()).includes(new URL(data.entry).pathname)) throw new Error('Reload the page for the current build');
    await store('/client-config.json', 'application/json'); await store('/version.txt', 'text/plain');
    for (const url of urls) { // bounded set of assets already loaded by this page
      const extension = new URL(url).pathname.split('.').pop();
      await store(url, extension === 'js' ? 'javascript' : extension === 'css' ? 'text/css' : 'font');
    }
    await cache.put('/fieldwork-shell-metadata', new Response(JSON.stringify({ preparedAt: Date.now(), size, assets: urls.length }), { headers: { 'content-type': 'application/json' } }));
    for (const old of await shellNames()) if (old !== name) await caches.delete(old);
    return { ok: true, assets: urls.length, expiresAt: new Date(Date.now() + SHELL_AGE).toISOString() };
  } catch (error) { await caches.delete(name); throw error; }
};
let shellOperation = Promise.resolve();
self.addEventListener('message', event => {
  const port = event.ports?.[0];
  if (!port || !['prepare-offline-page', 'remove-offline-page'].includes(event.data?.type)) return;
  shellOperation = shellOperation.then(async () => {
    try {
      if (event.data.type === 'remove-offline-page') {
        for (const name of await shellNames()) await caches.delete(name);
        port.postMessage({ ok: true }); return;
      }
      port.postMessage(await prepareShell(event.data));
    } catch { port.postMessage({ ok: false }); }
    finally { port.close(); }
  });
  event.waitUntil(shellOperation);
});
self.addEventListener('install', event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', event => {
  const request = event.request; const url = new URL(request.url);
  if (request.method !== 'GET' || request.headers.has('authorization') || url.origin !== self.location.origin || url.search
    || !(assetUrl(url.href) || PUBLIC_CONFIG.includes(url.pathname) || (request.mode === 'navigate' && url.pathname === '/fieldwork'))) return;
  event.respondWith((async () => {
    try { return await fetch(request); } catch (error) {
      for (const name of await shellNames()) {
        const cache = await caches.open(name);
        const metadata = await cache.match('/fieldwork-shell-metadata');
        if (!metadata) continue;
        const { preparedAt } = await metadata.json();
        if (Date.now() < preparedAt || Date.now() - preparedAt > SHELL_AGE) continue;
        const saved = await cache.match(request);
        if (saved) return saved;
      }
      throw error;
    }
  })());
});
