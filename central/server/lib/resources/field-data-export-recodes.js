// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

// S4 recode rules for exports: how answers from earlier versions of a form line
// up with the current one. Applied by the analysis exports; the submissions
// are never changed. Contract: docs/field-intelligence/S4-export-recodes.md
const { sql } = require('slonik');
const { Form } = require('../model/frames');
const Problem = require('../util/problem');
const { getOrNotFound } = require('../util/promise');
const { fieldsForForm } = require('../util/xls-report-data');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITS = { rules: 200, values: 200, valueLength: 200, versions: 50 };
const invalid = (field, reason) => Problem.user.recodeInvalid({ field, reason });
const text = (value, max) => typeof value === 'string' && value.trim() !== '' && value.trim().length <= max;
const shapeOf = (row) => ({
  id: row.id, kind: row.kind, path: row.path, fromPath: row.fromPath, versions: row.versions,
  values: row.values, reason: row.reason, actorName: row.actorName ?? null, createdAt: row.createdAt,
  retiredAt: row.retiredAt, retiredByName: row.retiredByName ?? null, retireReason: row.retireReason
});

// Active rules for the given forms, as the export writer needs them.
const activeRules = async (db, forms) => {
  if (forms.length === 0) return [];
  const rows = await db.any(sql`SELECT r.id, r.kind, r.path, r."fromPath", r.versions, r."values", f."xmlFormId"
    FROM field_data_export_recodes r JOIN forms f ON f.id = r."formId"
    WHERE r."formId" = ANY(${sql.array(forms, 'int4')}) AND r."retiredAt" IS NULL
    ORDER BY r."createdAt", r.id`);
  return rows.map((r) => ({ id: r.id, xmlFormId: r.xmlFormId, kind: r.kind, path: r.path, fromPath: r.fromPath, versions: r.versions, values: r.values }));
};

module.exports = (service, endpoint) => {
  const root = '/projects/:projectId/forms/:xmlFormId/recodes';
  const formFor = async (container, auth, params, verbs) => {
    const form = await container.Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.PublishedVersion)
      .then(getOrNotFound);
    for (const verb of verbs) await auth.canOrReject(verb, form); // eslint-disable-line no-await-in-loop
    return form;
  };
  const publishedVersions = (db, form) => db.any(sql`SELECT version, id = ${form.currentDefId} AS current, "publishedAt"
    FROM form_defs WHERE "formId" = ${form.id} AND "publishedAt" IS NOT NULL ORDER BY "publishedAt" DESC`);

  service.get(root, endpoint(async (container, { auth, params }, _, response) => {
    const form = await formFor(container, auth, params, ['form.read', 'submission.read']);
    const [rules, versions] = await Promise.all([
      container.db.any(sql`SELECT r.*, a."displayName" AS "actorName", b."displayName" AS "retiredByName"
        FROM field_data_export_recodes r LEFT JOIN actors a ON a.id = r."actorId" LEFT JOIN actors b ON b.id = r."retiredBy"
        WHERE r."formId" = ${form.id} ORDER BY r."createdAt" DESC, r.id`),
      publishedVersions(container.db, form)
    ]);
    response.set('Cache-Control', 'private, no-store');
    return {
      active: rules.filter((r) => r.retiredAt == null).map(shapeOf),
      retired: rules.filter((r) => r.retiredAt != null).map(shapeOf),
      versions: versions.map((v) => ({ version: v.version, current: v.current, publishedAt: v.publishedAt }))
    };
  }));

  service.post(root, endpoint(async (container, { auth, params, body }, _, response) => {
    const form = await formFor(container, auth, params, ['form.update']);
    if (body == null || typeof body !== 'object' || Array.isArray(body)) throw invalid('body', 'must be an object');
    const extra = Object.keys(body).find((k) => !['kind', 'path', 'fromPath', 'versions', 'values', 'reason'].includes(k));
    if (extra != null) throw invalid(extra, 'is not a rule setting');
    const { kind, path, fromPath, versions, values, reason } = body;
    if (!['value', 'path'].includes(kind)) throw invalid('kind', 'must be value or path');
    if (!text(reason, 2000)) throw invalid('reason', 'must be 1 to 2000 characters');
    if (!Array.isArray(versions) || versions.length === 0 || versions.length > LIMITS.versions
      || versions.some((v) => typeof v !== 'string' || v.length > 200) || new Set(versions).size !== versions.length)
      throw invalid('versions', `must list 1 to ${LIMITS.versions} different versions`);

    // The question, in the current version: a question, not a group or repeat.
    const fields = await fieldsForForm(container.db, form.id, form.currentDefId);
    const repeats = fields.filter((f) => f.type === 'repeat').map((f) => f.path);
    const inRepeat = (p) => repeats.some((r) => p.startsWith(`${r}/`));
    const field = fields.find((f) => f.path === path);
    if (typeof path !== 'string' || field == null || ['structure', 'group', 'repeat'].includes(field.type))
      throw invalid('path', 'must be a question in the current version');

    // Published versions other than the current one.
    const known = await publishedVersions(container.db, form);
    for (const v of versions) {
      const found = known.find((k) => k.version === v);
      if (found == null) throw invalid('versions', `${v === '' ? '(no version string)' : v} is not a published version of this form`);
      if (found.current) throw invalid('versions', 'must not include the current version, whose answers need no recode');
    }

    let stored;
    if (kind === 'path') {
      if (values != null) throw invalid('values', 'is for value rules only');
      if (typeof fromPath !== 'string' || fromPath === path) throw invalid('fromPath', 'must be the question\'s earlier path, different from its current one');
      if (inRepeat(path)) throw invalid('path', 'must not be inside a repeat for a path rule');
      // The earlier path must be a question outside repeats in every listed version.
      const old = await container.db.any(sql`SELECT fd.version, ff.type,
          EXISTS (SELECT 1 FROM form_fields r WHERE r."formId" = ff."formId" AND r."schemaId" = ff."schemaId"
            AND r.type = 'repeat' AND ff.path LIKE r.path || '/%') AS "inRepeat"
        FROM form_defs fd JOIN form_fields ff ON ff."formId" = fd."formId" AND ff."schemaId" = fd."schemaId"
        WHERE fd."formId" = ${form.id} AND fd."publishedAt" IS NOT NULL AND fd.version = ANY(${sql.array(versions, 'text')})
          AND ff.path = ${fromPath}`);
      for (const v of versions) {
        const found = old.find((o) => o.version === v);
        if (found == null || ['structure', 'repeat'].includes(found.type) || found.inRepeat)
          throw invalid('fromPath', `is not a question outside repeats in version ${v === '' ? '(no version string)' : v}`);
      }
      stored = { fromPath, values: null };
    } else {
      if (fromPath != null) throw invalid('fromPath', 'is for path rules only');
      if (values == null || typeof values !== 'object' || Array.isArray(values)) throw invalid('values', 'must map old values to new ones');
      const entries = Object.entries(values);
      if (entries.length === 0 || entries.length > LIMITS.values) throw invalid('values', `must map 1 to ${LIMITS.values} values`);
      for (const [from, to] of entries) {
        const ok = (s) => typeof s === 'string' && s.trim() !== '' && s.length <= LIMITS.valueLength && !/\s/.test(s);
        if (!ok(from) || !ok(to)) throw invalid('values', `must be values of 1 to ${LIMITS.valueLength} characters without spaces`);
        if (from === to) throw invalid('values', `maps ${from} to itself`);
      }
      stored = { fromPath: null, values };
    }

    const actorId = auth.actor.map((actor) => actor.id).orNull();
    const created = await container.transacting(async ({ db }) => {
      await db.query(sql`SELECT pg_advisory_xact_lock(74142, ${form.id})`);
      const count = await db.oneFirst(sql`SELECT count(*)::int FROM field_data_export_recodes WHERE "formId" = ${form.id} AND "retiredAt" IS NULL`);
      if (count >= LIMITS.rules) throw invalid('rules', `a form can have at most ${LIMITS.rules} active rules`);
      const clash = await db.maybeOne(sql`SELECT id FROM field_data_export_recodes WHERE "formId" = ${form.id}
        AND "retiredAt" IS NULL AND kind = ${kind} AND path = ${path} AND versions && ${sql.array(versions, 'text')} LIMIT 1`);
      if (clash != null) throw Problem.user.recodeConflict({ reason: 'an active rule of the same kind already covers this question in one of these versions; retire it first' });
      return db.one(sql`INSERT INTO field_data_export_recodes ("projectId", "formId", kind, path, "fromPath", versions, "values", reason, "actorId")
        VALUES (${form.projectId}, ${form.id}, ${kind}, ${path}, ${stored.fromPath}, ${sql.array(versions, 'text')},
          ${stored.values == null ? null : JSON.stringify(stored.values)}, ${reason.trim()}, ${actorId}) RETURNING *`);
    });
    response.set('Cache-Control', 'private, no-store');
    response.status(201);
    return shapeOf(created);
  }));

  service.post(`${root}/:recodeId/retire`, endpoint(async (container, { auth, params, body }, _, response) => {
    const form = await formFor(container, auth, params, ['form.update']);
    if (!UUID_PATTERN.test(params.recodeId)) throw Problem.user.notFound();
    if (body == null || Object.keys(body).some((k) => k !== 'reason') || !text(body.reason, 2000)) throw invalid('reason', 'must be 1 to 2000 characters');
    const [found] = await container.db.any(sql`SELECT id, "retiredAt" FROM field_data_export_recodes WHERE id = ${params.recodeId} AND "formId" = ${form.id}`);
    if (found == null) throw Problem.user.notFound();
    const actorId = auth.actor.map((actor) => actor.id).orNull();
    const updated = await container.db.any(sql`UPDATE field_data_export_recodes
      SET "retiredAt" = clock_timestamp(), "retiredBy" = ${actorId}, "retireReason" = ${body.reason.trim()}
      WHERE id = ${found.id} AND "retiredAt" IS NULL RETURNING *`);
    if (updated.length === 0) throw Problem.user.recodeConflict({ reason: 'it was already retired' });
    response.set('Cache-Control', 'private, no-store');
    return shapeOf(updated[0]);
  }));
};

module.exports.activeRules = activeRules;
module.exports.LIMITS = LIMITS;
