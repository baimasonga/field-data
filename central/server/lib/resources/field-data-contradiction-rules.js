// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Contradiction rules (F1): docs/field-intelligence/F1-answer-contradictions.md
//
// Project managers write rules; reviewers who can change submissions read them
// and run them through the existing integrity run. Collectors never see them:
// the rule logic is not something to send to the people being checked.

const crypto = require('node:crypto');
const { sql } = require('slonik');
const { Form } = require('../model/frames');
const Problem = require('../util/problem');
const { getOrNotFound } = require('../util/promise');
const { LIMITS, normalizeRule, usability } = require('../util/contradiction-rules');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const audit = (db, actorId, formId, action, details) => db.query(sql`INSERT INTO audits
  ("actorId", action, "acteeId", details, "loggedAt", processed, failures)
  SELECT ${actorId}, ${action}, f."acteeId", ${JSON.stringify(details)},
    clock_timestamp(), clock_timestamp(), 0 FROM forms f WHERE f.id = ${formId}`);

const ifMatch = (headers) => {
  if (headers['if-match'] == null) throw Problem.user.contradictionRuleRevisionRequired();
  const matched = /^"rule-([1-9]\d{0,8})"$/.exec(headers['if-match']);
  if (matched == null) throw Problem.user.contradictionRuleRevisionStale();
  return Number(matched[1]);
};

const normalized = (body, fields) => {
  try { return normalizeRule(body, fields); } catch (error) {
    if (error.reason != null) throw Problem.user.contradictionRuleInvalid({ field: error.field, reason: error.reason });
    throw error;
  }
};

const present = (row, fields) => ({
  id: row.id, title: row.title, explanation: row.explanation, benignExplanations: row.benignExplanations,
  nextStep: row.nextStep, conditions: row.conditions, active: row.active, version: row.version,
  revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt,
  status: usability(row.conditions, fields)
});

module.exports = (service, endpoint) => {
  const root = '/projects/:projectId/forms/:xmlFormId/contradiction-rules';

  const formFor = async (container, params) => container.Forms
    .getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.PublishedVersion)
    .then(getOrNotFound);
  // Writing rules is project management; the form must exist and be published.
  const managed = async (container, params, auth) => {
    const project = await container.Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('project.update', project);
    return formFor(container, params);
  };
  const ruleFor = async (db, form, ruleId) => {
    if (!UUID.test(ruleId)) throw Problem.user.notFound();
    const row = await db.maybeOne(sql`select * from field_data_contradiction_rules
      where id = ${ruleId} and "formId" = ${form.id} for update`);
    if (row == null) throw Problem.user.notFound();
    return row;
  };
  const activeCount = (db, formId, except = null) => db.oneFirst(sql`select count(*)::integer
    from field_data_contradiction_rules where "formId" = ${formId} and active
      and (${except}::uuid is null or id <> ${except}::uuid)`);

  service.get(root, endpoint(async (container, { params, auth }, _, response) => {
    const form = await formFor(container, params);
    await auth.canOrReject('submission.update', form);
    response.set('Cache-Control', 'private, no-store');
    const fields = await container.Forms.getFields(form.def.id);
    const rows = await container.db.any(sql`select * from field_data_contradiction_rules
      where "formId" = ${form.id} order by active desc, "createdAt", id`);
    return rows.map((row) => present(row, fields));
  }));

  service.post(root, endpoint(async (container, { params, auth, body }, _, response) => {
    const form = await managed(container, params, auth);
    const fields = await container.Forms.getFields(form.def.id);
    const rule = normalized(body, fields);
    await container.db.query(sql`select pg_advisory_xact_lock(74136, ${form.id})`);
    if (rule.active && await activeCount(container.db, form.id) >= LIMITS.rules) throw Problem.user.contradictionRuleLimit();
    const id = crypto.randomUUID();
    const actorId = auth.actor.map((a) => a.id).orNull();
    const row = await container.db.one(sql`insert into field_data_contradiction_rules
      (id, "formId", title, explanation, "benignExplanations", "nextStep", conditions, "conditionsHash", active, "createdBy")
      values (${id}, ${form.id}, ${rule.title}, ${rule.explanation}, ${JSON.stringify(rule.benignExplanations)},
        ${rule.nextStep}, ${JSON.stringify(rule.conditions)}, ${rule.conditionsHash}, ${rule.active}, ${actorId})
      returning *`);
    await audit(container.db, actorId, form.id, 'field_data.contradiction_rule.create', { ruleId: id, version: 1 });
    response.status(201); response.set('Cache-Control', 'private, no-store');
    return present(row, fields);
  }));

  service.put(`${root}/:ruleId`, endpoint(async (container, { params, auth, body, headers }, _, response) => {
    const form = await managed(container, params, auth);
    const expected = ifMatch(headers);
    const fields = await container.Forms.getFields(form.def.id);
    const rule = normalized(body, fields);
    await container.db.query(sql`select pg_advisory_xact_lock(74136, ${form.id})`);
    const current = await ruleFor(container.db, form, params.ruleId);
    if (current.revision !== expected) throw Problem.user.contradictionRuleRevisionStale();
    if (rule.active && !current.active && await activeCount(container.db, form.id, current.id) >= LIMITS.rules)
      throw Problem.user.contradictionRuleLimit();
    // Only a change to what the rule checks makes it a new version.
    const version = rule.conditionsHash === current.conditionsHash ? current.version : current.version + 1;
    const row = await container.db.one(sql`update field_data_contradiction_rules set
      title = ${rule.title}, explanation = ${rule.explanation},
      "benignExplanations" = ${JSON.stringify(rule.benignExplanations)}, "nextStep" = ${rule.nextStep},
      conditions = ${JSON.stringify(rule.conditions)}, "conditionsHash" = ${rule.conditionsHash},
      active = ${rule.active}, version = ${version}, revision = revision + 1, "updatedAt" = clock_timestamp()
      where id = ${current.id} returning *`);
    await audit(container.db, auth.actor.map((a) => a.id).orNull(), form.id, 'field_data.contradiction_rule.update',
      { ruleId: current.id, version, previousVersion: current.version, active: rule.active });
    response.set('Cache-Control', 'private, no-store');
    return present(row, fields);
  }));

  // Deactivates; the rule and the findings it produced are kept.
  service.delete(`${root}/:ruleId`, endpoint(async (container, { params, auth, headers }, _, response) => {
    const form = await managed(container, params, auth);
    const expected = ifMatch(headers);
    await container.db.query(sql`select pg_advisory_xact_lock(74136, ${form.id})`);
    const current = await ruleFor(container.db, form, params.ruleId);
    if (current.revision !== expected) throw Problem.user.contradictionRuleRevisionStale();
    const fields = await container.Forms.getFields(form.def.id);
    const row = await container.db.one(sql`update field_data_contradiction_rules
      set active = false, revision = revision + 1, "updatedAt" = clock_timestamp()
      where id = ${current.id} returning *`);
    await audit(container.db, auth.actor.map((a) => a.id).orNull(), form.id, 'field_data.contradiction_rule.deactivate',
      { ruleId: current.id, version: current.version });
    response.set('Cache-Control', 'private, no-store');
    return present(row, fields);
  }));
};
