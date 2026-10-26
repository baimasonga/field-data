// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { sql } = require('slonik');
const Problem = require('./problem');
const conflict = () => Problem.user.mediaUploadConflict();
// Match the existing attachment endpoint's create-only rule: the App User's
// current owned root or receipted courier edit, an expected attachment, and no overwrite.
const target = async (tx, actor, manifest, existing, lockAttachment = false) => {
  const row = await tx.db.maybeOne(sql`SELECT sd.id, f.id AS "formId", f."acteeId", f."projectId"
    FROM field_keys fk JOIN actors a ON a.id = fk."actorId" AND a."deletedAt" IS NULL
    JOIN projects p ON p.id = fk."projectId" AND p."deletedAt" IS NULL AND p.archived IS NOT TRUE
    JOIN forms f ON f."projectId" = p.id AND f."xmlFormId" = ${manifest.xmlFormId} AND f."deletedAt" IS NULL AND f.state = 'open'
    JOIN submissions s ON s."formId" = f.id AND s."deletedAt" IS NULL AND s.draft = FALSE
    JOIN submission_defs sd ON sd."submissionId" = s.id AND sd.current AND sd."instanceId" = ${manifest.instanceId} AND sd."submitterId" = ${actor.id}
      AND (sd.root OR (s."submitterId"=${actor.id} AND EXISTS(SELECT 1 FROM field_data_xml_courier_events e JOIN field_data_xml_courier_targets t ON t.id=e."targetId"
        WHERE e.kind='delivery' AND (e.details->>'submissionDefId')::integer=sd.id AND t."ownerId"=${actor.id} AND t.manifest ? 'deprecatedId')))
    WHERE fk."actorId" = ${actor.id} AND EXISTS (SELECT 1 FROM assignments ass JOIN roles r ON r.id = ass."roleId"
      WHERE ass."actorId" = ${actor.id} AND ass."acteeId" = f."acteeId" AND r.verbs ? 'submission.create')
    FOR SHARE OF fk, a, p, f, s, sd`);
  if (row == null) throw Problem.user.notFound();
  // Hold a live grant while accepting a chunk or finalizing its attachment.
  const grant = await tx.db.maybeOne(sql`SELECT ass."actorId" FROM assignments ass JOIN roles r ON r.id = ass."roleId"
    WHERE ass."actorId" = ${actor.id} AND ass."acteeId" = ${row.acteeId} AND r.verbs ? 'submission.create'
    LIMIT 1 FOR SHARE OF ass, r`);
  if (grant == null) throw Problem.user.notFound();
  if (existing != null && (existing.submissionDefId !== row.id || existing.projectId !== row.projectId)) throw conflict();
  const attachment = await tx.db.maybeOne(sql`SELECT "blobId" FROM submission_attachments
    WHERE "submissionDefId" = ${row.id} AND name = ${manifest.name} ${lockAttachment ? sql`FOR UPDATE` : sql``}`);
  if (attachment == null) throw Problem.user.notFound();
  if (existing?.status === 'completed' && (existing.blobId == null || attachment.blobId !== existing.blobId)) throw conflict();
  if (attachment.blobId != null && attachment.blobId !== existing?.blobId) throw conflict();
  return { ...row, attachmentBlobId: attachment.blobId };
};
module.exports = target;
