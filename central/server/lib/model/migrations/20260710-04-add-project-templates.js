// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Reusable Field Data project templates. Version 1 stores operational presets:
// quality rules, review workflow, integrations checklist, and form placeholders.

const up = async (db) => {
  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_project_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    category VARCHAR(80) NOT NULL DEFAULT 'General',
    description TEXT,
    config JSONB NOT NULL DEFAULT '{}'::JSONB,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP DEFAULT clock_timestamp(),
    "updatedAt" TIMESTAMP DEFAULT clock_timestamp()
  )`);

  await db.raw(`
    INSERT INTO field_data_project_templates (name, category, description, config)
    SELECT name, category, description, config
    FROM (VALUES
      (
        'Household Survey',
        'Survey',
        'Baseline or endline household data collection with review, corrections, exports, and field-team monitoring.',
        '{
          "forms": ["Household roster", "Household survey", "Consent"],
          "workflow": ["collect", "review", "request_correction", "approve", "export"],
          "qualityRules": {
            "noLocation": {"active": true},
            "noSubmitter": {"active": true},
            "rapidSuccession": {"active": true, "minutes": 3},
            "possibleDuplicate": {"active": true, "minutes": 10},
            "offHours": {"active": true, "startHour": 0, "endHour": 5},
            "unusualVolume": {"active": true, "minDailyCount": 8, "multiplier": 2.5, "lookbackDays": 45}
          },
          "integrations": ["csv_export", "public_report", "webhooks"]
        }'::JSONB
      ),
      (
        'School Monitoring',
        'Monitoring',
        'Recurring school visits with case-style follow up, assignment tracking, media review, and district summaries.',
        '{
          "forms": ["School profile", "Monitoring visit", "Issue follow-up"],
          "workflow": ["assign", "collect", "review", "clean", "report"],
          "qualityRules": {
            "noLocation": {"active": true},
            "noSubmitter": {"active": true},
            "possibleDuplicate": {"active": true, "minutes": 15},
            "offHours": {"active": true, "startHour": 0, "endHour": 6}
          },
          "integrations": ["media_library", "csv_export", "public_report"]
        }'::JSONB
      ),
      (
        'Health Facility Assessment',
        'Assessment',
        'Facility readiness assessment with DHIS2 export preparation and strict data-quality review.',
        '{
          "forms": ["Facility profile", "Readiness assessment", "Stock check"],
          "workflow": ["collect", "quality_check", "clean", "approve", "dhis2_export"],
          "qualityRules": {
            "noLocation": {"active": true},
            "noSubmitter": {"active": true},
            "rapidSuccession": {"active": true, "minutes": 5},
            "possibleDuplicate": {"active": true, "minutes": 20},
            "offHours": {"active": true, "startHour": 0, "endHour": 5},
            "unusualVolume": {"active": true, "minDailyCount": 6, "multiplier": 2, "lookbackDays": 45}
          },
          "integrations": ["dhis2", "csv_export", "webhooks"]
        }'::JSONB
      )
    ) as seed(name, category, description, config)
    WHERE NOT EXISTS (
      SELECT 1 FROM field_data_project_templates existing
      WHERE existing.name = seed.name
    )
  `);
};

const down = async (db) => {
  await db.raw('DROP TABLE IF EXISTS field_data_project_templates');
};

module.exports = { up, down };
