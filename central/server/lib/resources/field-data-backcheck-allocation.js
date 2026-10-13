// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { sql } = require('slonik');
const { Form } = require('../model/frames');
const { getOrNotFound } = require('../util/promise');
const Problem = require('../util/problem');
const { validatePolicy, capacity } = require('../util/automatic-backchecks');
const { assigneesFor } = require('./field-data-backchecks');
const { ALLOCATION_LOCK } = require('../util/backcheck-request');
const view = async (container, auth, form, responseXmlFormId = null) => {
  const policy = await container.db.maybeOne(sql`SELECT enabled, settings, report, "updatedAt"
    FROM field_data_backcheck_allocation WHERE "formId" = ${form.id}`);
  const rows = await container.db.any(sql`SELECT f.id, f."xmlFormId", f."acteeId", fd.name FROM forms f
    JOIN form_defs fd ON fd.id = f."currentDefId" WHERE f."projectId" = ${form.projectId}
      AND f."deletedAt" IS NULL AND f.state = 'open' ORDER BY fd.name, f."xmlFormId"`);
  const forms = [];
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    if (await auth.can('submission.read', row.acteeId)) forms.push(row);
  }
  const response = forms.find(f => f.xmlFormId === (responseXmlFormId ?? policy?.settings.responseXmlFormId));
  const collectors = response == null ? [] : await assigneesFor(container.db, form.projectId, response.acteeId, null);
  return { policy, forms: forms.map(({ acteeId, ...f }) => f), collectors: collectors.map(c => ({ id: c.id, name: c.name,
    pending: c.pending, overdue: c.overdue, maxPending: capacity(c, policy?.settings ?? { maxPending: 5, collectorLimits: [] }) })) };
};
module.exports = (service, endpoint) => {
  const root = '/projects/:projectId/forms/:xmlFormId/backcheck-allocation';
  const scoped = async (container, auth, params, write) => {
    const form = await container.Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId,
      Form.WithoutDef, Form.WithoutXml).then(getOrNotFound);
    await auth.canOrReject('submission.read', form);
    await auth.canOrReject(write ? 'submission.update' : 'submission.list', form);
    if (write) await auth.canOrReject('project.update', await container.Projects.getById(params.projectId).then(getOrNotFound));
    return form;
  };
  service.get(root, endpoint(async (container, { params, auth, query }, _, response) => {
    const form = await scoped(container, auth, params, false);
    response.set('Cache-Control', 'private, no-store');
    if (query.responseXmlFormId != null && (typeof query.responseXmlFormId !== 'string' || query.responseXmlFormId.length > 255))
      throw Problem.user.reviewAssignmentInvalid();
    return view(container, auth, form, query.responseXmlFormId);
  }));
  service.put(root, endpoint(async (container, { params, auth, body }, _, response) => {
    const form = await scoped(container, auth, params, true);
    const settings = validatePolicy(body);
    if (settings == null) throw Problem.user.reviewAssignmentInvalid();
    const target = await container.Forms.getByProjectAndXmlFormId(params.projectId, settings.responseXmlFormId,
      Form.PublishedVersion, Form.WithoutXml).then(getOrNotFound);
    await auth.canOrReject('submission.read', target);
    if (target.state !== 'open') throw Problem.user.reviewAssignmentInvalid();
    const validCollectors = await container.db.any(sql`SELECT fk."actorId" FROM field_keys fk
      JOIN actors a ON a.id = fk."actorId" AND a."deletedAt" IS NULL WHERE fk."projectId" = ${form.projectId}`);
    const ids = new Set(validCollectors.map(c => c.actorId));
    if (settings.collectorLimits.some(c => !ids.has(c.actorId))) throw Problem.user.reviewAssignmentInvalid();
    const actorId = auth.actor.orNull().id;
    const result = await container.transacting(async tx => {
      await tx.db.query(sql`SELECT pg_advisory_xact_lock(${ALLOCATION_LOCK}, ${form.projectId})`);
      await tx.db.query(sql`INSERT INTO field_data_backcheck_allocation ("formId", "responseFormId", enabled, settings, "configuredBy")
        VALUES (${form.id}, ${target.id}, ${settings.enabled}, ${JSON.stringify(settings)}, ${actorId})
        ON CONFLICT ("formId") DO UPDATE SET "responseFormId" = EXCLUDED."responseFormId", enabled = EXCLUDED.enabled,
          settings = EXCLUDED.settings, "configuredBy" = EXCLUDED."configuredBy", "updatedAt" = clock_timestamp(),
          "lastCaseId" = NULL, report = NULL`);
      await tx.db.query(sql`INSERT INTO audits ("actorId", action, "acteeId", details, "loggedAt", processed, failures)
        VALUES (${actorId}, 'field_data.backcheck_allocation.configure', ${form.acteeId}, ${JSON.stringify(settings)}, clock_timestamp(), NULL, 0)`);
      return view(tx, auth, form);
    });
    response.set('Cache-Control', 'private, no-store');
    return result;
  }));
};
