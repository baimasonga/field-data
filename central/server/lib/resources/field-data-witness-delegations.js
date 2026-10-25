// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { randomUUID } = require('node:crypto');
const { sql } = require('slonik');
const { Form } = require('../model/frames');
const { getOrNotFound } = require('../util/promise');
const Problem = require('../util/problem');
const { UUID_PATTERN } = require('../util/claim-versioning');
const trust = require('../util/witness-key-trust');
const delegation = require('../util/witness-delegations');
const { lockGrant } = require('../util/knowledge-data');
const present = row => ({ id: row.id, sequence: row.sequence, kind: row.kind, delegationId: row.delegationId, ...row.details, attestation: row.attestation });
module.exports = (service, endpoint) => {
  const root = '/projects/:projectId/forms/:xmlFormId/witness-delegations';
  const managed = async (tx, auth, params, write = false) => {
    const form = await tx.Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.WithoutDef, Form.WithoutXml).then(getOrNotFound);
    const project = await tx.Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('project.update', project);
    if (auth.actor.orNull()?.type !== 'user') throw Problem.user.notFound();
    if (!await tx.db.maybeOne(sql`SELECT id FROM actors WHERE id=${auth.actor.get().id} AND type='user' AND "deletedAt" IS NULL FOR SHARE`)) throw Problem.user.notFound();
    await lockGrant(tx.db, auth.actor.get().id, project.acteeId, 'project.update');
    const live = await tx.db.maybeOne(sql`SELECT p.archived FROM projects p JOIN forms f ON f."projectId"=p.id WHERE p.id=${project.id} AND f.id=${form.id} AND p."deletedAt" IS NULL AND f."deletedAt" IS NULL FOR SHARE OF p,f`);
    if (!live) throw Problem.user.notFound();
    if (write && live.archived) throw delegation.invalid('Archived projects cannot change witness delegations.');
    return { form, project, archived: live.archived };
  };
  service.get(root, endpoint(async (c, { auth, params, query }, _, response) => {
    if (Object.keys(query).some(key => key !== 'before') || (query.before != null && !/^[1-9]\d{0,8}$/.test(query.before))) throw delegation.invalid('Invalid history cursor.');
    const result = await c.transacting(async tx => {
      const { form, archived } = await managed(tx, auth, params);
      const candidates = await tx.db.any(sql`WITH RECURSIVE implied(id) AS (
       (SELECT ${form.acteeId}::varchar) UNION (SELECT unnest(ARRAY[parent,species]) FROM actees JOIN implied ON implied.id=actees.id))
       SELECT DISTINCT a.id,a."displayName" FROM actors a JOIN assignments ass ON ass."actorId"=a.id JOIN roles r ON r.id=ass."roleId" JOIN implied ON implied.id=ass."acteeId"
       WHERE a.type='user' AND a."deletedAt" IS NULL AND r.verbs ? 'submission.read' ORDER BY a."displayName",a.id LIMIT 201`);
      const history = await tx.db.any(sql`SELECT * FROM field_data_witness_delegations WHERE "formId"=${form.id} AND sequence<${query.before == null ? 2147483647 : Number(query.before)} ORDER BY sequence DESC LIMIT 51`);
      return { method: 'form-witness-delegations@1', projectId: form.projectId, xmlFormId: form.xmlFormId, signingAvailable: delegation.config() != null && !archived,
        candidates: candidates.slice(0, 200), candidatesTruncated: candidates.length > 200, active: (await delegation.activeFor(tx.db, form.id)).map(present),
        history: { items: history.slice(0, 50).map(present), nextBefore: history.length > 50 ? history[49].sequence : null } };
    });
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.post(root, endpoint(async (c, { auth, params, body }, _, response) => {
    if (!body || Object.keys(body).length !== 4 || Object.keys(body).some(key => !['requestId', 'delegateId', 'expiresAt', 'reason'].includes(key)) || !UUID_PATTERN.test(body.requestId ?? '') || !Number.isSafeInteger(body.delegateId) || body.delegateId < 1 || typeof body.expiresAt !== 'string' || !Number.isFinite(Date.parse(body.expiresAt)) || new Date(body.expiresAt).toISOString() !== body.expiresAt || typeof body.reason !== 'string' || body.reason !== body.reason.trim() || body.reason.length < 10 || body.reason.length > 2000) throw delegation.invalid('Choose a reader, request identity, UTC expiry and a reason of 10–2,000 characters.');
    const result = await c.transacting(async tx => {
      if (!/^[1-9]\d{0,8}$/.test(params.projectId)) throw Problem.user.notFound();
      await trust.trustLock(tx.db, params.projectId);
      const { form, project } = await managed(tx, auth, params, true); const actorId = auth.actor.get().id;
      const requestHash = delegation.digest(JSON.stringify({ formId: form.id, actorId, ...body }));
      const prior = await tx.db.maybeOne(sql`SELECT * FROM field_data_witness_delegations WHERE "projectId"=${project.id} AND "requestId"=${body.requestId}`);
      if (prior) { if (prior.requestHash !== requestHash) throw new Problem(409, 'Request identity already used for different content.'); return { item: present(prior), replayed: true }; }
      const settings = delegation.config(); if (!settings) throw delegation.invalid('Witness delegation signing is unavailable.');
      const at = new Date(await tx.db.oneFirst(sql`SELECT clock_timestamp()`));
      if (Date.parse(body.expiresAt) < at.valueOf() + 60000 || Date.parse(body.expiresAt) > at.valueOf() + 30 * 86400000) throw delegation.invalid('Expiry must be one minute to 30 days ahead.');
      const recipient = await tx.db.maybeOne(sql`SELECT id,"displayName" FROM actors WHERE id=${body.delegateId} AND type='user' AND "deletedAt" IS NULL FOR SHARE`);
      if (!recipient || !await delegation.readGrant(tx.db, body.delegateId, form)) throw Problem.user.notFound();
      await lockGrant(tx.db, recipient.id, form.acteeId, 'submission.read');
      const active = await delegation.activeFor(tx.db, form.id);
      if (active.some(row => row.delegateId === recipient.id)) throw new Problem(409, 'This reader already has an active delegation for this form.');
      if (active.length >= 100 || (await tx.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_witness_delegations WHERE "formId"=${form.id} AND kind='grant'`)) >= 1000) throw delegation.invalid('This form reached its delegation bound.');
      const id = randomUUID(); const details = { projectId: project.id, formId: form.id, xmlFormId: form.xmlFormId, delegationId: id, delegateId: recipient.id, delegateName: recipient.displayName, grantedBy: actorId, requestId: body.requestId, grantedAt: at.toISOString(), expiresAt: body.expiresAt, reason: body.reason };
      const attestation = delegation.attest(settings, 'delegation', details);
      const row = await tx.db.one(sql`INSERT INTO field_data_witness_delegations(id,"projectId","formId","delegateId","delegationId",kind,"requestId","requestHash",details,attestation) VALUES(${id},${project.id},${form.id},${recipient.id},${id},'grant',${body.requestId},${requestHash},${sql.json(details)},${sql.json(attestation)}) RETURNING *`);
      await tx.Audits.log(auth.actor, 'field_data.witness.delegation.granted', form, { delegationId: id, delegateId: recipient.id, expiresAt: body.expiresAt });
      return { item: present(row), replayed: false };
    });
    response.set('Cache-Control', 'private, no-store'); response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created'); return result;
  }));
  service.post(`${root}/:delegationId/revoke`, endpoint(async (c, { auth, params, body }, _, response) => {
    if (!UUID_PATTERN.test(params.delegationId ?? '') || !body || Object.keys(body).length !== 2 || Object.keys(body).some(key => !['requestId', 'reason'].includes(key)) || !UUID_PATTERN.test(body.requestId ?? '') || typeof body.reason !== 'string' || body.reason !== body.reason.trim() || body.reason.length < 10 || body.reason.length > 2000) throw delegation.invalid('Provide a request identity and a revocation reason of 10–2,000 characters.');
    const result = await c.transacting(async tx => {
      if (!/^[1-9]\d{0,8}$/.test(params.projectId)) throw Problem.user.notFound();
      await trust.trustLock(tx.db, params.projectId);
      const { form, project } = await managed(tx, auth, params, true); const actorId = auth.actor.get().id;
      const grant = await tx.db.maybeOne(sql`SELECT * FROM field_data_witness_delegations WHERE id=${params.delegationId} AND "formId"=${form.id} AND kind='grant'`);
      if (!grant) throw Problem.user.notFound();
      const requestHash = delegation.digest(JSON.stringify({ formId: form.id, actorId, delegationId: grant.id, ...body }));
      const prior = await tx.db.maybeOne(sql`SELECT * FROM field_data_witness_delegations WHERE "projectId"=${project.id} AND ("requestId"=${body.requestId} OR ("delegationId"=${grant.id} AND kind='revoke')) ORDER BY sequence LIMIT 1`);
      if (prior) { if (prior.requestHash !== requestHash) throw new Problem(409, 'A conflicting request or revocation already exists.'); return { item: present(prior), replayed: true }; }
      const settings = delegation.config(); if (!settings) throw delegation.invalid('Witness delegation signing is unavailable.');
      const at = new Date(await tx.db.oneFirst(sql`SELECT clock_timestamp()`)); const id = randomUUID();
      const details = { projectId: project.id, formId: form.id, xmlFormId: form.xmlFormId, delegationId: grant.id, delegateId: grant.delegateId, delegateName: grant.details.delegateName, revokedBy: actorId, requestId: body.requestId, revokedAt: at.toISOString(), reason: body.reason };
      const attestation = delegation.attest(settings, 'delegation-revocation', details);
      const row = await tx.db.one(sql`INSERT INTO field_data_witness_delegations(id,"projectId","formId","delegateId","delegationId",kind,"requestId","requestHash",details,attestation) VALUES(${id},${project.id},${form.id},${grant.delegateId},${grant.id},'revoke',${body.requestId},${requestHash},${sql.json(details)},${sql.json(attestation)}) RETURNING *`);
      await tx.Audits.log(auth.actor, 'field_data.witness.delegation.revoked', form, { delegationId: grant.id, delegateId: grant.delegateId });
      return { item: present(row), replayed: false };
    });
    response.set('Cache-Control', 'private, no-store'); response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created'); return result;
  }));
};
