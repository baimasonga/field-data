// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { createHash } = require('crypto');
const { sql } = require('slonik');

// A bounded batch; each object is hashed as a stream and never buffered in RAM.
// The SHA-1 comparison anchors a newly observed SHA-256 to Central's digest
// recorded at upload. A mismatch is retained for investigation, not discarded.
const verifyEvidenceBatch = async ({ all, run, s3 }, limit = 25) => {
  if (!s3?.enabled) throw new Error('Object storage must be configured for evidence verification.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('Evidence verification batch size must be between 1 and 100.');
  const candidates = await all(sql`
    SELECT e.id, e."blobId", b.sha
    FROM field_data_evidence_records e
    JOIN blobs b ON b.id = e."blobId" AND b.s3_status = 'uploaded'
    LEFT JOIN field_data_evidence_verifications v ON v."evidenceId" = e.id
    WHERE e."contentHash" IS NULL AND v."evidenceId" IS NULL
    ORDER BY e."createdAt", e.id LIMIT ${limit}`);
  let matched = 0;
  let mismatched = 0;
  for (const candidate of candidates) {
    const sha1 = createHash('sha1');
    const sha256 = createHash('sha256');
    let size = 0;
    // s3.pipeContent returns Central's PartialPipe; its initial stream is the
    // object response. The for-await iterator propagates read failures.
    // eslint-disable-next-line no-await-in-loop
    const source = await s3.pipeContent({ id: candidate.blobId, sha: candidate.sha });
    // eslint-disable-next-line no-restricted-syntax, no-await-in-loop
    for await (const chunk of source.streams[0]) {
      sha1.update(chunk);
      sha256.update(chunk);
      size += chunk.length;
    }
    const legacySha1Matched = sha1.digest('hex') === candidate.sha;
    // eslint-disable-next-line no-await-in-loop
    await run(sql`INSERT INTO field_data_evidence_verifications
      ("evidenceId", "contentHash", "byteSize", "legacySha1Matched")
      VALUES (${candidate.id}, ${`sha256:${sha256.digest('hex')}`}, ${size}, ${legacySha1Matched})
      ON CONFLICT ("evidenceId") DO NOTHING`);
    if (legacySha1Matched) matched += 1;
    else mismatched += 1;
  }
  return { processed: candidates.length, matched, mismatched };
};

module.exports = { verifyEvidenceBatch };
