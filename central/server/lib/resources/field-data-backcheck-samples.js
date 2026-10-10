// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Random backcheck sample (O3): docs/field-intelligence/O3-backcheck-sample.md
//
// A manager draws a seeded, reproducible share of every collector's
// submissions of a form; each chosen submission's review case gets the reason
// code 'backcheck-sample', and the existing backcheck request (which refuses
// the original collector) does the rest. A sample is a record: it never
// changes and says nothing about a collector.

const { createHash } = require('crypto');
const { sql } = require('slonik');
const { Form } = require('../model/frames');
const Problem = require('../util/problem');
const { getOrNotFound } = require('../util/promise');
const { UUID_PATTERN } = require('../util/claim-versioning');
const { LIMITS, newSeed, validateSettings, draw } = require('../util/backcheck-sample');

const REASON = 'backcheck-sample';
const LOCK = 74139;

const formFor = async (container, auth, params, verbs) => {
  const form = await container.Forms
    .getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.WithoutDef, Form.WithoutXml)
    .then(getOrNotFound);
  for (const verb of verbs) await auth.canOrReject(verb, form); // eslint-disable-line no-await-in-loop
  return form;
};

const summaryColumns = sql`s.id, s."drawnAt", s.seed, s.settings, s."sampledBefore",
  jsonb_array_length(s.eligible) AS eligible, s."drawnBy", a."displayName" AS "drawnByName",
  (SELECT count(*)::integer FROM field_data_backcheck_sample_items i WHERE i."sampleId" = s.id) AS sampled,
  (SELECT count(*)::integer FROM field_data_backcheck_sample_items i WHERE i."sampleId" = s.id AND i.routing = 'already-decided') AS "alreadyDecided"`;

const summaryOf = (row) => ({
  id: row.id, drawnAt: row.drawnAt, drawnBy: row.drawnBy == null ? null : { id: row.drawnBy, displayName: row.drawnByName },
  seed: row.seed, settings: row.settings, eligible: row.eligible, sampledBefore: row.sampledBefore,
  sampled: row.sampled, routed: row.sampled - row.alreadyDecided, alreadyDecided: row.alreadyDecided
});

const sampleView = async (db, formId, sampleId, withEligible) => {
  const row = await db.maybeOne(sql`SELECT ${summaryColumns}, s.eligible AS "eligibleList"
    FROM field_data_backcheck_samples s LEFT JOIN actors a ON a.id = s."drawnBy"
    WHERE s.id = ${sampleId} AND s."formId" = ${formId}`);
  if (row == null) throw Problem.user.notFound();
  // The latest backcheck on the item's case, if any.
  const items = await db.any(sql`SELECT i."instanceId", i."submitterId", a."displayName", i.rank, i."caseId", i.routing,
      c.status AS "caseStatus", b.status AS backcheck
    FROM field_data_backcheck_sample_items i
    LEFT JOIN actors a ON a.id = i."submitterId"
    LEFT JOIN field_data_review_cases c ON c.id = i."caseId"
    LEFT JOIN LATERAL (SELECT status FROM field_data_backchecks
      WHERE "caseId" = i."caseId" ORDER BY "createdAt" DESC, id DESC LIMIT 1) b ON TRUE
    WHERE i."sampleId" = ${sampleId}
    ORDER BY i."submitterId" NULLS LAST, i.rank`);
  const collectors = new Map();
  const collector = (submitterId, displayName) => {
    if (!collectors.has(submitterId)) collectors.set(submitterId, { submitterId, displayName: displayName ?? null, eligible: 0, sampled: 0, requested: 0, linked: 0 });
    const c = collectors.get(submitterId);
    if (c.displayName == null && displayName != null) c.displayName = displayName;
    return c;
  };
  for (const e of row.eligibleList) collector(e.submitterId ?? null).eligible += 1;
  for (const i of items) {
    const c = collector(i.submitterId, i.displayName);
    c.sampled += 1;
    if (i.backcheck === 'requested' || i.backcheck === 'linked') c.requested += 1;
    if (i.backcheck === 'linked') c.linked += 1;
  }
  const names = await db.any(sql`SELECT id, "displayName" FROM actors
    WHERE id = ANY(${sql.array([...collectors.keys()].filter((k) => k != null), 'int4')})`);
  for (const n of names) collectors.get(n.id).displayName = n.displayName;
  return {
    ...summaryOf(row),
    collectors: [...collectors.values()].sort((a, b) => (a.submitterId == null ? 1 : b.submitterId == null ? -1 : a.submitterId - b.submitterId)),
    items: items.map((i) => ({
      instanceId: i.instanceId, submitterId: i.submitterId, displayName: i.displayName, rank: i.rank,
      caseId: i.caseId, caseStatus: i.caseStatus, routing: i.routing, backcheck: i.backcheck
    })),
    ...(withEligible ? { eligibleList: row.eligibleList } : {})
  };
};

module.exports = (service, endpoint) => {
  const base = '/projects/:projectId/forms/:xmlFormId/backcheck-samples';

  service.post(base, endpoint(async (container, { params, auth, body }, _, response) => {
    const form = await formFor(container, auth, params, ['submission.update']);
    if (!UUID_PATTERN.test(body?.requestId ?? '')) throw Problem.user.backcheckSampleInvalid({ field: 'requestId', reason: 'must be a UUID' });
    const { settings, error } = validateSettings(body);
    if (error != null) throw Problem.user.backcheckSampleInvalid(error);
    const requestHash = createHash('sha256').update(JSON.stringify(settings)).digest('hex');
    const actorId = auth.actor.map((actor) => actor.id).orNull();

    const result = await container.transacting(async ({ db }) => {
      await db.query(sql`SELECT pg_advisory_xact_lock(${LOCK}, ${form.id})`);
      const existing = await db.maybeOne(sql`SELECT id, "requestHash" FROM field_data_backcheck_samples
        WHERE "formId" = ${form.id} AND "requestId" = ${body.requestId}`);
      if (existing != null) {
        if (existing.requestHash !== requestHash)
          throw Problem.user.backcheckSampleInvalid({ field: 'requestId', reason: 'was already used with other settings' });
        return { id: existing.id, replayed: true };
      }

      const from = settings.receivedFrom == null ? null : `${settings.receivedFrom}T00:00:00Z`;
      const until = settings.receivedTo == null ? null
        : new Date(Date.parse(`${settings.receivedTo}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString();
      const candidates = await db.any(sql`SELECT s.id, s."instanceId", s."submitterId", v.id AS "claimVersionId",
          EXISTS (SELECT 1 FROM field_data_backcheck_sample_items i WHERE i."submissionId" = s.id) AS "sampledBefore"
        FROM submissions s
        JOIN submission_defs sd ON sd."submissionId" = s.id AND sd.current IS TRUE
        JOIN field_data_claim_versions v ON v."submissionDefId" = sd.id
        WHERE s."formId" = ${form.id} AND s.draft IS FALSE AND s."deletedAt" IS NULL
          AND ${from == null ? sql`TRUE` : sql`s."createdAt" >= ${from}`}
          AND ${until == null ? sql`TRUE` : sql`s."createdAt" < ${until}`}`);
      const eligible = candidates.filter((c) => !c.sampledBefore)
        .sort((a, b) => (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0));
      if (eligible.length > LIMITS.maxEligible)
        throw Problem.user.backcheckSampleTooLarge({ what: 'eligible submissions', count: eligible.length, max: LIMITS.maxEligible });
      const seed = newSeed();
      const { chosen } = draw(eligible.map((e) => ({ instanceId: e.instanceId, submitterId: e.submitterId })), settings, seed);
      if (chosen.length > LIMITS.maxSample)
        throw Problem.user.backcheckSampleTooLarge({ what: 'submissions', count: chosen.length, max: LIMITS.maxSample });

      const sample = await db.one(sql`INSERT INTO field_data_backcheck_samples
        ("formId", "requestId", "requestHash", seed, settings, eligible, "sampledBefore", "drawnBy")
        VALUES (${form.id}, ${body.requestId}, ${requestHash}, ${seed}, ${JSON.stringify(settings)},
          ${JSON.stringify(eligible.map((e) => ({ instanceId: e.instanceId, submitterId: e.submitterId })))},
          ${candidates.length - eligible.length}, ${actorId})
        RETURNING id`);

      // Route each chosen submission's current claim version into review.
      const byInstance = new Map(eligible.map((e) => [e.instanceId, e]));
      const versions = chosen.map((c) => byInstance.get(c.instanceId).claimVersionId);
      const code = JSON.stringify([REASON]);
      await db.query(sql`INSERT INTO field_data_review_cases ("claimVersionId", "reasonCodes")
        SELECT v, ${code}::jsonb FROM unnest(${sql.array(versions, 'uuid')}) AS v
        ON CONFLICT DO NOTHING`);
      await db.query(sql`UPDATE field_data_review_cases
        SET "reasonCodes" = "reasonCodes" || ${code}::jsonb, revision = revision + 1, "updatedAt" = clock_timestamp()
        WHERE "claimVersionId" = ANY(${sql.array(versions, 'uuid')}) AND status IN ('open', 'in-review')
          AND NOT "reasonCodes" @> ${code}::jsonb AND jsonb_array_length("reasonCodes") < 20`);
      const cases = new Map((await db.any(sql`SELECT id, "claimVersionId", status FROM field_data_review_cases
        WHERE "claimVersionId" = ANY(${sql.array(versions, 'uuid')}) AND status IN ('open', 'in-review', 'resolved')`))
        .map((c) => [c.claimVersionId, c]));
      const rows = chosen.map((c) => {
        const e = byInstance.get(c.instanceId);
        const found = cases.get(e.claimVersionId);
        return { ...c, submissionId: e.id, caseId: found?.id ?? null, routing: found?.status === 'resolved' ? 'already-decided' : 'routed' };
      });
      await db.query(sql`INSERT INTO field_data_backcheck_sample_items
        ("sampleId", "submissionId", "instanceId", "submitterId", rank, "caseId", routing)
        SELECT ${sample.id}, * FROM unnest(
          ${sql.array(rows.map((r) => r.submissionId), 'int4')}, ${sql.array(rows.map((r) => r.instanceId), 'text')},
          ${sql.array(rows.map((r) => r.submitterId), 'int4')}, ${sql.array(rows.map((r) => r.rank), 'int4')},
          ${sql.array(rows.map((r) => r.caseId), 'uuid')}, ${sql.array(rows.map((r) => r.routing), 'text')})`);
      await db.query(sql`INSERT INTO audits ("actorId", action, "acteeId", details, "loggedAt", processed, failures)
        VALUES (${actorId}, 'field_data.backcheck_sample.draw', ${form.acteeId},
          ${JSON.stringify({ sampleId: sample.id, seed, settings, eligible: eligible.length, sampled: rows.length })},
          clock_timestamp(), NULL, 0)`);
      return { id: sample.id, replayed: false };
    });

    response.status(result.replayed ? 200 : 201);
    response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created');
    response.set('Cache-Control', 'private, no-store');
    return sampleView(container.db, form.id, result.id, false);
  }));

  service.get(base, endpoint(async (container, { params, auth }, _, response) => {
    const form = await formFor(container, auth, params, ['submission.list', 'submission.read']);
    response.set('Cache-Control', 'private, no-store');
    const rows = await container.db.any(sql`SELECT ${summaryColumns}
      FROM field_data_backcheck_samples s LEFT JOIN actors a ON a.id = s."drawnBy"
      WHERE s."formId" = ${form.id} ORDER BY s."drawnAt" DESC, s.id`);
    return rows.map(summaryOf);
  }));

  service.get(`${base}/:sampleId`, endpoint(async (container, { params, auth, query }, _, response) => {
    const form = await formFor(container, auth, params, ['submission.list', 'submission.read']);
    if (!UUID_PATTERN.test(params.sampleId)) throw Problem.user.notFound();
    response.set('Cache-Control', 'private, no-store');
    return sampleView(container.db, form.id, params.sampleId, query.eligible === 'true');
  }));
};
