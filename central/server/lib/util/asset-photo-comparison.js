// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { sql } = require('slonik');
const { selectFacts } = require('./asset-freshness');
const { blobContent } = require('./blob');
const { validBytes, hash, MAX_BYTES } = require('./media-extraction');
const reference = (history, predicate, at) => {
  const fact = selectFacts(history.filter(row => row.predicate === predicate), at, at)[0];
  if (!fact) return { status: 'missing', citation: null };
  const citation = { observationId: fact.id, claimVersionId: fact.claimVersionId, sourceUrl: fact.sourceUrl,
    validFrom: fact.validFrom, recordedAt: fact.recordedAt, freshness: fact.freshness.status };
  if (fact.integrityStatus !== 'verified') return { status: 'source-unverified', citation };
  if (fact.state !== 'known') return { status: fact.state, citation };
  if (fact.freshness.status !== 'fresh') return { status: fact.freshness.status, citation };
  // Attachment names exclude paths and control characters.
  // eslint-disable-next-line no-control-regex
  if (typeof fact.value !== 'string' || !fact.value || fact.value.length > 255 || fact.value !== fact.value.trim() || /[/\\\x00-\x1f]/.test(fact.value)) return { status: 'invalid-photo-reference', citation };
  return { status: 'referenced', citation, name: fact.value };
};
const photo = async (container, history, predicate, at) => {
  const selected = reference(history, predicate, at);
  if (selected.status !== 'referenced') return selected;
  const file = await container.db.maybeOne(sql`SELECT sa."blobId", b."contentType" FROM field_data_claim_versions cv
    JOIN submission_attachments sa ON sa."submissionDefId" = cv."submissionDefId" AND sa.name = ${selected.name}
    LEFT JOIN blobs b ON b.id = sa."blobId" WHERE cv.id = ${selected.citation.claimVersionId}`);
  if (!file?.blobId) return { ...selected, status: 'attachment-missing' };
  if (!['image/png', 'image/jpeg'].includes(file.contentType)) return { ...selected, status: 'unsupported-photo' };
  const blob = (await container.Blobs.getById(file.blobId)).orNull();
  const bytes = blob && await blobContent(container.s3, blob);
  if (!validBytes(bytes, file.contentType) || bytes.length > MAX_BYTES) return { ...selected, status: 'invalid-photo-bytes' };
  return { ...selected, status: 'usable', photo: { name: selected.name, contentType: file.contentType,
    sha256: hash(bytes), size: bytes.length, base64: bytes.toString('base64') } };
};
module.exports = { reference, photo };
