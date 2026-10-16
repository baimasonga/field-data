// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { randomUUID } = require('node:crypto');
const { sql } = require('slonik');
const { Form } = require('../model/frames');
const { getOrNotFound } = require('../util/promise');
const { lockReviewer } = require('../util/capture-assessments');
const { parseGeopoint } = require('../util/fieldwork-integrity');
const geo = require('../util/geo-assessments');
const imagery = require('../util/imagery');
const Problem = require('../util/problem');
const conflict = () => Problem.user.geoAssessmentConflict();
const scope = async (c, auth, params, write = false) => {
  const form = await c.Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.WithoutDef, Form.WithoutXml).then(getOrNotFound);
  try { await auth.canOrReject('submission.read', form); if (write) await auth.canOrReject('submission.update', form); } catch (error) {
    if (error?.problemCode === Problem.user.insufficientRights.code) throw Problem.user.notFound(); throw error;
  }
  if (write && auth.actor.orNull()?.type !== 'user') throw Problem.user.notFound();
  await c.Submissions.getByIds(params.projectId, params.xmlFormId, params.instanceId, false).then(getOrNotFound); return form;
};
const lockPermissions = async (tx, id, form) => {
  const actor = await lockReviewer(tx, id, form);
  const read = await tx.db.maybeOne(sql`WITH RECURSIVE implied(id) AS (
    (SELECT ${form.acteeId}::varchar) UNION (SELECT unnest(ARRAY[parent, species]) FROM actees JOIN implied ON implied.id = actees.id))
    SELECT ass."actorId" FROM assignments ass JOIN implied ON implied.id = ass."acteeId" JOIN roles r ON r.id = ass."roleId"
    WHERE ass."actorId" = ${id} AND r.verbs ? 'submission.read' LIMIT 1 FOR SHARE OF ass, r`);
  if (!read) throw Problem.user.notFound(); return actor;
};
const sourceFor = async (db, form, params, lock = false) => {
  const row = await db.maybeOne(sql`SELECT sd.id, sd."instanceId" AS "versionId", sd."formDefId", s.id AS "submissionId", s."createdAt", fd."keyId", p.archived,
    encode(sha256(convert_to(sd.xml, 'UTF8')), 'hex') AS "xmlHash",
    ff.path AS "geopointField", CASE WHEN fd."keyId" IS NULL THEN btrim((xpath('/*' || ff.path || '/text()', sd.xml::xml))[1]::text) ELSE NULL END AS geopoint
    FROM submissions s JOIN submission_defs sd ON sd."submissionId" = s.id AND sd.current
    JOIN forms f ON f.id = s."formId" AND f."deletedAt" IS NULL JOIN projects p ON p.id = f."projectId" AND p."deletedAt" IS NULL
    JOIN form_defs fd ON fd.id = sd."formDefId"
    LEFT JOIN LATERAL (SELECT path FROM form_fields WHERE "formId" = f.id AND type = 'geopoint' AND path ~ '^(/[A-Za-z_][A-Za-z0-9_.-]*)+$' ORDER BY "order" LIMIT 1) ff ON TRUE
    WHERE f.id = ${form.id} AND s."instanceId" = ${params.instanceId} AND s."deletedAt" IS NULL AND s.draft = FALSE
    ${lock ? sql`FOR SHARE OF sd, f, p FOR UPDATE OF s` : sql``}`);
  if (!row) throw Problem.user.notFound();
  if (lock) await db.any(sql`SELECT name FROM submission_attachments WHERE "submissionDefId" = ${row.id} ORDER BY name FOR SHARE`);
  const evidence = await db.one(sql`SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(sa.name,sa."blobId",b.sha,sa."isClientAudit") ORDER BY sa.name)::text,'[]'), 'UTF8')), 'hex') AS "attachmentsHash"
    FROM submission_attachments sa LEFT JOIN blobs b ON b.id = sa."blobId" WHERE sa."submissionDefId" = ${row.id}`);
  const at = row.keyId != null ? null : await db.oneFirst(sql`SELECT min(nullif(ca.start, '')::timestamptz) FROM submission_attachments sa
    JOIN client_audits ca ON ca."blobId" = sa."blobId" WHERE sa."submissionDefId" = ${row.id} AND sa."isClientAudit" = TRUE`);
  const snapshot = { submissionDefId: row.id, versionId: row.versionId, formDefId: row.formDefId, xmlHash: row.xmlHash, attachmentsHash: evidence.attachmentsHash,
    geopointField: row.geopointField, location: row.keyId != null ? null : parseGeopoint(row.geopoint), visitAt: new Date(at ?? row.createdAt).toISOString(),
    visitBasis: at == null ? 'receipt' : 'device-audit-log', encrypted: row.keyId != null };
  return { row, source: { ...snapshot, fingerprint: geo.hash(snapshot) } };
};
const cacheFor = async (db, source, lock = false) => {
  const setup = geo.config(); let row = null;
  if (source.location && !source.encrypted && setup.catalogue) {
    const cell = imagery.cellOf(source.location.latitude, source.location.longitude); const window = imagery.windowAround(new Date(source.visitAt));
    row = await db.maybeOne(sql`SELECT scenes, matched, "fetchedAt" FROM field_data_imagery_lookups WHERE catalogue = ${setup.catalogue} AND collection = ${imagery.COLLECTION}
      AND "cellKey" = ${cell.key} AND "visitDay" = ${window.day} AND "windowDays" = ${imagery.WINDOW_DAYS} ${lock ? sql`FOR SHARE` : sql``}`);
  }
  return geo.catalogue(row, source, setup);
};
const history = (db, submissionId) => db.any(sql`SELECT a.* FROM field_data_geo_assessments a JOIN submission_defs sd ON sd.id = a."submissionDefId"
  WHERE sd."submissionId" = ${submissionId} ORDER BY a.sequence DESC LIMIT 50`);
module.exports = (service, endpoint) => {
  const root = '/projects/:projectId/forms/:xmlFormId/submissions/:instanceId/geo-assessments';
  service.get(root, endpoint(async (c, { auth, params }, _, response) => {
    const form = await scope(c, auth, params); const { source, row } = await sourceFor(c.db, form, params); const catalogue = await cacheFor(c.db, source);
    const rows = await history(c.db, row.submissionId); const revision = rows[0]?.sequence ?? 0;
    const canWrite = auth.actor.orNull()?.type === 'user' && (await auth.verbsOn(form)).includes('submission.update') && !row.archived && !source.encrypted;
    response.set('Cache-Control', 'private, no-store');
    return { source, catalogue: { ...catalogue, scenes: catalogue.scenes.slice(0, 50) }, revision,
      canAssess: canWrite && revision < 50, canCheck: canWrite && catalogue.enabled && !!source.location && !!catalogue.url,
      items: rows.map(item => geo.present(item, source, catalogue, revision)) };
  }));
  service.post(root, endpoint(async (c, { auth, params, body }, _, response) => {
    const form = await scope(c, auth, params, true); const data = geo.checked(body); const actor = auth.actor.get(); const digest = geo.hash({ actorId: actor.id, ...data });
    const result = await c.transacting(async tx => {
      const reviewer = await lockPermissions(tx, actor.id, form); const { row, source } = await sourceFor(tx.db, form, params, true);
      const rows = await history(tx.db, row.submissionId); const revision = rows[0]?.sequence ?? 0;
      const prior = rows.find(item => item.requestId === data.requestId);
      const catalogue = await cacheFor(tx.db, source, true);
      if (prior) { if (prior.requestHash !== digest) throw conflict(); return { item: geo.present(prior, source, catalogue, revision), revision, replayed: true }; }
      if (row.archived || source.encrypted || revision >= 50 || data.revision !== revision || data.sourceFingerprint !== source.fingerprint ||
          (['supports', 'conflicts'].includes(data.outcome) && !source.location)) throw conflict();
      let { citation } = data;
      if (citation?.kind === 'catalogue') {
        const selected = catalogue.status === 'complete' && catalogue.scenes.slice(0, 50).find(s => s.id === citation.sceneId && s.fingerprint === citation.sceneFingerprint);
        if (!selected) throw conflict();
        citation = { ...citation, catalogue: selected.catalogue, collection: selected.collection, at: selected.at, cloud: selected.cloud,
          metadataUrl: selected.metadataUrl, checkedAt: catalogue.checkedAt, staleAtReview: catalogue.stale };
      }
      const item = await tx.db.one(sql`INSERT INTO field_data_geo_assessments
        (id, "submissionDefId", sequence, "requestId", "requestHash", "actorId", "actorName", "sourceFingerprint", source, outcome, claim, reason, limitations, citation, "reviewedImage")
        VALUES (${randomUUID()}, ${row.id}, ${revision + 1}, ${data.requestId}, ${digest}, ${actor.id}, ${reviewer.displayName}, ${source.fingerprint},
          ${JSON.stringify(source)}, ${data.outcome}, ${data.claim}, ${data.reason}, ${data.limitations}, ${citation == null ? null : JSON.stringify(citation)}, ${data.reviewedImage}) RETURNING *`);
      await tx.Audits.log(actor, 'field_data.geo.assessed', form, { assessmentId: item.id, sequence: item.sequence, outcome: item.outcome, sourceFingerprint: source.fingerprint });
      return { item: geo.present(item, source, catalogue, revision + 1), revision: revision + 1, replayed: false };
    });
    response.set('Cache-Control', 'private, no-store'); response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created'); return result;
  }));
  service.post(`${root}/catalogue/check`, endpoint(async (c, { auth, params, body }, _, response) => {
    const form = await scope(c, auth, params, true); const actor = auth.actor.get();
    if (!geo.exact(body, ['sourceFingerprint']) || !geo.validHash(body.sourceFingerprint)) throw Problem.user.geoAssessmentInvalid();
    const setup = geo.config(); if (!setup.enabled || !setup.catalogue) throw Problem.internal.imageryNotConfigured();
    const initial = await c.transacting(async tx => {
      await lockPermissions(tx, actor.id, form); const target = await sourceFor(tx.db, form, params, true);
      if (target.row.archived || target.source.encrypted || !target.source.location || target.source.fingerprint !== body.sourceFingerprint) throw conflict(); return target.source;
    });
    const cell = imagery.cellOf(initial.location.latitude, initial.location.longitude); const window = imagery.windowAround(new Date(initial.visitAt));
    const answer = await imagery.lookup(setup.catalogue, cell, window);
    await c.transacting(async tx => {
      await lockPermissions(tx, actor.id, form); const target = await sourceFor(tx.db, form, params, true);
      if (target.row.archived || target.source.fingerprint !== initial.fingerprint || geo.config().catalogue !== setup.catalogue || !geo.config().enabled) throw conflict();
      if (answer.ok) await tx.db.query(sql`INSERT INTO field_data_imagery_lookups (catalogue, collection, "cellKey", "visitDay", "windowDays", scenes, matched)
        VALUES (${setup.catalogue}, ${imagery.COLLECTION}, ${cell.key}, ${window.day}, ${imagery.WINDOW_DAYS},
          ${JSON.stringify(answer.scenes.map(s => ({ id: s.id, at: s.at.toISOString(), cloud: s.cloud })))}, ${answer.matched})
        ON CONFLICT (catalogue, collection, "cellKey", "visitDay", "windowDays") DO UPDATE SET scenes = excluded.scenes, matched = excluded.matched, "fetchedAt" = clock_timestamp()`);
      await tx.Audits.log(actor, 'field_data.geo.catalogue.checked', form, { sourceFingerprint: initial.fingerprint, ok: answer.ok });
    });
    response.set('Cache-Control', 'private, no-store'); return { ok: answer.ok, reason: answer.ok ? null : 'catalogue-unavailable' };
  }));
};
