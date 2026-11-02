// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { sql } = require('slonik');
const Option = require('./option');
const Problem = require('./problem');
const { buildEnvelope } = require('./provenance');
const xml = require('./xml-couriers');
const conflict = () => Problem.user.mediaUploadConflict();
// Both transports lock the shared immutable target before consulting either ledger.
const consumed = (tx, targetId) => tx.db.maybeOne(sql`SELECT details FROM field_data_xml_courier_events WHERE "targetId"=${targetId} AND kind='delivery'
 UNION ALL SELECT details FROM field_data_xml_background_events WHERE "targetId"=${targetId} AND kind='delivery' LIMIT 1`);
const accept = async (tx, target, parsed, { sourceRef, transformVersion = null, userAgent = 'Field Data XML delivery', consumed: wasConsumed = false, expectedDefId = null }) => {
  const formScope = await xml.scope(tx, target.ownerId, target.projectId, target.manifest, target);
  const base = await xml.editBase(tx, target.ownerId, target.formId, target.manifest);
  const existing = await tx.db.maybeOne(sql`SELECT s.id,s."submitterId",s."deletedAt",sd.id AS "submissionDefId",sd.xml,sd.current,sd.root,sd."formDefId",sd."createdAt"
    FROM submissions s JOIN submission_defs sd ON sd."submissionId"=s.id AND sd.current
    WHERE s."formId"=${target.formId} AND sd."instanceId"=${target.manifest.instanceId} AND s.draft=FALSE FOR SHARE OF s,sd`);
  if (wasConsumed) {
    if (!existing || existing.deletedAt || (!existing.root && !base) || (expectedDefId != null && existing.submissionDefId !== expectedDefId) || xml.digest(existing.xml) !== target.manifest.sha256) throw Problem.user.notFound();
    return { submissionDefId: existing.submissionDefId, submittedAt: existing.createdAt, alreadyReceived: true, base };
  }
  if (existing && ((base && existing.id !== base.submissionId) || existing.deletedAt || (!existing.root && !base) || existing.submitterId !== target.ownerId || existing.formDefId !== target.formDefId || xml.digest(existing.xml) !== target.manifest.sha256)) throw conflict();
  let submissionDefId = existing?.submissionDefId; let submittedAt = existing?.createdAt;
  if (!existing) {
    const form = (await tx.Forms.getByProjectAndXmlFormId(target.projectId, target.manifest.xmlFormId, target.manifest.version)).orNull();
    if (!form || form.def.id !== formScope.formDefId) throw Problem.user.notFound();
    const owner = (await tx.Actors.getById(target.ownerId)).orNull(); if (!owner) throw Problem.user.notFound();
    // Scoped attribution only: the route must validate its caller/capability before invoking this helper.
    // Native workers retain collector attribution; the separate custody audit records transport.
    const collector = tx.with({ context: { ...tx.context, auth: { actor: Option.of(owner), isAuthenticated: true } } });
    const provenance = buildEnvelope({ origin: 'collected', sourceRef, xml: parsed.partial.xml, transformVersion: transformVersion ?? (base ? 'xml-edit-courier@1' : 'xml-courier@1') });
    if (base) {
      const deprecated = (await collector.Submissions.getAnyDefByFormAndInstanceId(target.formId, target.manifest.deprecatedId, false)).orNull();
      if (!deprecated || !deprecated.current || deprecated.id !== base.id) throw conflict();
      const saved = await collector.Submissions.createVersion(parsed.partial, deprecated, form, null, userAgent, null, provenance);
      const definition = saved.aux.currentVersion.with({ def: saved.aux.currentVersion });
      // A new encrypted envelope has a new key/IV schedule: all ciphertext must be supplied afresh.
      const inherited = parsed.partial.def.localKey == null ? await collector.SubmissionAttachments.getForFormAndInstanceId(target.formId, target.manifest.deprecatedId, false) : [];
      await collector.SubmissionAttachments.create(definition, form, await collector.Forms.getBinaryFields(form.def.id), [], inherited);
      submissionDefId = definition.id; submittedAt = definition.createdAt;
    } else {
      const submission = await collector.Submissions.createNew(parsed.partial, form, null, userAgent, null, provenance);
      await collector.SubmissionAttachments.create(submission, form, await collector.Forms.getBinaryFields(form.def.id));
      submissionDefId = submission.def.id; submittedAt = submission.createdAt;
    }
  }
  return { submissionDefId, submittedAt, alreadyReceived: existing != null, base };
};
module.exports = { consumed, accept };
