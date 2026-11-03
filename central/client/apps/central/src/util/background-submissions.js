// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
export const backgroundWorker = async (requireSync = false, tag = 'field-data-xml-background@1') => {
  if (!window.isSecureContext || !navigator.serviceWorker) throw new Error('A secure service-worker browser is required');
  const registration = await navigator.serviceWorker.register('/fieldwork-sw.js', { scope: '/fieldwork', updateViaCache: 'none' });
  const candidate = registration.installing ?? registration.waiting ?? registration.active;
  if (!candidate) throw new Error('Background worker unavailable');
  if (candidate.state !== 'activated') await new Promise((resolve, reject) => {
    let timer;
    const change = () => { if (candidate.state === 'activated') { clearTimeout(timer); candidate.removeEventListener('statechange', change); resolve(); } else if (candidate.state === 'redundant') { clearTimeout(timer); candidate.removeEventListener('statechange', change); reject(new Error('Worker update failed')); } };
    timer = setTimeout(() => { candidate.removeEventListener('statechange', change); reject(new Error('Worker activation timed out')); }, 15000);
    candidate.addEventListener('statechange', change); change();
  });
  if (requireSync && typeof registration.sync?.register !== 'function') throw new Error('Background Sync is unavailable; use open-page automatic sync');
  if (requireSync) await registration.sync.register(tag);
  return registration;
};
const request = async (prefix, tag, kind, data, requireSync) => {
  const registration = await backgroundWorker(requireSync, tag);
  const worker = registration.active;
  const result = await new Promise((resolve, reject) => {
    const channel = new MessageChannel(); const timer = setTimeout(() => { channel.port1.close(); reject(new Error('Background worker did not respond')); }, 30000);
    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); if (event.data?.ok) resolve(event.data.result); else reject(new Error('Background operation failed')); };
    worker.postMessage({ ...data, type: `background-${prefix}-${kind}` }, [channel.port2]);
  });
  if (['authorize', 'schedule'].includes(kind)) await registration.sync.register(tag);
  return result;
};

export const backgroundRequest = (kind, data = {}, requireSync = false) => request('xml', 'field-data-xml-background@1', kind, data, requireSync);
export const mediaBackgroundRequest = (kind, data = {}, requireSync = false) => request('media', 'field-data-media-background@1', kind, data, requireSync);
