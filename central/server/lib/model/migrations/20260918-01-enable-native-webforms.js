// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const up = (db) => db.raw(`
  ALTER TABLE forms
    ALTER COLUMN "webformsEnabled" SET DEFAULT TRUE;

  UPDATE forms
    SET "webformsEnabled" = TRUE;

  UPDATE forms
    SET "enketoId" = 'wf' || md5('form:' || id::text || ':' || clock_timestamp()::text || ':' || random()::text)
    WHERE "enketoId" IS NULL;

  UPDATE forms
    SET "enketoOnceId" = 'wo' || md5('once:' || id::text || ':' || clock_timestamp()::text || ':' || random()::text)
    WHERE "enketoOnceId" IS NULL;

  UPDATE form_defs AS definition
    SET "enketoId" = 'wd' || md5('draft:' || definition.id::text || ':' || clock_timestamp()::text || ':' || random()::text)
    FROM forms AS form
    WHERE definition.id = form."draftDefId"
      AND definition."enketoId" IS NULL;
`);

const down = (db) => db.raw(`
  ALTER TABLE forms
    ALTER COLUMN "webformsEnabled" SET DEFAULT FALSE;
`);

module.exports = { up, down };
