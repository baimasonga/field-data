// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Random backcheck sample (O3): docs/field-intelligence/O3-backcheck-sample.md
//
// Optional manual answer strata: docs/field-intelligence/O21-grouped-backcheck-sampling.md
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
const { LIMITS, newSeed, validateSettings, draw, groupFields, rateFor, numericGroup, rangeLabels } = require('../util/backcheck-sample');

const { AREA_LIMITS, polygonGroup, areaLabels, areaVertexCount } = require('../util/sampling-areas');

const { samplingWeights } = require('../util/sampling-weights');

const { validateOutcomes, calibratedEstimate } = require('../util/sampling-estimate');

const REASON = 'backcheck-sample';
const LOCK = 74139;

const formFor = async (container, auth, params, verbs) => {
  const form = await container.Forms
    .getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.WithoutDef, Form.WithoutXml)
    .then(getOrNotFound);
  for (const verb of verbs) await auth.canOrReject(verb, form); // eslint-disable-line no-await-in-loop
  return form;
};

const groupingAvailable = async (container, projectId, xmlFormId, path, numeric = false, geographic = false) => {
  const published = (await container.Forms.getByProjectAndXmlFormId(projectId, xmlFormId, Form.PublishedVersion)).orNull();
  return published != null && published.def.keyId == null && groupFields(await container.Forms.getFields(published.def.id), true).some(f => f.path === path && (geographic ? f.type === 'geopoint' : f.type !== 'geopoint') && (!numeric || ['int', 'decimal'].includes(f.type)));
};

const summaryColumns = sql`s.id, s."drawnAt", s.seed, s.settings, s."sampledBefore", s."scheduleId",
  jsonb_array_length(s.eligible) AS eligible, s."drawnBy", a."displayName" AS "drawnByName",
  (SELECT count(*)::integer FROM field_data_backcheck_sample_items i WHERE i."sampleId" = s.id) AS sampled,
  (SELECT count(*)::integer FROM field_data_backcheck_sample_items i WHERE i."sampleId" = s.id AND i.routing = 'already-decided') AS "alreadyDecided"`;

const summaryOf = (row) => ({
  id: row.id, drawnAt: row.drawnAt, drawnBy: row.drawnBy == null ? null : { id: row.drawnBy, displayName: row.drawnByName },
  scheduled: row.scheduleId != null,
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
    ORDER BY i."submitterId" NULLS LAST, i.rank, i."instanceId"`);
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
  const groups = new Map();
  const groupByInstance = new Map(row.settings.groupField ? row.eligibleList.map(e => [e.instanceId, e.groupValue ?? null]) : []);
  if (row.settings.groupField) {
    const group = value => {
      if (!groups.has(value)) groups.set(value, { value, ...((row.settings.groupRates || row.settings.groupBreaks || row.settings.groupAreas) ? { rate: rateFor(row.settings, value) } : {}), eligible: 0, sampled: 0, requested: 0, linked: 0 });
      return groups.get(value);
    };
    for (const e of row.eligibleList) group(e.groupValue ?? null).eligible += 1;
    for (const i of items) {
      const g = group(groupByInstance.get(i.instanceId) ?? null); g.sampled += 1;
      if (['requested', 'linked'].includes(i.backcheck)) g.requested += 1;
      if (i.backcheck === 'linked') g.linked += 1;
    }
  }
  return {
    ...summaryOf(row),
    ...(row.settings.groupField ? { groups: [...groups.values()].sort((a, b) => (a.value == null ? 1 : b.value == null ? -1 : row.settings.groupAreas ? areaLabels(row.settings.groupAreas).indexOf(a.value) - areaLabels(row.settings.groupAreas).indexOf(b.value) : row.settings.groupBreaks ? rangeLabels(row.settings.groupBreaks).indexOf(a.value) - rangeLabels(row.settings.groupBreaks).indexOf(b.value) : a.value < b.value ? -1 : a.value > b.value ? 1 : 0)) } : {}),
    collectors: [...collectors.values()].sort((a, b) => (a.submitterId == null ? 1 : b.submitterId == null ? -1 : a.submitterId - b.submitterId)),
    items: items.map((i) => ({
      instanceId: i.instanceId, submitterId: i.submitterId, displayName: i.displayName, rank: i.rank,
      ...(row.settings.groupField ? { groupValue: groupByInstance.get(i.instanceId) ?? null } : {}),
      caseId: i.caseId, caseStatus: i.caseStatus, routing: i.routing, backcheck: i.backcheck
    })),
    ...(withEligible ? { eligibleList: row.eligibleList } : {})
  };
};

// Draws one sample inside the caller's transaction: by hand (O3) or on a
// schedule (O6). `window` ({ from, until } times) replaces the received-date
// range for a scheduled period; with `skipEmpty` nothing is written when no
// submission is eligible. Returns the sample ID (null when skipped) and
// counts; throws when too large, before any change.
const drawSample = async (db, form, { requestId, settings, requestHash, actorId, window = null, scheduleId = null, skipEmpty = false }) => {
  await db.query(sql`SELECT pg_advisory_xact_lock(${LOCK}, ${form.id})`);
  const existing = await db.maybeOne(sql`SELECT id, "requestHash" FROM field_data_backcheck_samples
    WHERE "formId" = ${form.id} AND "requestId" = ${requestId}`);
  if (existing != null) {
    if (existing.requestHash !== requestHash)
      throw Problem.user.backcheckSampleInvalid({ field: 'requestId', reason: 'was already used with other settings' });
    return { id: existing.id, replayed: true };
  }

  const from = window != null ? window.from.toISOString()
    : settings.receivedFrom == null ? null : `${settings.receivedFrom}T00:00:00Z`;
  const until = window != null ? window.until.toISOString()
    : settings.receivedTo == null ? null : new Date(Date.parse(`${settings.receivedTo}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString();
  // Only validated path segments enter this XPath; values remain SQL parameters.
  const xpath = settings.groupField ? `/*/${settings.groupField.slice(1).split('/').map(part => `*[local-name()="${part}"]`).join('/')}` : null;
  const candidates = await db.any(sql`SELECT s.id, s."instanceId", s."submitterId", v.id AS "claimVersionId",
      ${xpath == null ? sql`` : sql`CASE WHEN sd."localKey" IS NULL AND octet_length(sd.xml) <= 2097152 AND xml_is_well_formed_document(sd.xml)
        THEN left((SELECT x.value FROM XMLTABLE('/*' PASSING (sd.xml::xml) COLUMNS value text PATH (${`string((${xpath})[1])`})) x), 201) ELSE NULL END AS "groupValue",
        CASE WHEN sd."localKey" IS NULL AND octet_length(sd.xml) <= 2097152 AND xml_is_well_formed_document(sd.xml)
          THEN cardinality(xpath(${xpath}, sd.xml::xml)) > 1 ELSE TRUE END AS unreadable,`}
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
  if (skipEmpty && eligible.length === 0) return { id: null, replayed: false, eligible: 0, sampled: 0 };
  if (settings.groupAreas && eligible.length * areaVertexCount(settings.groupAreas) > AREA_LIMITS.work)
    throw Problem.user.backcheckSampleTooLarge({ what: 'location/polygon work units', count: eligible.length * areaVertexCount(settings.groupAreas), max: AREA_LIMITS.work });
  if (settings.groupField) {
    for (const e of eligible) {
      if (e.unreadable) throw Problem.user.backcheckSampleInvalid({ field: 'groupField', reason: 'cannot group repeated, unreadable, encrypted or oversized answers; use collector-only sampling' });
      const raw = e.groupValue;
      e.groupValue = raw == null ? null : raw.normalize('NFC').trim() || null;
      if ((raw?.length ?? 0) > LIMITS.maxGroupValue || (e.groupValue?.length ?? 0) > LIMITS.maxGroupValue)
        throw Problem.user.backcheckSampleInvalid({ field: 'groupField', reason: `answers must be at most ${LIMITS.maxGroupValue} characters; choose a categorical question` });
      if (settings.groupBreaks) {
        const group = numericGroup(e.groupValue, settings.groupBreaks);
        if (group.error) throw Problem.user.backcheckSampleInvalid({ field: 'groupBreaks', reason: group.error });
        e.groupValue = group.value;
      }
      if (settings.groupAreas) {
        const group = polygonGroup(e.groupValue, settings.groupAreas);
        if (group.error) throw Problem.user.backcheckSampleInvalid({ field: 'groupAreas', reason: group.error });
        e.groupValue = group.value;
      }
    }
    if (new Set(eligible.map(e => e.groupValue)).size > LIMITS.maxGroups)
      throw Problem.user.backcheckSampleInvalid({ field: 'groupField', reason: `must have at most ${LIMITS.maxGroups} distinct groups, including missing answers` });
  }
  const recorded = eligible.map(e => ({ instanceId: e.instanceId, submitterId: e.submitterId, ...(settings.groupField ? { groupValue: e.groupValue } : {}) }));
  const seed = newSeed();
  const { chosen } = draw(recorded, settings, seed);
  if (chosen.length > LIMITS.maxSample)
    throw Problem.user.backcheckSampleTooLarge({ what: 'submissions', count: chosen.length, max: LIMITS.maxSample });

  const sample = await db.one(sql`INSERT INTO field_data_backcheck_samples
    ("formId", "requestId", "requestHash", seed, settings, eligible, "sampledBefore", "drawnBy", "scheduleId")
    VALUES (${form.id}, ${requestId}, ${requestHash}, ${seed}, ${JSON.stringify(settings)},
      ${JSON.stringify(recorded)},
      ${candidates.length - eligible.length}, ${actorId}, ${scheduleId})
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
      ${JSON.stringify({ sampleId: sample.id, seed, settings, eligible: eligible.length, sampled: rows.length, ...(scheduleId == null ? {} : { scheduleId }) })},
      clock_timestamp(), NULL, 0)`);
  return { id: sample.id, replayed: false, eligible: eligible.length, sampled: rows.length };
};

module.exports = (service, endpoint) => {
  const base = '/projects/:projectId/forms/:xmlFormId/backcheck-samples';

  service.post(base, endpoint(async (container, { params, auth, body }, _, response) => {
    const form = await formFor(container, auth, params, ['submission.update']);
    if (!UUID_PATTERN.test(body?.requestId ?? '')) throw Problem.user.backcheckSampleInvalid({ field: 'requestId', reason: 'must be a UUID' });
    const { settings, error } = validateSettings(body);
    if (error != null) throw Problem.user.backcheckSampleInvalid(error);
    if (settings.groupField) {
      await auth.canOrReject('submission.read', form);
      await auth.canOrReject('submission.list', form);
      if (!await groupingAvailable(container, params.projectId, params.xmlFormId, settings.groupField, settings.groupBreaks != null, settings.groupAreas != null))
        throw Problem.user.backcheckSampleInvalid({ field: 'groupField', reason: 'must name a supported question in an unencrypted published form (numeric ranges require a numeric question; polygon areas require a geopoint question)' });
    }
    const requestHash = createHash('sha256').update(JSON.stringify(settings)).digest('hex');
    const actorId = auth.actor.map((actor) => actor.id).orNull();

    const result = await container.transacting(({ db }) =>
      drawSample(db, form, { requestId: body.requestId, settings, requestHash, actorId }));

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

  service.get(`${base}/fields`, endpoint(async (container, { params, auth }, _, response) => {
    await formFor(container, auth, params, ['submission.list', 'submission.read']);
    const published = await container.Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.PublishedVersion).then(getOrNotFound);
    response.set('Cache-Control', 'private, no-store');
    return { fields: published.def.keyId == null ? groupFields(await container.Forms.getFields(published.def.id), true) : [] };
  }));

  service.get(`${base}/:sampleId/weights`, endpoint(async (container, { params, auth }, _, response) => {
    const form = await formFor(container, auth, params, ['submission.list', 'submission.read']);
    if (!UUID_PATTERN.test(params.sampleId)) throw Problem.user.notFound();
    const sample = await container.db.maybeOne(sql`SELECT id, settings, seed, eligible, "drawnAt", "scheduleId"
      FROM field_data_backcheck_samples WHERE id = ${params.sampleId} AND "formId" = ${form.id}`);
    if (sample == null) throw Problem.user.notFound();
    const items = await container.db.any(sql`SELECT "instanceId" FROM field_data_backcheck_sample_items WHERE "sampleId" = ${sample.id}`);
    response.set('Cache-Control', 'private, no-store');
    return { sampleId: sample.id, drawnAt: sample.drawnAt, scheduled: sample.scheduleId != null, seed: sample.seed,
      groupField: sample.settings.groupField ?? null,
      ...samplingWeights(sample.eligible, items, sample.settings, sample.seed) };
  }));

  // Calculation only: user-supplied outcomes and results are not persisted.
  service.post(`${base}/:sampleId/estimate`, endpoint(async (container, { params, auth, body }, _, response) => {
    const form = await formFor(container, auth, params, ['submission.list', 'submission.read']);
    if (!UUID_PATTERN.test(params.sampleId)) throw Problem.user.notFound();
    const sample = await container.db.maybeOne(sql`SELECT id, settings, seed, eligible FROM field_data_backcheck_samples
      WHERE id = ${params.sampleId} AND "formId" = ${form.id}`);
    if (sample == null) throw Problem.user.notFound();
    const { input, error } = validateOutcomes(body, sample.id);
    if (error) throw Problem.user.backcheckSampleInvalid(error);
    const items = await container.db.any(sql`SELECT "instanceId" FROM field_data_backcheck_sample_items WHERE "sampleId" = ${sample.id}`);
    const result = calibratedEstimate(sample, items, input);
    if (result.error) throw Problem.user.backcheckSampleInvalid(result.error);
    response.set('Cache-Control', 'private, no-store');
    return result;
  }));

  service.get(`${base}/:sampleId`, endpoint(async (container, { params, auth, query }, _, response) => {
    const form = await formFor(container, auth, params, ['submission.list', 'submission.read']);
    if (!UUID_PATTERN.test(params.sampleId)) throw Problem.user.notFound();
    response.set('Cache-Control', 'private, no-store');
    return sampleView(container.db, form.id, params.sampleId, query.eligible === 'true');
  }));
};

module.exports.drawSample = drawSample;

module.exports.groupingAvailable = groupingAvailable;
