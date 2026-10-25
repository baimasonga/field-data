// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { randomUUID } = require('node:crypto');
const { sql } = require('slonik');
const sensor = require('../util/sensor-corroboration');
const trust = require('../util/witness-key-trust');
const { scope: projectScope, lockGrant } = require('../util/knowledge-data');
const { scope, source, attachment, isCurrent, image } = require('../util/capture-review-target');
const { lockReviewer } = require('../util/capture-assessments');
const { UUID_PATTERN } = require('../util/claim-versioning');
const Problem = require('../util/problem');
const conflict = reason => new Problem(409, reason);
const presentKey = row => ({ id: row.id, deviceId: row.deviceId, kind: row.kind, ...row.details, attestation: row.attestation });
module.exports = (service, endpoint) => {
  const keysRoot = '/projects/:projectId/sensor-keys';
  const captureRoot = '/projects/:projectId/forms/:xmlFormId/submissions/:instanceId/capture-challenges/:challengeId/sensors';
  const lockProject = async (tx, params) => { if (!/^[1-9]\d{0,8}$/.test(params.projectId)) throw Problem.user.notFound(); await trust.trustLock(tx.db, params.projectId); };
  const manager = async (tx, auth, params, write = false) => {
    const project = await projectScope(tx, auth, params.projectId, write);
    await auth.canOrReject('project.update', project); await lockGrant(tx.db, auth.actor.get().id, project.acteeId, 'project.update');
    if (!await tx.db.maybeOne(sql`SELECT id FROM actors WHERE id=${auth.actor.get().id} AND type='user' AND "deletedAt" IS NULL FOR SHARE`)) throw Problem.user.notFound();
    return project;
  };
  service.get(keysRoot, endpoint(async (c, { auth, params, query }, _, response) => {
    if (Object.keys(query).some(key => key !== 'before') || (query.before != null && !/^[1-9]\d{0,8}$/.test(query.before))) throw sensor.invalid('Invalid sensor key history cursor.');
    const result = await c.transacting(async tx => {
      const project = await manager(tx, auth, params); const rows = await sensor.keyRows(tx.db, project.id);
      const history = rows.filter(row => query.before == null || row.sequence < Number(query.before));
      return { method: 'sensor-key-registry@1', revocationAvailable: sensor.config() != null, signingAvailable: sensor.config() != null && !project.archived,
        devices: rows.filter(row => row.kind === 'enroll' && Date.parse(row.details.expiresAt) > Date.now() && !rows.some(event => event.kind === 'revoke' && event.deviceId === row.deviceId)).slice(0, 100).map(row => ({ ...presentKey(row), revocation: rows.find(event => event.kind === 'revoke' && event.deviceId === row.deviceId)?.attestation ?? null })),
        history: { items: history.slice(0, 50).map(presentKey), nextBefore: history.length > 50 ? history[49].sequence : null } };
    }); response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.post(keysRoot, endpoint(async (c, { auth, params, body }, _, response) => {
    if (!body || Object.keys(body).length !== 8 || Object.keys(body).some(key => !['requestId', 'publicKey', 'label', 'operatorLabel', 'sensorKind', 'expiresAt', 'verificationNote', 'reviewed'].includes(key)) || !UUID_PATTERN.test(body.requestId ?? '') || !sensor.text(body.label, 1, 100) || !sensor.text(body.operatorLabel, 1, 200) || !['proximity', 'location', 'measurement'].includes(body.sensorKind) || !sensor.iso(body.expiresAt) || !sensor.text(body.verificationNote, 10, 2000) || body.reviewed !== true) throw sensor.invalid('Provide an external public key, sensor/operator labels, type, UTC expiry, provisioning note and review acknowledgment.');
    const publicKey = sensor.publicKey(body.publicKey); const keyHash = sensor.keyHash(publicKey);
    const result = await c.transacting(async tx => {
      await lockProject(tx, params); const project = await manager(tx, auth, params, true); const actorId = auth.actor.get().id;
      const requestHash = sensor.hash(JSON.stringify({ actorId, ...body, publicKey }));
      const rows = await sensor.keyRows(tx.db, project.id); const prior = rows.find(row => row.requestId === body.requestId);
      if (prior) { if (prior.requestHash !== requestHash) throw conflict('The request identity was used for different content.'); return { item: presentKey(prior), replayed: true }; }
      const settings = sensor.config(); if (!settings) throw sensor.invalid('Server sensor-attestation signing is unavailable.');
      const now = new Date(await tx.db.oneFirst(sql`SELECT clock_timestamp()`));
      if (Date.parse(body.expiresAt) < now.valueOf() + 60000 || Date.parse(body.expiresAt) > now.valueOf() + 365 * 86400000) throw sensor.invalid('Sensor key expiry must be one minute to 365 days ahead.');
      if (rows.filter(row => row.kind === 'enroll' && Date.parse(row.details.expiresAt) > now.valueOf() && !rows.some(event => event.kind === 'revoke' && event.deviceId === row.deviceId)).length >= 100 || rows.filter(row => row.kind === 'enroll').length >= 1000 || rows.length >= 2000 || rows.some(row => row.kind === 'enroll' && row.details.keyHash === keyHash) || keyHash === settings.keyId) throw conflict('This key is already enrolled, is an authority key, or the project key bound was reached.');
      const witnessKey = await tx.db.maybeOne(sql`SELECT id FROM (SELECT w.id,w."publicKey" FROM field_data_capture_witnesses w JOIN field_data_capture_challenges ch ON ch.id=w."challengeId" WHERE ch."projectId"=${project.id}
        UNION ALL SELECT e.id,e."publicKey" FROM field_data_capture_witness_events e JOIN field_data_capture_witnesses w ON w.id=e."witnessRecordId" JOIN field_data_capture_challenges ch ON ch.id=w."challengeId" WHERE ch."projectId"=${project.id}) signatures WHERE "publicKey"=${sql.json(publicKey)} LIMIT 1`);
      if (witnessKey || await tx.db.maybeOne(sql`SELECT id FROM field_data_witness_key_certificates WHERE "projectId"=${project.id} AND "keyHash"=${keyHash}`) || await trust.keyRevoked(tx.db, project.id, publicKey)) throw conflict('A witness signing key cannot also serve as an independent sensor key.');
      const id = randomUUID(); const details = { projectId: project.id, deviceId: id, keyHash, publicKey, label: body.label, operatorLabel: body.operatorLabel, sensorKind: body.sensorKind, expiresAt: body.expiresAt, verificationNote: body.verificationNote, enrolledBy: actorId, enrolledAt: now.toISOString() };
      const attestation = sensor.attest(settings, 'enrollment', details);
      await tx.db.query(sql`INSERT INTO field_data_sensor_keys(id,"projectId","deviceId",kind,"requestId","requestHash",details,attestation) VALUES(${id},${project.id},${id},'enroll',${body.requestId},${requestHash},${sql.json(details)},${sql.json(attestation)})`);
      await tx.Audits.log(auth.actor, 'field_data.sensor.key.enrolled', project, { deviceId: id, keyHash, sensorKind: body.sensorKind });
      return { item: { id, deviceId: id, kind: 'enroll', ...details, attestation }, replayed: false };
    }); response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.post(`${keysRoot}/:deviceId/revoke`, endpoint(async (c, { auth, params, body }, _, response) => {
    if (!UUID_PATTERN.test(params.deviceId ?? '') || !body || Object.keys(body).length !== 2 || !UUID_PATTERN.test(body.requestId ?? '') || !sensor.text(body.reason, 10, 2000)) throw sensor.invalid('Provide a sensor identity, request identity and revocation reason.');
    const result = await c.transacting(async tx => {
      await lockProject(tx, params); const project = await manager(tx, auth, params); const actorId = auth.actor.get().id;
      const rows = await sensor.keyRows(tx.db, project.id); const device = rows.find(row => row.kind === 'enroll' && row.deviceId === params.deviceId); if (!device) throw Problem.user.notFound();
      const requestHash = sensor.hash(JSON.stringify({ actorId, deviceId: device.id, ...body })); const prior = rows.find(row => row.requestId === body.requestId || (row.deviceId === device.id && row.kind === 'revoke'));
      if (prior) { if (prior.requestHash !== requestHash) throw conflict('A conflicting request or revocation already exists.'); return { item: presentKey(prior), replayed: true }; }
      const settings = sensor.config(); if (!settings) throw sensor.invalid('Server sensor-attestation signing is unavailable.');
      const id = randomUUID(); const details = { projectId: project.id, deviceId: device.id, keyHash: device.details.keyHash, revokedBy: actorId, revokedAt: new Date(await tx.db.oneFirst(sql`SELECT clock_timestamp()`)).toISOString(), reason: body.reason };
      const attestation = sensor.attest(settings, 'key-revocation', details);
      await tx.db.query(sql`INSERT INTO field_data_sensor_keys(id,"projectId","deviceId",kind,"requestId","requestHash",details,attestation) VALUES(${id},${project.id},${device.id},'revoke',${body.requestId},${requestHash},${sql.json(details)},${sql.json(attestation)})`);
      await tx.Audits.log(auth.actor, 'field_data.sensor.key.revoked', project, { deviceId: device.id, keyHash: details.keyHash });
      return { item: { id, kind: 'revoke', ...details, attestation }, replayed: false };
    }); response.set('Cache-Control', 'private, no-store'); return result;
  }));
  const readings = async (tx, row, current, integrityVerified = true) => {
    const devices = await sensor.keyRows(tx.db, row.projectId);
    const records = await tx.db.any(sql`SELECT * FROM field_data_sensor_readings WHERE "challengeId"=${row.id} ORDER BY "receivedAt",id LIMIT 20`);
    const reviews = records.length ? await tx.db.any(sql`SELECT * FROM field_data_sensor_reviews WHERE "readingRecordId"=ANY(${sql.array(records.map(record => record.id), 'uuid')}) ORDER BY revision`) : [];
    return records.map(record => {
      const device = devices.find(key => key.kind === 'enroll' && key.deviceId === record.deviceId); const revocation = devices.find(key => key.kind === 'revoke' && key.deviceId === record.deviceId)?.attestation ?? null;
      const data = sensor.checked(record.envelope, sensor.context(row), device); const history = reviews.filter(review => review.readingRecordId === record.id);
      return { ...record, data, enrollment: device.attestation, revocation, reviews: history.map(review => ({ ...review.details, attestation: review.attestation })), revision: history.length, diagnostics: sensor.diagnostics(row, data, device, revocation, record.receivedAt, current, integrityVerified), latestReview: history.at(-1)?.details ?? null };
    });
  };
  service.get(captureRoot, endpoint(async (c, { auth, params }, _, response) => {
    const form = await scope(c, auth, params);
    const result = await c.transacting(async tx => {
      const row = await source(tx.db, params, form, true); if (!row || row.status !== 'bound') throw Problem.user.notFound();
      await lockGrant(tx.db, auth.actor.get().id, form.acteeId, 'submission.read'); const current = isCurrent(row, await attachment(tx.db, row));
      let integrityVerified = true; try { await image(tx, row); } catch { integrityVerified = false; }
      const items = await readings(tx, row, current, integrityVerified); const canWrite = auth.actor.orNull()?.type === 'user' && await auth.can('submission.update', form) && current && integrityVerified && !row.archived && sensor.config() != null;
      return { method: 'signed-sensor-corroboration@1', context: sensor.context(row), bindingCurrent: current, sourceIntegrity: integrityVerified ? 'verified' : 'unavailable-or-mismatch', canWrite, canReview: auth.actor.orNull()?.type === 'user' && await auth.can('submission.update', form) && sensor.config() != null, items, limit: 20, activeSupported: items.filter(item => item.diagnostics.eligibleForReview && item.latestReview?.outcome === 'supports').length };
    }); response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.post(captureRoot, endpoint(async (c, { auth, params, body }, _, response) => {
    const form = await scope(c, auth, params, true);
    if (!body || Object.keys(body).length !== 2 || !UUID_PATTERN.test(body.requestId ?? '') || !body.envelope) throw sensor.invalid('Provide a request identity and a signed sensor envelope.');
    const data = sensor.decode(body.envelope);
    const result = await c.transacting(async tx => {
      await lockProject(tx, params); const actor = await lockReviewer(tx, auth.actor.get().id, form); await lockGrant(tx.db, actor.id, form.acteeId, 'submission.read');
      const row = await source(tx.db, params, form, true); if (!row) throw Problem.user.notFound(); const file = await attachment(tx.db, row, true); await tx.db.one(sql`SELECT id FROM field_data_capture_challenges WHERE id=${row.id} FOR UPDATE`);
      const requestHash = sensor.hash(JSON.stringify({ actorId: actor.id, challengeId: row.id, ...body }));
      const prior = await tx.db.maybeOne(sql`SELECT * FROM field_data_sensor_readings WHERE "projectId"=${row.projectId} AND "requestId"=${body.requestId}`);
      if (prior) { if (prior.requestHash !== requestHash) throw conflict('The sensor request identity was used for different content.'); return { id: prior.id, replayed: true }; }
      if (!isCurrent(row, file) || row.archived) throw Problem.user.captureAssessmentTargetChanged();
      const devices = await sensor.keyRows(tx.db, row.projectId); const device = devices.find(key => key.kind === 'enroll' && key.deviceId === data.deviceId);
      if (!device) throw Problem.user.notFound(); sensor.checked(body.envelope, sensor.context(row), device);
      const settings = sensor.config(); if (!settings) throw sensor.invalid('Server sensor-attestation signing is unavailable.');
      if (device.attestation && JSON.parse(Buffer.from(device.attestation.payload, 'base64url')).issuer !== settings.origin) throw sensor.invalid('The sensor authority origin changed; renew enrollment with a fresh key.');
      if (devices.some(key => key.kind === 'revoke' && key.deviceId === device.id)) throw conflict('The sensor key is revoked.');
      if (await tx.db.maybeOne(sql`SELECT id FROM field_data_sensor_replays WHERE "deviceId"=${device.id} AND ("readingId"=${data.readingId} OR counter=${data.counter})`)) throw conflict('This sensor reading identity or counter was already consumed.');
      if (await tx.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_sensor_readings WHERE "challengeId"=${row.id}`) >= 20) throw sensor.invalid('This challenge reached the 20-reading bound.');
      await image(tx, row);
      const at = new Date(await tx.db.oneFirst(sql`SELECT clock_timestamp()`)); if (Date.parse(device.details.expiresAt) <= at.valueOf()) throw conflict('The sensor key expired before receipt.');
      const id = randomUUID(); const receipt = sensor.attest(settings, 'receipt', { recordId: id, projectId: row.projectId, challengeId: row.id, deviceId: device.id, readingId: data.readingId, counter: data.counter, payloadHash: sensor.hash(Buffer.from(body.envelope.payload, 'base64url')), signatureHash: sensor.hash(body.envelope.signature), enrollmentPayloadHash: sensor.hash(Buffer.from(device.attestation.payload, 'base64url')), receivedBy: actor.id, receivedAt: at.toISOString() });
      await tx.db.query(sql`INSERT INTO field_data_sensor_replays(id,"projectId","deviceId","readingId",counter,"payloadHash") VALUES(${id},${row.projectId},${device.id},${data.readingId},${data.counter},${sensor.hash(Buffer.from(body.envelope.payload, 'base64url'))})`);
      await tx.db.query(sql`INSERT INTO field_data_sensor_readings(id,"projectId","challengeId","deviceId","readingId",counter,"requestId","requestHash","sampledAt",measurement,envelope,receipt,"receivedAt") VALUES(${id},${row.projectId},${row.id},${device.id},${data.readingId},${data.counter},${body.requestId},${requestHash},${data.sampledAt},${sql.json(data.measurement)},${sql.json(body.envelope)},${sql.json(receipt)},${at.toISOString()})`);
      await tx.Audits.log(auth.actor, 'field_data.sensor.reading.imported', form, { challengeId: row.id, recordId: id, deviceId: device.id }); return { id, replayed: false };
    }); response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.post(`${captureRoot}/:readingRecordId/reviews`, endpoint(async (c, { auth, params, body }, _, response) => {
    const form = await scope(c, auth, params, true);
    if (!UUID_PATTERN.test(params.readingRecordId ?? '') || !body || Object.keys(body).length !== 5 || !UUID_PATTERN.test(body.requestId ?? '') || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0 || (body.expectedRevision > 20 || (body.expectedRevision === 20 && body.outcome !== 'withdraw')) || !['supports', 'contradicts', 'inconclusive', 'withdraw'].includes(body.outcome) || !sensor.text(body.reason, 10, 2000) || (body.outcome === 'withdraw' ? typeof body.reviewedOriginal !== 'boolean' : body.reviewedOriginal !== true)) throw sensor.invalid('Provide a bounded expected revision, review outcome, reason and original-image review acknowledgment.');
    const result = await c.transacting(async tx => {
      await lockProject(tx, params); const actor = await lockReviewer(tx, auth.actor.get().id, form); await lockGrant(tx.db, actor.id, form.acteeId, 'submission.read');
      const row = await source(tx.db, params, form, true); if (!row) throw Problem.user.notFound(); const file = await attachment(tx.db, row, true); await tx.db.one(sql`SELECT id FROM field_data_capture_challenges WHERE id=${row.id} FOR UPDATE`);
      const record = await tx.db.maybeOne(sql`SELECT * FROM field_data_sensor_readings WHERE id=${params.readingRecordId} AND "challengeId"=${row.id}`); if (!record) throw Problem.user.notFound();
      const requestHash = sensor.hash(JSON.stringify({ actorId: actor.id, recordId: record.id, ...body }));
      const history = await tx.db.any(sql`SELECT * FROM field_data_sensor_reviews WHERE "readingRecordId"=${record.id} ORDER BY revision`); const prior = await tx.db.maybeOne(sql`SELECT * FROM field_data_sensor_reviews WHERE "projectId"=${row.projectId} AND "requestId"=${body.requestId}`);
      if (prior) { if (prior.requestHash !== requestHash) throw conflict('This review identity was used for different content.'); return { attestation: prior.attestation, replayed: true }; }
      if (history.length !== body.expectedRevision) throw new Problem(412, 'Sensor review changed. Refresh its history before another review.');
      const item = (await readings(tx, row, isCurrent(row, file))).find(value => value.id === record.id);
      if (body.outcome !== 'withdraw' && (!isCurrent(row, file) || row.archived || (body.outcome === 'supports' && !item.diagnostics.eligibleForReview))) throw conflict('The reading is historical, revoked or has clock diagnostics; a supporting review cannot be recorded, and historical images permit withdrawal only.');
      const settings = sensor.config(); if (!settings) throw sensor.invalid('Server sensor-attestation signing is unavailable.');
      if (body.outcome !== 'withdraw') await image(tx, row);
      const details = { recordId: record.id, projectId: row.projectId, revision: history.length + 1, reviewerId: actor.id, reviewerName: actor.displayName, outcome: body.outcome, reason: body.reason, reviewedOriginal: body.reviewedOriginal, reviewedAt: new Date(await tx.db.oneFirst(sql`SELECT clock_timestamp()`)).toISOString(), readingPayloadHash: sensor.hash(Buffer.from(record.envelope.payload, 'base64url')) };
      const attestation = sensor.attest(settings, 'review', details);
      await tx.db.query(sql`INSERT INTO field_data_sensor_reviews(id,"projectId","readingRecordId",revision,"requestId","requestHash",details,attestation) VALUES(${randomUUID()},${row.projectId},${record.id},${details.revision},${body.requestId},${requestHash},${sql.json(details)},${sql.json(attestation)})`);
      await tx.Audits.log(auth.actor, 'field_data.sensor.reading.reviewed', form, { recordId: record.id, revision: details.revision, outcome: body.outcome }); return { attestation, replayed: false };
    }); response.set('Cache-Control', 'private, no-store'); return result;
  }));
};
