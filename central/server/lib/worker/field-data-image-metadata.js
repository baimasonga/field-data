// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { createHash } = require('crypto');
const { sql } = require('slonik');
const { blobContent } = require('../util/blob');

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const describePng = (bytes) => {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)
    || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR')
    return { format: 'png', parseStatus: 'invalid-header' };
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width === 0 || height === 0)
    return { format: 'png', parseStatus: 'invalid-dimensions' };
  return { format: 'png', parseStatus: 'parsed', width, height };
};

// This first producer extracts PNG dimensions only. Original bytes remain in
// Central's Blob store; the derivative is an independently hashed JSON result.
const deriveImageMetadataBatch = async ({ all, run, s3 }, limit = 25) => {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('Image metadata batch size must be between 1 and 100.');
  const rows = await all(sql`
    SELECT e.id, e."contentHash", v."contentHash" AS "observedHash",
      v."legacySha1Matched", b.id AS "blobId", b.sha, b.content, b.s3_status,
      COALESCE(v."byteSize", octet_length(b.content)) AS "byteSize"
    FROM field_data_evidence_records e
    JOIN blobs b ON b.id = e."blobId"
    LEFT JOIN field_data_evidence_verifications v ON v."evidenceId" = e.id
    LEFT JOIN field_data_evidence_derivations d ON d."evidenceId" = e.id
      AND d.kind = 'image-metadata' AND d.algorithm = 'png-header'
      AND d."algorithmVersion" = '1'
    WHERE e."mimeType" = 'image/png' AND e."blobId" IS NOT NULL
      AND (b.s3_status <> 'uploaded' OR ${s3?.enabled === true})
      AND d.id IS NULL AND COALESCE(v."byteSize", octet_length(b.content)) <= ${MAX_IMAGE_BYTES}
      AND (e."contentHash" IS NOT NULL OR v."legacySha1Matched" IS TRUE)
    ORDER BY e."createdAt", e.id LIMIT ${limit}`);
  let produced = 0;
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    const bytes = await blobContent(s3, {
      id: row.blobId, sha: row.sha, content: row.content, s3_status: row.s3_status
    });
    if (bytes == null || bytes.length > MAX_IMAGE_BYTES) continue;
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (digest !== (row.contentHash ?? row.observedHash)) continue;
    const output = JSON.stringify(describePng(bytes));
    // Hash the stored JSONB rendering so the read API can verify it exactly.
    // eslint-disable-next-line no-await-in-loop
    await run(sql`INSERT INTO field_data_evidence_derivations
      ("evidenceId", kind, algorithm, "algorithmVersion", "outputJson", "contentHash")
      VALUES (${row.id}, 'image-metadata', 'png-header', '1', ${output}::jsonb,
        'sha256:' || encode(sha256(convert_to((${output}::jsonb)::text, 'UTF8')), 'hex'))
      ON CONFLICT ("evidenceId", kind, algorithm, "algorithmVersion") DO NOTHING`);
    produced += 1;
  }
  return { examined: rows.length, produced };
};

module.exports = { describePng, deriveImageMetadataBatch };
