// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Backcheck agreement (O5): docs/field-intelligence/O5-backcheck-agreement.md
//
// The linked backchecks of a form, each compared as its comparison view does,
// added up by collector and by question. Only counts are returned.

const { sql } = require('slonik');
const { Form } = require('../model/frames');
const { getOrNotFound } = require('../util/promise');
const { compareAnswers, compareMappedAnswers, MAX_BYTES } = require('../util/backcheck-comparison');
const { MAX_BACKCHECKS, askedQuestions, fieldsOf, aggregate } = require('../util/backcheck-agreement');

// Sources are read a few at a time: each may be up to MAX_BYTES.
const CHUNK = 20;

const sourcesOf = (db, defIds) => db.any(sql`SELECT sd.id,
    octet_length(sd.xml) > ${MAX_BYTES} AS "tooLarge",
    CASE WHEN octet_length(sd.xml) <= ${MAX_BYTES} THEN sd.xml ELSE NULL END AS xml,
    CASE WHEN octet_length(sd.xml) <= ${MAX_BYTES} THEN
      p."integrityHash" = encode(sha256(convert_to(sd.xml, 'UTF8')), 'hex') ELSE NULL END AS "hashMatches"
  FROM submission_defs sd LEFT JOIN field_data_submission_provenance p ON p."submissionDefId" = sd.id
  WHERE sd.id = ANY(${sql.array(defIds, 'int4')})`);

module.exports = (service, endpoint) => {
  service.get('/projects/:projectId/forms/:xmlFormId/backcheck-agreement', endpoint(async (container, { params, auth }, _, response) => {
    const form = await container.Forms
      .getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.WithoutDef, Form.WithoutXml)
      .then(getOrNotFound);
    await auth.canOrReject('submission.read', form);
    response.set('Cache-Control', 'private, no-store');

    const linked = await container.db.any(sql`SELECT b.id, os."submitterId" AS "actorId", a."displayName",
        od.id AS "originalDefId", od."formDefId", rd.id AS "responseDefId", rs."formId" AS "responseFormId",
        rf."xmlFormId" AS "responseXmlFormId", m.pairs, count(*) OVER () AS total
      FROM field_data_backchecks b
      JOIN field_data_review_cases c ON c.id = b."caseId" AND c."claimVersionId" = b."claimVersionId"
      JOIN field_data_claim_versions v ON v.id = c."claimVersionId"
      JOIN submission_defs od ON od.id = v."submissionDefId"
      JOIN submissions os ON os.id = od."submissionId" AND os."deletedAt" IS NULL AND os."formId" = ${form.id}
      JOIN submission_defs rd ON rd.id = b."responseSubmissionDefId"
      JOIN submissions rs ON rs.id = rd."submissionId" AND rs."deletedAt" IS NULL
        AND rs."formId" = COALESCE(b."responseFormId", os."formId")
      JOIN forms rf ON rf.id = rs."formId" AND rf."projectId" = ${form.projectId}
      LEFT JOIN actors a ON a.id = os."submitterId"
      LEFT JOIN LATERAL (SELECT pairs FROM field_data_backcheck_mappings
        WHERE "backcheckId" = b.id ORDER BY revision DESC LIMIT 1) m ON true
      WHERE b.status = 'linked'
      ORDER BY b."linkedAt" DESC, b.id LIMIT ${MAX_BACKCHECKS}`);

    // Response forms the caller may read.
    const readable = new Set([form.id]);
    const others = [...new Map(linked.filter((b) => b.responseFormId !== form.id)
      .map((b) => [b.responseFormId, b.responseXmlFormId])).values()];
    await Promise.all(others.map(async (xmlFormId) => {
      const other = await container.Forms.getByProjectAndXmlFormId(form.projectId, xmlFormId, Form.WithoutDef, Form.WithoutXml);
      if (other.isDefined() && await auth.can('submission.read', other.get())) readable.add(other.get().id);
    }));
    const notReadable = linked.filter((b) => !readable.has(b.responseFormId)).length;
    const candidates = linked.filter((b) => readable.has(b.responseFormId));

    // The questions each form version of the original asks, with their labels.
    const defIds = [...new Set(candidates.map((b) => b.formDefId))];
    const asked = new Map();
    if (defIds.length > 0) {
      const defs = await container.db.any(sql`SELECT id, xml FROM form_defs WHERE id = ANY(${sql.array(defIds, 'int4')})`);
      for (const def of defs) {
        try { asked.set(def.id, askedQuestions(def.xml)); } catch { asked.set(def.id, null); }
      }
    }

    const unavailable = {};
    const notCompared = (reason) => { unavailable[reason] = (unavailable[reason] ?? 0) + 1; };
    const items = [];
    for (let i = 0; i < candidates.length; i += CHUNK) {
      const chunk = candidates.slice(i, i + CHUNK);
      const sources = new Map((await sourcesOf(container.db, chunk.flatMap((b) => [b.originalDefId, b.responseDefId]))) // eslint-disable-line no-await-in-loop
        .map((s) => [s.id, s]));
      for (const b of chunk) {
        const original = sources.get(b.originalDefId);
        const backcheck = sources.get(b.responseDefId);
        const mapped = b.pairs != null || b.responseFormId !== form.id;
        if (original.tooLarge || backcheck.tooLarge) { notCompared('size-limit'); continue; } // eslint-disable-line no-continue
        if (original.hashMatches !== true || backcheck.hashMatches !== true) { notCompared('source-integrity'); continue; } // eslint-disable-line no-continue
        if (mapped && b.pairs == null) { notCompared('no-mapping'); continue; } // eslint-disable-line no-continue
        const questions = asked.get(b.formDefId);
        if (!mapped && questions == null) { notCompared('form-definition'); continue; } // eslint-disable-line no-continue
        try {
          const comparison = mapped ? compareMappedAnswers(original.xml, backcheck.xml, b.pairs)
            : compareAnswers(original.xml, backcheck.xml);
          items.push({ actorId: b.actorId, displayName: b.displayName, fields: fieldsOf(comparison, { mapped, asked: questions }) });
        } catch (error) {
          if (error.reason == null) throw error;
          notCompared(error.reason);
        }
      }
    }

    const total = linked.length === 0 ? 0 : Number(linked[0].total);
    return {
      backchecks: { linked: total, used: linked.length, truncated: total > linked.length, compared: items.length, unavailable, notReadable },
      ...aggregate(items)
    };
  }));
};
