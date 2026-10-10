// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Cited search (K2): docs/field-intelligence/K2-cited-search.md
//
// One search across a project's asset records, asset facts, integrity
// findings and review decisions. Every result cites the submission it rests
// on; results from forms the caller may not read are never returned.

const { sql } = require('slonik');
const { Form } = require('../model/frames');
const Problem = require('../util/problem');
const { getOrNotFound } = require('../util/promise');
const { matchOf, likePattern } = require('../util/search-excerpt');

const PER_KIND = 20;
const invalid = (value) => Problem.user.unexpectedValue({ field: 'q', value, reason: 'it must be 2 to 100 characters' });

// Forms of the project whose submissions the caller may read.
const readableForms = async (container, auth, projectId) => {
  const forms = await container.db.any(sql`SELECT "xmlFormId" FROM forms WHERE "projectId" = ${projectId} AND "deletedAt" IS NULL`);
  const checked = await Promise.all(forms.map(async ({ xmlFormId }) => {
    const form = await container.Forms.getByProjectAndXmlFormId(projectId, xmlFormId, Form.WithoutDef, Form.WithoutXml);
    if (!form.isDefined()) return null;
    return (await auth.can('submission.read', form.get())) ? form.get().id : null;
  }));
  return checked.filter((id) => id != null);
};

// The results and how many more matched (each row carries the total).
const page = (rows, present) => ({ items: rows.map(present), more: rows.length === 0 ? 0 : Number(rows[0].total) - rows.length });

module.exports = (service, endpoint) => {
  service.get('/projects/:projectId/search', endpoint(async (container, { auth, params, query }, _, response) => {
    if (!/^[1-9]\d*$/.test(params.projectId) || !Number.isSafeInteger(Number(params.projectId))) throw Problem.user.notFound();
    const project = await container.Projects.getById(Number(params.projectId)).then(getOrNotFound);
    await auth.canOrReject('project.read', project);
    const q = typeof query.q === 'string' ? query.q.trim() : null;
    if (q == null || q.length < 2 || q.length > 100) throw invalid(query.q);
    response.set('Cache-Control', 'private, no-store');

    const forms = await readableForms(container, auth, project.id);
    if (forms.length === 0) {
      return { q, results: { assets: [], facts: [], findings: [], decisions: [] }, more: { assets: 0, facts: 0, findings: 0, decisions: 0 } };
    }
    const like = likePattern(q);
    const readable = sql.array(forms, 'int4');
    const matches = (column) => sql`${column} ILIKE ${like} ESCAPE '\\'`;

    const [assets, facts, findings, decisions] = await Promise.all([
      container.db.any(sql`SELECT a.id, count(*) OVER () AS total, a.name, a."externalId", a."assetType", a."createdAt", f."xmlFormId"
        FROM field_data_assets a JOIN forms f ON f.id = a."formId"
        WHERE a."projectId" = ${project.id} AND a."formId" = ANY(${readable})
          AND (${matches(sql`a.name`)} OR ${matches(sql`a."externalId"`)} OR ${matches(sql`a."assetType"`)})
        ORDER BY a."createdAt" DESC, a.id LIMIT ${PER_KIND}`),
      container.db.any(sql`SELECT o.id, count(*) OVER () AS total, o."assetId", a.name AS "assetName", o.predicate, o.state, o.value,
          o."validFrom", o."recordedAt", o."claimVersionId", sf."xmlFormId", sd."instanceId", af."xmlFormId" AS "assetXmlFormId"
        FROM field_data_asset_observations o
        JOIN field_data_assets a ON a.id = o."assetId" AND a."projectId" = ${project.id} AND a."formId" = ANY(${readable})
        JOIN forms af ON af.id = a."formId"
        JOIN field_data_claim_versions cv ON cv.id = o."claimVersionId"
        JOIN submission_defs sd ON sd.id = cv."submissionDefId"
        JOIN submissions s ON s.id = sd."submissionId" AND s."deletedAt" IS NULL
        JOIN forms sf ON sf.id = s."formId" AND sf.id = ANY(${readable})
        WHERE ${matches(sql`o.predicate`)} OR ${matches(sql`o.value`)}
        ORDER BY o."recordedAt" DESC, o.id LIMIT ${PER_KIND}`),
      container.db.any(sql`SELECT i.id, count(*) OVER () AS total, i.rule, i."instanceId", i."relatedInstanceId", i.outcome, i.status,
          i.evidence->>'title' AS title, i.evidence->>'explanation' AS explanation, i.note, i."createdAt", f."xmlFormId",
          -- A related submission in another form (F2b) is cited only by this form's record.
          (i."relatedInstanceId" IS NOT NULL AND NOT (jsonb_typeof(i.evidence->'others') = 'array'
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(i.evidence->'others') o
              WHERE o->>'instanceId' = i."relatedInstanceId" AND o->>'xmlFormId' IS NOT NULL AND o->>'xmlFormId' <> f."xmlFormId"))) AS "relatedHere"
        FROM field_data_integrity_flags i JOIN forms f ON f.id = i."formId"
        WHERE i."formId" = ANY(${readable}) AND i.outcome <> 'withdrawn'
          AND EXISTS (SELECT 1 FROM submissions s WHERE s."formId" = i."formId" AND s."instanceId" = i."instanceId" AND s."deletedAt" IS NULL)
          AND (${matches(sql`(i.evidence->>'title')`)} OR ${matches(sql`(i.evidence->>'explanation')`)} OR ${matches(sql`i.note`)})
        ORDER BY i."createdAt" DESC, i.id DESC LIMIT ${PER_KIND}`),
      container.db.any(sql`SELECT d.id, count(*) OVER () AS total, d."caseId", d.outcome, d."reasonCode", d.note, d."createdAt", d."claimVersionId",
          f."xmlFormId", sd."instanceId"
        FROM field_data_review_decisions d
        JOIN field_data_claim_versions cv ON cv.id = d."claimVersionId"
        JOIN submission_defs sd ON sd.id = cv."submissionDefId"
        JOIN submissions s ON s.id = sd."submissionId" AND s."deletedAt" IS NULL
        JOIN forms f ON f.id = s."formId" AND f.id = ANY(${readable})
        WHERE ${matches(sql`d."reasonCode"`)} OR ${matches(sql`d.note`)}
        ORDER BY d."createdAt" DESC, d.id LIMIT ${PER_KIND}`)
    ]);

    const results = {
      assets: page(assets, (a) => ({ id: a.id, name: a.name, externalId: a.externalId, assetType: a.assetType,
        match: matchOf({ name: a.name, externalId: a.externalId, assetType: a.assetType }, q),
        source: { xmlFormId: a.xmlFormId } })),
      facts: page(facts, (o) => ({ id: o.id, assetId: o.assetId, assetName: o.assetName, assetXmlFormId: o.assetXmlFormId, predicate: o.predicate, state: o.state,
        value: o.value, validFrom: o.validFrom, recordedAt: o.recordedAt,
        match: matchOf({ predicate: o.predicate, value: o.value }, q),
        source: { xmlFormId: o.xmlFormId, instanceId: o.instanceId, claimVersionId: o.claimVersionId } })),
      findings: page(findings, (f) => ({ id: f.id, rule: f.rule, title: f.title, outcome: f.outcome, status: f.status, createdAt: f.createdAt,
        match: matchOf({ title: f.title, explanation: f.explanation, note: f.note }, q),
        source: { xmlFormId: f.xmlFormId, instanceId: f.instanceId, relatedInstanceId: f.relatedHere ? f.relatedInstanceId : null } })),
      decisions: page(decisions, (d) => ({ id: d.id, caseId: d.caseId, outcome: d.outcome, reasonCode: d.reasonCode, createdAt: d.createdAt,
        match: matchOf({ reasonCode: d.reasonCode, note: d.note }, q),
        source: { xmlFormId: d.xmlFormId, instanceId: d.instanceId, claimVersionId: d.claimVersionId } }))
    };
    return {
      q,
      results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.items])),
      more: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.more]))
    };
  }));
};
