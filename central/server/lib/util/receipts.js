// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Receipt ledger (R1): one receipt per submission version received, chained
// per project. The hash written by the database trigger and the one
// recomputed here must agree byte for byte, so the format is fixed:
// "receipt@1" then each field as "<byte length>:<value>".
//
// Contract: docs/field-intelligence/R1-receipt-ledger.md

const { createHash } = require('crypto');

const FORMAT = 'receipt@1';
const GENESIS = '0'.repeat(64);

const field = (value) => { const s = value == null ? '' : String(value); return `${Buffer.byteLength(s, 'utf8')}:${s}`; };

// The text hashed for a receipt.
const canonical = (r) => FORMAT + [r.projectId, r.seq, r.xmlFormId, r.instanceId, r.submitterId, r.receivedAt, r.contentHash, r.prevHash]
  .map(field).join('');
const receiptHash = (r) => createHash('sha256').update(canonical(r), 'utf8').digest('hex');

// Checks a run of receipts, in sequence order, continuing from `previous`
// ({ seq, entryHash }, or null at the start). Returns the first problem, or
// null, and the last receipt checked.
const verifyRun = (rows, previous = null) => {
  let prev = previous ?? { seq: 0, entryHash: GENESIS };
  for (const r of rows) {
    if (r.seq !== prev.seq + 1) return { problem: { seq: prev.seq + 1, reason: 'missing' }, last: prev };
    if (r.prevHash !== prev.entryHash) return { problem: { seq: r.seq, reason: 'broken-link' }, last: prev };
    if (receiptHash(r) !== r.entryHash) return { problem: { seq: r.seq, reason: 'altered' }, last: prev };
    prev = r;
  }
  return { problem: null, last: prev };
};

module.exports = { FORMAT, GENESIS, canonical, receiptHash, verifyRun };
