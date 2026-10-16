// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const encode = bytes => btoa(Array.from(new Uint8Array(bytes), b => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const signFields = async (context, fields) => {
  if (!crypto.subtle) throw new Error('Signing unavailable');
  const requestId = crypto.randomUUID(); const signedAt = new Date().toISOString();
  const bytes = new TextEncoder().encode(JSON.stringify({ ...context, requestId, signedAt, ...fields }));
  // Only the public key is exported. The nonextractable private key is used once
  // in memory; retry uses the same signed envelope rather than a new key.
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, bytes);
  return { requestId, signedAt, ...fields, payload: encode(bytes), publicKey: await crypto.subtle.exportKey('jwk', keys.publicKey), signature: encode(signature) };
};
export const signWitness = (context, statement) => {
  if (context?.purpose !== 'field-data.capture-witness@1') throw new Error('Signing unavailable');
  return signFields(context, { statement });
};
export const signWitnessChange = (context, action, statement, reason) => {
  if (context?.purpose !== 'field-data.capture-witness-change@1') throw new Error('Signing unavailable');
  return signFields(context, { action, statement: action === 'withdraw' ? null : statement, reason });
};
const digest = async payload => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', decode(payload))), b => b.toString(16).padStart(2, '0')).join('');
const readChange = async event => {
  if (event.algorithm !== 'ES256' || typeof event.payload !== 'string' || event.payload.length > 24000 ||
    event.publicKey?.d != null || event.publicKey?.kty !== 'EC' || event.publicKey.crv !== 'P-256' || event.signature?.length !== 86) throw new Error('Invalid change envelope');
  const bytes = decode(event.payload);
  if (encode(bytes) !== event.payload || encode(decode(event.signature)) !== event.signature) throw new Error('Noncanonical change');
  const key = await crypto.subtle.importKey('jwk', event.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, decode(event.signature), bytes)) throw new Error('Invalid change signature');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return { data: JSON.parse(text), text };
};
export const verifyWitness = async (record, context) => {
  if (record.algorithm !== 'ES256' || record.payload.length > 12000 || record.signature.length !== 86 || record.publicKey.d != null || record.publicKey.kty !== 'EC' || record.publicKey.crv !== 'P-256') throw new Error('Invalid witness');
  const bytes = decode(record.payload);
  if (encode(bytes) !== record.payload || encode(decode(record.signature)) !== record.signature) throw new Error('Noncanonical witness');
  const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (data.purpose !== 'field-data.capture-witness@1' || data.challengeId !== context.id || data.contentHash !== context.contentHash ||
    (data.witnessId !== record.witnessId && record.witnessId != null) || typeof data.statement !== 'string' || data.statement !== data.statement.trim() || data.statement.length < 10 || data.statement.length > 2000 || !Number.isFinite(Date.parse(data.signedAt))) throw new Error('Invalid witness scope');
  const key = await crypto.subtle.importKey('jwk', record.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, decode(record.signature), bytes);
  if (!valid) throw new Error('Invalid witness signature');
  const events = record.events === undefined ? null : record.events;
  if (record.events !== undefined && (!Array.isArray(events) || events.length > 21)) throw new Error('Invalid change history');
  let status = events === null ? 'unknown' : 'active'; let effectiveStatement = data.statement; let previous = record;
  const verifiedEvents = [];
  const { purpose, requestId, signedAt, statement, ...scope } = data;
  const originalPayloadHash = await digest(record.payload);
  for (const event of events ?? []) {
    // Each event binds the preceding payload; verify in chain order.
    // eslint-disable-next-line no-await-in-loop
    const { data: change, text } = await readChange(event);
    const sequence = verifiedEvents.length + 1;
    // eslint-disable-next-line no-await-in-loop
    const previousPayloadHash = await digest(previous.payload);
    const expected = {
      purpose: 'field-data.capture-witness-change@1', ...scope, witnessRecordId: record.id,
      originalPayloadHash, sequence, previousPayloadHash,
      requestId: change.requestId, signedAt: change.signedAt, action: change.action, statement: change.statement, reason: change.reason
    };
    if (status === 'withdrawn' || text !== JSON.stringify(expected) || event.sequence !== sequence || event.action !== change.action ||
      !['correct', 'withdraw'].includes(change.action) || (change.action === 'correct' && sequence > 20) ||
      (event.actorId != null && event.actorId !== data.witnessId) ||
      typeof change.reason !== 'string' || change.reason !== change.reason.trim() || change.reason.length < 10 || change.reason.length > 2000 ||
      (change.action === 'withdraw' ? change.statement !== null : typeof change.statement !== 'string' || change.statement !== change.statement.trim() || change.statement.length < 10 || change.statement.length > 2000) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(change.requestId ?? '') || !Number.isFinite(Date.parse(change.signedAt))) throw new Error('Invalid change scope or sequence');
    status = change.action === 'withdraw' ? 'withdrawn' : 'active';
    effectiveStatement = change.statement;
    verifiedEvents.push({ ...event, reason: change.reason, statement: change.statement, signedAt: change.signedAt }); previous = event;
  }
  if ((record.status != null && record.status !== status) || (record.revision != null && record.revision !== verifiedEvents.length)) throw new Error('Inconsistent witness state');
  const expectedChangeContext = {
    purpose: 'field-data.capture-witness-change@1', ...scope, witnessRecordId: record.id,
    originalPayloadHash, sequence: verifiedEvents.length + 1, previousPayloadHash: await digest(previous.payload)
  };
  if (record.changeContext != null && JSON.stringify(record.changeContext) !== JSON.stringify(expectedChangeContext)) throw new Error('Invalid signing context');
  return {
    ...record, statement: data.statement, signedAt: data.signedAt, status, effectiveStatement,
    verifiedEvents, revision: verifiedEvents.length
  };
};
