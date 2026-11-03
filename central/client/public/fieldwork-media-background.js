// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
/* global self */
(() => {
  const DB = 'field-data-background-media'; const TAG = 'field-data-media-background@1'; const LIMIT = 20971520;
  const encode = value => { const bytes = new Uint8Array(value); let string = ''; for (let at = 0; at < bytes.length; at += 32768) string += String.fromCharCode(...bytes.subarray(at, at + 32768)); return btoa(string).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); };
  const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value)), b => b.toString(16).padStart(2, '0')).join('');
  const text = new TextEncoder();
  const canonical = value => JSON.stringify(value == null || typeof value !== 'object' ? value : Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])));
  const validManifest = m => m && Object.keys(m).length === 8 && ['xmlFormId', 'instanceId', 'name', 'contentType'].every(k => typeof m[k] === 'string' && m[k].length > 0 && m[k].length <= 1000) && /^[0-9a-f-]{36}$/i.test(m.id) && Number.isSafeInteger(m.size) && m.size > 0 && m.size <= LIMIT && /^[a-f0-9]{64}$/.test(m.sha256) && [1, 2, 3].includes(m.priority);
  const verify = (proof, projectId) => self.fieldDataVerifyMediaBackground(proof, { issuer: self.location.origin, projectId });
  const dbOperation = (mode, action) => new Promise((resolve, reject) => {
    const open = self.indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('jobs', { keyPath: 'id' });
    open.onerror = () => reject(new Error('Background storage unavailable'));
    open.onsuccess = () => {
      const db = open.result; db.onversionchange = () => db.close(); const tx = db.transaction('jobs', mode); const store = tx.objectStore('jobs'); let result;
      try { action(store, value => { result = value; }); } catch { tx.abort(); }
      tx.oncomplete = () => { db.close(); resolve(result); }; tx.onabort = tx.onerror = () => { db.close(); reject(new Error('Background storage failed')); };
    };
  });
  const get = id => dbOperation('readonly', (s, done) => { s.get(id).onsuccess = e => done(e.target.result); });
  const all = () => dbOperation('readonly', (s, done) => { s.getAll().onsuccess = e => done(e.target.result); });
  const change = (id, update) => dbOperation('readwrite', (s, done) => { s.get(id).onsuccess = e => { const next = update(e.target.result); if (next) s.put(next); done(next); }; });
  const noSecrets = row => { const safe = { ...row }; for (const k of ['key', 'iv', 'ciphertext', 'lease']) delete safe[k]; return safe; };
  const scrub = (row, status) => { const next = { ...row, status }; for (const k of ['key', 'iv', 'ciphertext', 'lease', 'leaseUntil']) delete next[k]; return next; };
  const list = async () => {
    const rows = await all(); const safe = [];
    for (let row of rows) {
      if (row.expiresAt <= Date.now() && row.ciphertext) row = await change(row.id, current => current && scrub(current, 'expired'));
      if (!row) continue;
      let checked = null; try { if (row.proof) checked = await verify(row.proof, row.projectId); } catch { checked = null; }
      safe.push({ ...noSecrets(row), checked });
    }
    return safe;
  };
  const stage = async data => {
    const bytes = new Uint8Array(data.bytes); const m = data.manifest; const collectorId = data.collectorId ?? data.ownerId;
    if (!/^[0-9a-f-]{36}$/i.test(data.id) || !/^[A-Za-z0-9_-]{43}$/.test(data.token ?? '') || !validManifest(m) || bytes.length !== m.size || await hash(bytes) !== m.sha256 || !Number.isSafeInteger(data.ownerId) || data.ownerId <= 0 || !Number.isSafeInteger(data.projectId) || data.projectId <= 0 || !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= Date.now() || data.expiresAt - Date.now() > 86400000 || ![1, 2, 3].includes(data.priority)) throw new Error('Invalid background capsule');
    if (!Number.isSafeInteger(collectorId) || collectorId <= 0) throw new Error('Invalid courier capsule');
    const body = { id: data.id, uploadId: m.id, tokenHash: await hash(text.encode(data.token)), expiresAt: new Date(data.expiresAt).toISOString() };
    const previous = await get(data.id); if (previous) { if (canonical(previous.body) !== canonical(body) || canonical(previous.manifest) !== canonical(m)) throw new Error('Capsule conflict'); return noSecrets(previous); }
    const rows = await all(); const pending = rows.filter(r => r.ciphertext && r.expiresAt > Date.now());
    if (pending.length >= 10 || pending.reduce((sum, r) => sum + r.manifest.size, 0) + bytes.length > 5 * LIMIT || rows.length >= 100) throw new Error('Background storage limit reached');
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); const iv = crypto.getRandomValues(new Uint8Array(12));
    // The browser-held non-extractable key deliberately permits this opted-in outbound copy after queue lock.
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: text.encode(`${self.location.origin}:${data.id}`) }, key, text.encode(JSON.stringify({ token: data.token, bytes: encode(bytes) })));
    const row = { id: data.id, body, manifest: m, ownerId: data.ownerId, collectorId, projectId: data.projectId, expiresAt: data.expiresAt, priority: data.priority, status: 'authorizing', attempts: 0, nextAttemptAt: 0, key, iv, ciphertext };
    const committed = await dbOperation('readwrite', (store, done) => {
      store.getAll().onsuccess = event => {
        const currentRows = event.target.result; const current = currentRows.find(value => value.id === data.id);
        if (current) { done(canonical(current.body) === canonical(body) && canonical(current.manifest) === canonical(m) ? { row: current } : { error: true }); return; }
        const active = currentRows.filter(value => value.ciphertext && value.expiresAt > Date.now());
        if (currentRows.length >= 100 || active.length >= 10 || active.reduce((sum, value) => sum + value.manifest.size, 0) + bytes.length > 5 * LIMIT) { done({ error: true }); return; }
        store.put(row); done({ row });
      };
    });
    if (committed.error) throw new Error('Background storage limit or capsule conflict'); return noSecrets(committed.row);
  };
  const authorize = async proof => {
    const row = await get(proof?.authorization?.id); if (!row) throw new Error('Outbound copy unavailable');
    const checked = await verify(proof, row.projectId);
    if (checked.details.senderId !== row.ownerId || checked.details.ownerId !== (row.collectorId ?? row.ownerId) || checked.details.uploadId !== row.body.uploadId || canonical(checked.details.manifest) !== canonical(row.manifest) || checked.details.tokenHash !== row.body.tokenHash || Date.parse(checked.details.expiresAt) > row.expiresAt) throw new Error('Wrong outbound authorization');
    await change(row.id, current => {
      if (!current?.ciphertext || current.status !== 'authorizing') return current;
      const next = { ...current, proof, expiresAt: Date.parse(checked.details.expiresAt), status: 'queued' };
      return checked.revoked ? scrub(next, 'cancelled') : checked.delivery ? scrub(next, 'accepted') : next;
    });
    return list();
  };
  const retryAfter = response => {
    const value = response.headers.get('Retry-After'); if (!value) return 0;
    if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
    const at = Date.parse(value); const server = Date.parse(response.headers.get('Date')); return Number.isFinite(at) ? Math.max(0, at - (Number.isFinite(server) ? server : Date.now())) : 0;
  };
  const notify = async () => { for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) if (new URL(client.url).origin === self.location.origin && /^\/fieldwork\/?$/.test(new URL(client.url).pathname)) client.postMessage({ type: 'fieldwork-background-update' }); };
  let operation = Promise.resolve();
  const run = (lastChance = false) => {
    const execute = async () => {
      const rows = (await all()).sort((a, b) => a.priority - b.priority || a.expiresAt - b.expiresAt); let processed = 0;
      for (const ref of rows) {
        if (!ref.ciphertext) continue;
        if (ref.expiresAt <= Date.now()) { await change(ref.id, current => current && scrub(current, 'expired')); continue; }
        if (!['queued', 'retry', 'running'].includes(ref.status) || processed >= 2 || ref.nextAttemptAt > Date.now() || (ref.leaseUntil ?? 0) > Date.now()) continue;
        const lease = crypto.randomUUID(); const row = await change(ref.id, current => {
          if (!current?.ciphertext || !['queued', 'retry', 'running'].includes(current.status) || (current.leaseUntil ?? 0) > Date.now()) return current;
          return { ...current, status: 'running', lease, leaseUntil: Date.now() + 240000, attempts: current.attempts + 1 };
        });
        if (row?.lease !== lease) continue; processed += 1;
        let next; let retryable = false; let pause = 0;
        try {
          const checked = await verify(row.proof, row.projectId); if (checked.revoked || checked.delivery || row.expiresAt <= Date.now()) throw new Error('Authorization ended');
          const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: row.iv, additionalData: text.encode(`${self.location.origin}:${row.id}`) }, row.key, row.ciphertext);
          const capsule = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)); const bytes = decode(capsule.bytes);
          if (await hash(bytes) !== row.manifest.sha256 || bytes.length !== row.manifest.size || await hash(text.encode(capsule.token)) !== row.body.tokenHash) throw new Error('Capsule integrity failed');
          const request = async (suffix, method = 'GET', chunk) => {
            let response;
            try { response = await fetch(`/v1/field-data/app-user/media-background/${row.id}${suffix}`, { method, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(45000), headers: { 'X-Field-Data-Delivery-Token': capsule.token, ...(chunk ? { 'Content-Type': 'application/octet-stream', 'X-Chunk-Sha256': await hash(chunk) } : {}) }, ...(chunk ? { body: chunk } : {}) }); }
            catch { retryable = true; throw new Error('Temporary media network failure'); }
            if (!response.ok) { retryable = [408, 425, 429, 500, 502, 503, 504].includes(response.status); pause = retryAfter(response); throw new Error('Background media delivery refused'); }
            return response.json();
          };
          const status = await request('/progress'); const current = await verify(status.proof, row.projectId);
          if (current.details.id !== row.id || current.details.tokenHash !== row.body.tokenHash || canonical(current.details.manifest) !== canonical(row.manifest) || current.revoked) throw new Error('Wrong media progress');
          let transfer = status.transfer;
          const checkedTransfer = value => {
            const manifest = Object.fromEntries(Object.keys(row.manifest).map(k => [k, value[k]]));
            if (canonical(manifest) !== canonical(row.manifest) || value.ownerId !== row.collectorId || value.chunkSize !== 262144 || !['pending', 'completed'].includes(value.status) || !Number.isSafeInteger(value.offset) || value.offset < 0 || value.offset > bytes.length || (value.offset !== bytes.length && value.offset % 262144 !== 0)) throw new Error('Invalid media progress');
            return value;
          };
          transfer = checkedTransfer(transfer);
          const started = Date.now();
          for (let count = 0; transfer.status !== 'completed' && transfer.offset < bytes.length && count < 80 && Date.now() - started < 90000; count += 1) {
            const at = transfer.offset; transfer = checkedTransfer(await request(`/chunks/${at}`, 'PUT', bytes.slice(at, at + 262144)));
            if (transfer.offset <= at) throw new Error('Media progress did not advance');
          }
          if (transfer.offset < bytes.length) { retryable = true; throw new Error('Continue confirmed media chunks on a later wake'); }
          const proof = await request('/complete', 'POST'); const receipt = await verify(proof, row.projectId);
          if (!receipt.delivery || receipt.details.id !== row.id || receipt.details.tokenHash !== row.body.tokenHash || proof.sourceAvailable !== true || canonical(receipt.details.manifest) !== canonical(row.manifest)) throw new Error('Missing matching media delivery receipt');
          next = scrub({ ...row, proof }, 'accepted');
        } catch {
          const wait = Math.max([5000, 15000, 60000, 120000, 300000][Math.min(4, row.attempts - 1)] * (1 + Math.random() * 0.2), pause);
          next = retryable && row.attempts <= 5 && pause <= 3600000 && Date.now() + wait < row.expiresAt ? { ...row, status: 'retry', nextAttemptAt: Date.now() + wait } : scrub(row, row.expiresAt <= Date.now() ? 'expired' : 'stopped');
          delete next.lease; delete next.leaseUntil;
        }
        await change(row.id, current => current?.lease === lease ? next : current);
      }
      await notify();
      const pending = (await all()).some(row => row.ciphertext && ['queued', 'retry', 'running'].includes(row.status) && row.expiresAt > Date.now());
      if (pending && lastChance) {
        for (const row of await all()) if (row.ciphertext && ['queued', 'retry', 'running'].includes(row.status)) await change(row.id, current => current?.ciphertext && ['queued', 'retry', 'running'].includes(current.status) ? scrub(current, 'stopped') : current);
        await notify();
      } else if (pending) throw new Error('Background deliveries remain pending');
    };
    operation = operation.catch(() => {}).then(execute); return operation;
  };
  self.addEventListener('sync', event => { if (event.tag === TAG) event.waitUntil(run(event.lastChance)); });
  self.addEventListener('message', event => {
    const port = event.ports?.[0]; if (!port || !event.data?.type?.startsWith('background-media-')) return;
    let source; try { source = new URL(event.source.url); } catch { return; }
    if (source.origin !== self.location.origin || !/^\/fieldwork\/?$/.test(source.pathname)) return;
    event.waitUntil((async () => {
      try {
        let result; const data = event.data;
        if (data.type === 'background-media-stage') result = await stage(data);
        else if (data.type === 'background-media-authorize') result = await authorize(data.proof);
        else if (data.type === 'background-media-list') result = await list();
        else if (data.type === 'background-media-cancel') { await change(data.id, current => current && scrub(current, 'cancelled')); result = await list(); }
        else if (data.type === 'background-media-forget') { const row = await get(data.id); if (row?.ciphertext) throw new Error('Cancel delivery before deleting history'); await dbOperation('readwrite', s => s.delete(data.id)); result = await list(); }
        else if (data.type === 'background-media-schedule') result = await list();
        else if (data.type === 'background-media-verify') result = await verify(data.proof, data.projectId);
        else throw new Error('Unsupported background operation');
        port.postMessage({ ok: true, result });
      } catch { port.postMessage({ ok: false }); }
      finally { port.close(); }
    })());
  });
})();
