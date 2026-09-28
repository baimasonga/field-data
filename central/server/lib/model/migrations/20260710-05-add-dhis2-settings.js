// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Saved DHIS2 export mapping defaults for Field Data aggregate exports.

const up = async (db) => {
  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_dhis2_settings (
    id BOOLEAN PRIMARY KEY DEFAULT true,
    config JSONB NOT NULL DEFAULT '{}'::JSONB,
    "createdAt" TIMESTAMP DEFAULT clock_timestamp(),
    "updatedAt" TIMESTAMP DEFAULT clock_timestamp(),
    CONSTRAINT field_data_dhis2_settings_singleton CHECK (id = true)
  )`);

  await db.raw(`
    INSERT INTO field_data_dhis2_settings (id, config)
    VALUES (
      true,
      '{
        "dataSet": "FdDataSet01",
        "orgUnit": "FdOrgUnit01",
        "categoryOptionCombo": "",
        "attributeOptionCombo": "",
        "dataElements": {
          "submissions": "FdTotSubm01",
          "approved": "FdApproved1",
          "rejected": "FdRejected1",
          "inReview": "FdInReview1",
          "activeForms": "FdActForms1"
        }
      }'::JSONB
    )
    ON CONFLICT (id) DO NOTHING
  `);
};

const down = async (db) => {
  await db.raw('DROP TABLE IF EXISTS field_data_dhis2_settings');
};

module.exports = { up, down };
