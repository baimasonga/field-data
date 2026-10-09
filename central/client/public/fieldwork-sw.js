// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
// This worker caches no pages, credentials or task content.
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
