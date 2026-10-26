// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
/* global self */
(() => {
  const DB = 'field-data-background-xml'; const TAG = 'field-data-xml-background@1'; const LIMIT = 1048576;
  const encode = value => { const bytes = new Uint8Array(value); let string = ''; for (let at = 0; at < bytes.length; at += 32768) string += String.fromCharCode(...bytes.subarray(at, at + 32768)); return btoa(string).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); };
  const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value)), b => b.toString(16).padStart(2, '0')).join('');
  const text = new TextEncoder();
  const canonical = value => JSON.stringify(value == null || typeof value !== 'object' ? value : Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])));
  const validManifest = m => m && Object.keys(m).length === (m.deprecatedId ? 7 : 5) && ['xmlFormId', 'instanceId', 'version'].every(k => typeof m[k] === 'string' && m[k].length <= 1000) && m.xmlFormId && m.instanceId && Number.isInteger(m.size) && m.size > 0 && m.size <= LIMIT && /^[a-f0-9]{64}$/.test(m.sha256) && (!m.deprecatedId || (typeof m.deprecatedId === 'string' && m.deprecatedId.length <= 1000 && m.deprecatedId !== m.instanceId && /^[a-f0-9]{64}$/.test(m.baseSha256)));
  const verify = async (proof, projectId) => {
    const envelope = async (e, kind) => {
      if (e?.algorithm !== 'ES256' || e.publicKey?.d != null || e.publicKey?.kty !== 'EC' || e.publicKey?.crv !== 'P-256' || typeof e.payload !== 'string' || e.payload.length > 24000 || !/^[A-Za-z0-9_-]{86}$/.test(e.signature ?? '')) throw new Error('Invalid background signature');
      const key = await crypto.subtle.importKey('jwk', e.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
      const bytes = decode(e.payload); const signature = decode(e.signature);
      if (await hash(await crypto.subtle.exportKey('spki', key)) !== e.keyId || encode(bytes) !== e.payload || encode(signature) !== e.signature || !await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, bytes)) throw new Error('Untrusted background signature');
      const d = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (d.issuer !== self.location.origin || d.projectId !== projectId || d.purpose !== `field-data.xml-background-${kind}@1`) throw new Error('Wrong background scope'); return d;
    };
    const t = proof?.target; const a = proof?.authorization; const d = await envelope(a?.attestation, 'authorization');
    for (const k of ['projectId', 'formId', 'formDefId', 'ownerId']) if (d[k] !== t[k]) throw new Error('Target mismatch');
    const m = d.manifest; const start = Date.parse(d.issuedAt); const end = Date.parse(d.expiresAt);
    if (d.id !== a.id || d.targetId !== t.id || a.targetId !== t.id || a.ownerId !== d.ownerId || a.tokenHash !== d.tokenHash || canonical(m) !== canonical(t.manifest) || Date.parse(a.expiresAt) !== end || !validManifest(m) || !/^[a-f0-9]{64}$/.test(d.tokenHash) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 86400000 || !Array.isArray(proof.events) || proof.events.length > 2 || (m.deprecatedId && (!Number.isSafeInteger(d.baseSubmissionDefId) || d.baseSubmissionDefId < 1))) throw new Error('Invalid authorization');
    const authorizationHash = await hash(decode(a.attestation.payload)); const seen = new Set(); let delivery = null; let unsignedRevocation = false;
    for (const event of proof.events) {
      if (!['revoke', 'delivery'].includes(event.kind) || seen.has(event.kind) || event.targetId !== t.id || event.authorizationId !== a.id) throw new Error('Invalid history'); seen.add(event.kind);
      if (event.kind === 'revoke' && event.attestation == null) { unsignedRevocation = true; continue; }
      const v = await envelope(event.attestation, event.kind);
      if (canonical(v) !== canonical({ ...event.details, issuer: v.issuer, purpose: v.purpose }) || v.ownerId !== t.ownerId || v.targetId !== t.id || v.authorizationId !== a.id || v.authorizationPayloadHash !== authorizationHash) throw new Error('Event mismatch');
      if (event.kind === 'revoke' && v.revokedBy !== t.ownerId) throw new Error('Wrong revoker');
      if (event.kind === 'delivery') {
        if (v.transport !== 'background-capability' || v.formId !== t.formId || v.formDefId !== t.formDefId || v.sha256 !== m.sha256 || v.size !== m.size || typeof v.alreadyReceived !== 'boolean' || !Number.isSafeInteger(v.submissionDefId) || !Number.isFinite(Date.parse(v.acceptedAt)) || !Number.isFinite(Date.parse(v.submissionReceivedAt)) || Date.parse(v.acceptedAt) < start || Date.parse(v.acceptedAt) >= end || Date.parse(v.submissionReceivedAt) > Date.parse(v.acceptedAt) || (!v.alreadyReceived && Date.parse(v.submissionReceivedAt) < start)) throw new Error('Invalid delivery');
        if (m.deprecatedId && (v.deprecatedId !== m.deprecatedId || v.baseSha256 !== m.baseSha256 || v.baseSubmissionDefId !== d.baseSubmissionDefId || v.submissionDefId === v.baseSubmissionDefId)) throw new Error('Wrong edit lineage');
        delivery = v;
      }
    }
    return { details: d, delivery, revoked: seen.has('revoke'), unsignedRevocation };
  };
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
    const bytes = new Uint8Array(data.bytes); const m = data.manifest;
    if (!/^[0-9a-f-]{36}$/i.test(data.id) || !/^[A-Za-z0-9_-]{43}$/.test(data.token ?? '') || !validManifest(m) || bytes.length !== m.size || await hash(bytes) !== m.sha256 || !Number.isSafeInteger(data.ownerId) || data.ownerId <= 0 || !Number.isSafeInteger(data.projectId) || data.projectId <= 0 || !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= Date.now() || data.expiresAt - Date.now() > 86400000 || ![1, 2, 3].includes(data.priority)) throw new Error('Invalid background capsule');
    const body = { id: data.id, manifest: m, tokenHash: await hash(text.encode(data.token)), expiresAt: new Date(data.expiresAt).toISOString() };
    const previous = await get(data.id); if (previous) { if (canonical(previous.body) !== canonical(body)) throw new Error('Capsule conflict'); return noSecrets(previous); }
    const rows = await all(); const pending = rows.filter(r => r.ciphertext && r.expiresAt > Date.now());
    if (pending.length >= 10 || pending.reduce((sum, r) => sum + r.body.manifest.size, 0) + bytes.length > 5 * LIMIT || rows.length >= 100) throw new Error('Background storage limit reached');
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); const iv = crypto.getRandomValues(new Uint8Array(12));
    // The browser-held non-extractable key deliberately permits this opted-in outbound copy after queue lock.
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: text.encode(`${self.location.origin}:${data.id}`) }, key, text.encode(JSON.stringify({ token: data.token, bytes: encode(bytes) })));
    const row = { id: data.id, body, ownerId: data.ownerId, projectId: data.projectId, expiresAt: data.expiresAt, priority: data.priority, status: 'authorizing', attempts: 0, nextAttemptAt: 0, key, iv, ciphertext };
    const committed = await dbOperation('readwrite', (store, done) => {
      store.getAll().onsuccess = event => {
        const currentRows = event.target.result; const current = currentRows.find(value => value.id === data.id);
        if (current) { done(canonical(current.body) === canonical(body) ? { row: current } : { error: true }); return; }
        const active = currentRows.filter(value => value.ciphertext && value.expiresAt > Date.now());
        if (currentRows.length >= 100 || active.length >= 10 || active.reduce((sum, value) => sum + value.body.manifest.size, 0) + bytes.length > 5 * LIMIT) { done({ error: true }); return; }
        store.put(row); done({ row });
      };
    });
    if (committed.error) throw new Error('Background storage limit or capsule conflict'); return noSecrets(committed.row);
  };
  const authorize = async proof => {
    const row = await get(proof?.authorization?.id); if (!row) throw new Error('Outbound copy unavailable');
    const checked = await verify(proof, row.projectId);
    if (checked.details.ownerId !== row.ownerId || canonical(checked.details.manifest) !== canonical(row.body.manifest) || checked.details.tokenHash !== row.body.tokenHash || Date.parse(checked.details.expiresAt) > row.expiresAt) throw new Error('Wrong outbound authorization');
    await change(row.id, current => {
      if (!current?.ciphertext || current.status !== 'authorizing') return current;
      const next = { ...current, proof, expiresAt: Date.parse(checked.details.expiresAt), status: 'queued' };
      return checked.revoked ? scrub(next, 'cancelled') : checked.delivery ? scrub(next, 'accepted') : next;
    });
    await self.registration.sync.register(TAG); return list();
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
          return { ...current, status: 'running', lease, leaseUntil: Date.now() + 60000, attempts: current.attempts + 1 };
        });
        if (row?.lease !== lease) continue; processed += 1;
        let next; let retryable = false; let pause = 0;
        try {
          const checked = await verify(row.proof, row.projectId); if (checked.revoked || checked.delivery || row.expiresAt <= Date.now()) throw new Error('Authorization ended');
          const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: row.iv, additionalData: text.encode(`${self.location.origin}:${row.id}`) }, row.key, row.ciphertext);
          const capsule = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)); const bytes = decode(capsule.bytes);
          if (await hash(bytes) !== row.body.manifest.sha256 || bytes.length !== row.body.manifest.size || await hash(text.encode(capsule.token)) !== row.body.tokenHash) throw new Error('Capsule integrity failed');
          let response;
          try { response = await fetch(`/v1/field-data/app-user/xml-background/${row.id}/deliver`, { method: 'PUT', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(45000), headers: { 'Content-Type': 'application/octet-stream', 'X-Field-Data-Delivery-Token': capsule.token }, body: bytes }); }
          catch { retryable = true; throw new Error('Temporary network failure'); }
          if (!response.ok) { retryable = [408, 425, 429, 500, 502, 503, 504].includes(response.status); pause = retryAfter(response); throw new Error('Background delivery refused'); }
          const proof = await response.json(); const receipt = await verify(proof, row.projectId);
          if (!receipt.delivery || receipt.details.id !== row.id || receipt.details.tokenHash !== row.body.tokenHash || proof.sourceAvailable !== true || canonical(receipt.details.manifest) !== canonical(row.body.manifest)) throw new Error('Missing matching delivery receipt');
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
    const port = event.ports?.[0]; if (!port || !event.data?.type?.startsWith('background-xml-')) return;
    let source; try { source = new URL(event.source.url); } catch { return; }
    if (source.origin !== self.location.origin || !/^\/fieldwork\/?$/.test(source.pathname)) return;
    event.waitUntil((async () => {
      try {
        let result; const data = event.data;
        if (data.type === 'background-xml-stage') result = await stage(data);
        else if (data.type === 'background-xml-authorize') result = await authorize(data.proof);
        else if (data.type === 'background-xml-list') result = await list();
        else if (data.type === 'background-xml-cancel') { await change(data.id, current => current && scrub(current, 'cancelled')); result = await list(); }
        else if (data.type === 'background-xml-forget') { const row = await get(data.id); if (row?.ciphertext) throw new Error('Cancel delivery before deleting history'); await dbOperation('readwrite', s => s.delete(data.id)); result = await list(); }
        else if (data.type === 'background-xml-schedule') { await self.registration.sync.register(TAG); result = await list(); }
        else if (data.type === 'background-xml-verify') result = await verify(data.proof, data.projectId);
        else throw new Error('Unsupported background operation');
        port.postMessage({ ok: true, result });
      } catch { port.postMessage({ ok: false }); }
      finally { port.close(); }
    })());
  });
})();
