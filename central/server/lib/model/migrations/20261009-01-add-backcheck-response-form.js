// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const up = async (db) => {
  await db.raw(`ALTER TABLE field_data_backchecks ADD COLUMN IF NOT EXISTS
    "responseFormId" INTEGER REFERENCES forms(id) ON DELETE RESTRICT;
    UPDATE field_data_backchecks b SET "responseFormId" = s."formId"
    FROM field_data_claim_versions v JOIN submission_defs sd ON sd.id = v."submissionDefId"
      JOIN submissions s ON s.id = sd."submissionId"
    WHERE v.id = b."claimVersionId" AND b."responseFormId" IS NULL`);
};
// Preserve the selected form through rollback; legacy inserts can remain NULL
// and are interpreted as the original form on the next upgrade.
const down = async () => {};
module.exports = { up, down };
