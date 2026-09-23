// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { v4: uuid } = require('uuid'); // eslint-disable-line no-restricted-modules

const BACKFILL_DEGRADED = Object.freeze({
  reason: 'historical-lineage-inferred',
  assumption: 'submission_defs.id order reflects committed version order',
  auditCompleteness: 'not-required'
});

const ambiguous = (submissionId, reason) => {
  throw new Error(`CLAIM_BACKFILL_AMBIGUOUS submissionId=${submissionId}: ${reason}`);
};

const buildBackfillRows = (input, uuidFactory = uuid) => {
  const grouped = new Map();
  const ordered = [...input].sort((a, b) =>
    (a.submissionId - b.submissionId) || (a.id - b.id));
  for (const row of ordered) {
    if (!Number.isInteger(row.submissionId)) ambiguous(row.submissionId, 'missing submissionId');
    if (!grouped.has(row.submissionId)) grouped.set(row.submissionId, []);
    grouped.get(row.submissionId).push(row);
  }
  const claims = [];
  const versions = [];
  for (const [submissionId, defs] of grouped) {
    const roots = defs.filter((def) => def.root === true);
    const currents = defs.filter((def) => def.current === true);
    if (roots.length !== 1) ambiguous(submissionId, `expected one root, found ${roots.length}`);
    if (currents.length !== 1)
      ambiguous(submissionId, `expected one current version, found ${currents.length}`);
    if (roots[0].id !== defs[0].id)
      ambiguous(submissionId, 'root is not the first submission_defs row by id');
    const claimId = uuidFactory();
    const versionIds = defs.map(() => uuidFactory());
    claims.push({ id: claimId, submissionId, schemaVersion: 'p0.2' });
    defs.forEach((def, index) => versions.push({
      id: versionIds[index], claimId, submissionDefId: def.id,
      ordinal: index + 1,
      previousVersionId: index === 0 ? null : versionIds[index - 1],
      lineageBasis: 'backfill-id-order', degraded: BACKFILL_DEGRADED,
      schemaVersion: 'p0.2'
    }));
  }
  return { claims, versions };
};

const up = async (db) => {
  await db.raw(`CREATE TABLE field_data_claims (
    id UUID PRIMARY KEY,
    "submissionId" INTEGER NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
    "schemaVersion" TEXT NOT NULL DEFAULT 'p0.2' CHECK ("schemaVersion" = 'p0.2'),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
  )`);
  await db.raw(`CREATE TABLE field_data_claim_versions (
    id UUID PRIMARY KEY,
    "claimId" UUID NOT NULL REFERENCES field_data_claims(id) ON DELETE CASCADE,
    "submissionDefId" INTEGER NOT NULL REFERENCES submission_defs(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal > 0),
    "previousVersionId" UUID NULL REFERENCES field_data_claim_versions(id)
      ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
    "lineageBasis" TEXT NOT NULL CHECK ("lineageBasis" IN ('created','backfill-id-order')),
    degraded JSONB NULL,
    "schemaVersion" TEXT NOT NULL DEFAULT 'p0.2' CHECK ("schemaVersion" = 'p0.2'),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT field_data_claim_versions_submission_def_unique UNIQUE ("submissionDefId"),
    CONSTRAINT field_data_claim_versions_claim_ordinal_unique UNIQUE ("claimId", ordinal),
    CONSTRAINT field_data_claim_versions_previous_unique UNIQUE ("previousVersionId")
  )`);
  // Deferred self-FK allows a whole chain to disappear with its ODK Submission on purge.
  await db.raw(`CREATE FUNCTION field_data_validate_claim_lineage()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE predecessor field_data_claim_versions%ROWTYPE;
    BEGIN
      IF NEW.ordinal = 1 THEN
        IF NEW."previousVersionId" IS NOT NULL THEN
          RAISE EXCEPTION 'CLAIM_LINEAGE_INVALID: ordinal 1 has a predecessor'
            USING ERRCODE = '23514';
        END IF;
      ELSE
        IF NEW."previousVersionId" IS NULL THEN
          RAISE EXCEPTION 'CLAIM_LINEAGE_INVALID: successor has no predecessor'
            USING ERRCODE = '23514';
        END IF;
        SELECT * INTO predecessor FROM field_data_claim_versions
          WHERE id = NEW."previousVersionId";
        IF NOT FOUND OR predecessor."claimId" <> NEW."claimId"
          OR predecessor.ordinal <> NEW.ordinal - 1 THEN
          RAISE EXCEPTION 'CLAIM_LINEAGE_INVALID: predecessor is not the prior version'
            USING ERRCODE = '23514';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$`);
  await db.raw(`CREATE CONSTRAINT TRIGGER field_data_claim_lineage_check
    AFTER INSERT OR UPDATE ON field_data_claim_versions
    DEFERRABLE INITIALLY IMMEDIATE
    FOR EACH ROW EXECUTE FUNCTION field_data_validate_claim_lineage()`);

  const result = await db.raw(`SELECT id, "submissionId", root, current
    FROM submission_defs ORDER BY "submissionId", id`);
  const { claims, versions } = buildBackfillRows(result.rows);
  if (claims.length !== 0) await db.batchInsert('field_data_claims', claims, 1000);
  if (versions.length !== 0) await db.batchInsert('field_data_claim_versions', versions, 1000);
};

const down = async (db) => {
  await db.raw('DROP TABLE IF EXISTS field_data_claim_versions');
  await db.raw('DROP TABLE IF EXISTS field_data_claims');
  await db.raw('DROP FUNCTION IF EXISTS field_data_validate_claim_lineage()');
};

module.exports = { up, down, buildBackfillRows };
