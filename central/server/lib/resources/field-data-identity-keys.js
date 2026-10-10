// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Identity keys (F2): docs/field-intelligence/F2-identity-reuse.md
//
// Project managers declare which questions identify a household or respondent;
// reviewers who can change submissions read the keys and run them through the
// existing integrity run. Collectors never see them.

const crypto = require('node:crypto');
const { sql } = require('slonik');
const { Form } = require('../model/frames');
const Problem = require('../util/problem');
const { getOrNotFound } = require('../util/promise');
const { LIMITS, normalizeKey, usability, usabilityIn } = require('../util/identity-keys');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const audit = (db, actorId, formId, action, details) => db.query(sql`INSERT INTO audits
  ("actorId", action, "acteeId", details, "loggedAt", processed, failures)
  SELECT ${actorId}, ${action}, f."acteeId", ${JSON.stringify(details)},
    clock_timestamp(), clock_timestamp(), 0 FROM forms f WHERE f.id = ${formId}`);

const ifMatch = (headers) => {
  if (headers['if-match'] == null) throw Problem.user.identityKeyRevisionRequired();
  const matched = /^"key-([1-9]\d{0,8})"$/.exec(headers['if-match']);
  if (matched == null) throw Problem.user.identityKeyRevisionStale();
  return Number(matched[1]);
};

const normalized = (body, fields, context) => {
  try { return normalizeKey(body, fields, context); } catch (error) {
    if (error.reason != null) throw Problem.user.identityKeyInvalid({ field: error.field, reason: error.reason });
    throw error;
  }
};

// Other forms (F2b): the current fields of each form a key names that the
// caller may read submissions of. A form the caller cannot read is left out,
// so it reads as "not a form in this project" rather than revealing it exists.
const otherForms = async (container, auth, projectId, names) => {
  const others = new Map();
  const wanted = [...new Set((Array.isArray(names) ? names : []).map((n) => n?.xmlFormId).filter((n) => typeof n === 'string' && n.length <= 255))].slice(0, LIMITS.alsoIn + 1);
  for (const xmlFormId of wanted) {
    // eslint-disable-next-line no-await-in-loop
    const found = await container.Forms.getByProjectAndXmlFormId(projectId, xmlFormId, Form.PublishedVersion);
    // eslint-disable-next-line no-await-in-loop
    if (found.isDefined() && await auth.can('submission.read', found.get()))
      // eslint-disable-next-line no-await-in-loop
      others.set(xmlFormId, await container.Forms.getFields(found.get().def.id));
  }
  return others;
};
const alsoInStatus = (definition, others) => Object.fromEntries((definition.alsoIn ?? []).map((entry) => [entry.xmlFormId,
  others.has(entry.xmlFormId) ? usabilityIn(definition, entry, others.get(entry.xmlFormId)) : { usable: false, reason: 'not-available' }]));

const present = (row, fields, others = new Map()) => ({
  id: row.id, title: row.title, explanation: row.explanation, benignExplanations: row.benignExplanations,
  nextStep: row.nextStep, ...row.definition, active: row.active, version: row.version,
  revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt,
  status: usability(row.definition, fields),
  ...(row.definition.alsoIn != null ? { alsoInStatus: alsoInStatus(row.definition, others) } : {})
});

module.exports = (service, endpoint) => {
  const root = '/projects/:projectId/forms/:xmlFormId/identity-keys';

  const formFor = async (container, params) => container.Forms
    .getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.PublishedVersion)
    .then(getOrNotFound);
  // Writing keys is project management; the form must exist and be published.
  const managed = async (container, params, auth) => {
    const project = await container.Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('project.update', project);
    return formFor(container, params);
  };
  const keyFor = async (db, form, keyId) => {
    if (!UUID.test(keyId)) throw Problem.user.notFound();
    const row = await db.maybeOne(sql`select * from field_data_identity_keys
      where id = ${keyId} and "formId" = ${form.id} for update`);
    if (row == null) throw Problem.user.notFound();
    return row;
  };
  const activeCount = (db, formId, except = null) => db.oneFirst(sql`select count(*)::integer
    from field_data_identity_keys where "formId" = ${formId} and active
      and (${except}::uuid is null or id <> ${except}::uuid)`);

  service.get(root, endpoint(async (container, { params, auth }, _, response) => {
    const form = await formFor(container, params);
    await auth.canOrReject('submission.update', form);
    response.set('Cache-Control', 'private, no-store');
    const fields = await container.Forms.getFields(form.def.id);
    const rows = await container.db.any(sql`select * from field_data_identity_keys
      where "formId" = ${form.id} order by active desc, "createdAt", id`);
    const others = await otherForms(container, auth, form.projectId, rows.flatMap((row) => row.definition.alsoIn ?? []));
    return rows.map((row) => present(row, fields, others));
  }));

  service.post(root, endpoint(async (container, { params, auth, body }, _, response) => {
    const form = await managed(container, params, auth);
    const fields = await container.Forms.getFields(form.def.id);
    const others = await otherForms(container, auth, form.projectId, body?.alsoIn);
    const key = normalized(body, fields, { xmlFormId: form.xmlFormId, others });
    await container.db.query(sql`select pg_advisory_xact_lock(74137, ${form.id})`);
    if (key.active && await activeCount(container.db, form.id) >= LIMITS.keys) throw Problem.user.identityKeyLimit();
    const id = crypto.randomUUID();
    const actorId = auth.actor.map((a) => a.id).orNull();
    const row = await container.db.one(sql`insert into field_data_identity_keys
      (id, "formId", title, explanation, "benignExplanations", "nextStep", definition, "definitionHash", active, "createdBy")
      values (${id}, ${form.id}, ${key.title}, ${key.explanation}, ${JSON.stringify(key.benignExplanations)},
        ${key.nextStep}, ${JSON.stringify(key.definition)}, ${key.definitionHash}, ${key.active}, ${actorId})
      returning *`);
    await audit(container.db, actorId, form.id, 'field_data.identity_key.create', { keyId: id, version: 1 });
    response.status(201); response.set('Cache-Control', 'private, no-store');
    return present(row, fields, others);
  }));

  service.put(`${root}/:keyId`, endpoint(async (container, { params, auth, body, headers }, _, response) => {
    const form = await managed(container, params, auth);
    const expected = ifMatch(headers);
    const fields = await container.Forms.getFields(form.def.id);
    const others = await otherForms(container, auth, form.projectId, body?.alsoIn);
    const key = normalized(body, fields, { xmlFormId: form.xmlFormId, others });
    await container.db.query(sql`select pg_advisory_xact_lock(74137, ${form.id})`);
    const current = await keyFor(container.db, form, params.keyId);
    if (current.revision !== expected) throw Problem.user.identityKeyRevisionStale();
    if (key.active && !current.active && await activeCount(container.db, form.id, current.id) >= LIMITS.keys)
      throw Problem.user.identityKeyLimit();
    // Only a change to what the key matches makes it a new version.
    const version = key.definitionHash === current.definitionHash ? current.version : current.version + 1;
    const row = await container.db.one(sql`update field_data_identity_keys set
      title = ${key.title}, explanation = ${key.explanation},
      "benignExplanations" = ${JSON.stringify(key.benignExplanations)}, "nextStep" = ${key.nextStep},
      definition = ${JSON.stringify(key.definition)}, "definitionHash" = ${key.definitionHash},
      active = ${key.active}, version = ${version}, revision = revision + 1, "updatedAt" = clock_timestamp()
      where id = ${current.id} returning *`);
    await audit(container.db, auth.actor.map((a) => a.id).orNull(), form.id, 'field_data.identity_key.update',
      { keyId: current.id, version, previousVersion: current.version, active: key.active });
    response.set('Cache-Control', 'private, no-store');
    return present(row, fields, others);
  }));

  // Deactivates; the key and the findings it produced are kept.
  service.delete(`${root}/:keyId`, endpoint(async (container, { params, auth, headers }, _, response) => {
    const form = await managed(container, params, auth);
    const expected = ifMatch(headers);
    await container.db.query(sql`select pg_advisory_xact_lock(74137, ${form.id})`);
    const current = await keyFor(container.db, form, params.keyId);
    if (current.revision !== expected) throw Problem.user.identityKeyRevisionStale();
    const fields = await container.Forms.getFields(form.def.id);
    const row = await container.db.one(sql`update field_data_identity_keys
      set active = false, revision = revision + 1, "updatedAt" = clock_timestamp()
      where id = ${current.id} returning *`);
    await audit(container.db, auth.actor.map((a) => a.id).orNull(), form.id, 'field_data.identity_key.deactivate',
      { keyId: current.id, version: current.version });
    const others = await otherForms(container, auth, form.projectId, row.definition.alsoIn);
    response.set('Cache-Control', 'private, no-store');
    return present(row, fields, others);
  }));
};
