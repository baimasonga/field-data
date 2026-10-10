// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Receipt ledger (R1): docs/field-intelligence/R1-receipt-ledger.md
//
// Receipts are written by the database as submissions arrive. These routes
// read them: a manager verifies the chain, anyone in the project can fetch
// the (signed) head, and an App User sees their own receipts.

const { sign } = require('crypto');
const { sql } = require('slonik');
const Problem = require('../util/problem');
const { getOrNotFound } = require('../util/promise');
const { GENESIS, verifyRun } = require('../util/receipts');
const offlineAssignments = require('../util/offline-assignments');

const BATCH = 2000;
const LISTED = 50;

const projectFor = async (container, auth, params, verb) => {
  if (!/^[1-9]\d*$/.test(params.projectId) || !Number.isSafeInteger(Number(params.projectId))) throw Problem.user.notFound();
  const project = await container.Projects.getById(Number(params.projectId)).then(getOrNotFound);
  await auth.canOrReject(verb, project);
  return project;
};

const headOf = (db, projectId) => db.maybeOne(sql`SELECT seq, "entryHash" FROM field_data_receipts
  WHERE "projectId" = ${projectId} ORDER BY seq DESC LIMIT 1`);

// The head, signed with the offline signing key (O1) when one is configured.
const signedHead = (projectId, head, now = new Date()) => {
  const body = { projectId, seq: head?.seq ?? 0, entryHash: head?.entryHash ?? GENESIS };
  const settings = offlineAssignments.config();
  if (settings == null) return { ...body, signed: null };
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 'receipt-head@1', audience: settings.origin, ...body, signedAt: now.toISOString() }));
  return {
    ...body,
    signed: { algorithm: 'ES256', keyId: settings.keyId, publicKey: settings.publicKey, payload: bytes.toString('base64url'),
      signature: sign('sha256', bytes, { key: settings.key, dsaEncoding: 'ieee-p1363' }).toString('base64url') }
  };
};

const appUser = async (container, auth) => {
  const actor = auth.actor.orNull();
  if (actor?.type !== 'field_key') throw Problem.user.insufficientRights();
  const [key] = await container.db.any(sql`SELECT fk."projectId" FROM field_keys fk
    JOIN actors a ON a.id = fk."actorId" AND a."deletedAt" IS NULL
    JOIN projects p ON p.id = fk."projectId" AND p."deletedAt" IS NULL
    WHERE fk."actorId" = ${actor.id}`);
  if (key == null) throw Problem.user.insufficientRights();
  return { projectId: key.projectId, actorId: actor.id };
};

module.exports = (service, endpoint) => {
  service.get('/projects/:projectId/receipts/verify', endpoint(async (container, { auth, params }, _, response) => {
    const project = await projectFor(container, auth, params, 'project.update');
    response.set('Cache-Control', 'private, no-store');
    let last = null; let problem = null; let entries = 0; let purged = 0; let backfilled = 0;
    let contentChangedCount = 0; const contentChanged = [];
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await container.db.any(sql`SELECT r.*, CASE WHEN sd.id IS NULL THEN NULL
          ELSE encode(sha256(convert_to(sd.xml, 'UTF8')), 'hex') END AS "currentHash"
        FROM field_data_receipts r LEFT JOIN submission_defs sd ON sd.id = r."submissionDefId"
        WHERE r."projectId" = ${project.id} AND r.seq > ${last?.seq ?? 0}
        ORDER BY r.seq LIMIT ${BATCH}`);
      if (rows.length === 0) break;
      const run = verifyRun(rows, last);
      for (const r of rows) {
        if (run.problem != null && r.seq >= run.problem.seq) break;
        entries += 1;
        if (r.backfilled) backfilled += 1;
        if (r.submissionDefId == null) purged += 1;
        else if (r.currentHash !== r.contentHash) {
          contentChangedCount += 1;
          if (contentChanged.length < LISTED) contentChanged.push({ seq: r.seq, xmlFormId: r.xmlFormId, instanceId: r.instanceId });
        }
      }
      if (run.problem != null) { problem = run.problem; break; }
      last = run.last;
      if (rows.length < BATCH) break;
    }
    const head = await headOf(container.db, project.id);
    return {
      projectId: project.id, entries, backfilled, purged,
      chain: problem == null ? { verified: true, firstProblem: null } : { verified: false, firstProblem: problem },
      content: { changed: contentChangedCount, listed: contentChanged },
      head: { seq: head?.seq ?? 0, entryHash: head?.entryHash ?? GENESIS }
    };
  }));

  service.get('/projects/:projectId/receipts/head', endpoint(async (container, { auth, params }, _, response) => {
    const project = await projectFor(container, auth, params, 'project.read');
    response.set('Cache-Control', 'private, no-store');
    return signedHead(project.id, await headOf(container.db, project.id));
  }));

  // An App User's own receipts: what the server received from them.
  service.get('/field-data/app-user/receipts', endpoint(async (container, { auth }, _, response) => {
    const user = await appUser(container, auth);
    response.set('Cache-Control', 'private, no-store');
    const receipts = await container.db.any(sql`SELECT r.seq, r."xmlFormId", COALESCE(fd.name, r."xmlFormId") AS "formName",
        r."instanceId", r."receivedAt", r."contentHash", r."entryHash"
      FROM field_data_receipts r
      LEFT JOIN forms f ON f.id = r."formId"
      LEFT JOIN form_defs fd ON fd.id = f."currentDefId"
      WHERE r."projectId" = ${user.projectId} AND r."submitterId" = ${user.actorId}
      ORDER BY r.seq DESC LIMIT ${LISTED}`);
    return { receipts, head: signedHead(user.projectId, await headOf(container.db, user.projectId)) };
  }));
};

