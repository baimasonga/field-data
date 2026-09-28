// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Configurable review-queue quality rules. These let admins tune or disable the
// Field Data checks without changing code.

const up = async (db) => {
  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_quality_rules (
    key VARCHAR(64) PRIMARY KEY,
    label VARCHAR(120) NOT NULL,
    description TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    config JSONB NOT NULL DEFAULT '{}'::JSONB,
    "createdAt" TIMESTAMP DEFAULT clock_timestamp(),
    "updatedAt" TIMESTAMP DEFAULT clock_timestamp()
  )`);

  await db.raw(`
    INSERT INTO field_data_quality_rules (key, label, description, active, config)
    VALUES
      ('noLocation', 'No location', 'Flags submissions missing district or latitude.', true, '{}'::JSONB),
      ('noSubmitter', 'No submitter', 'Flags submissions that are not tied to a submitter.', true, '{}'::JSONB),
      ('hasIssues', 'Has issues', 'Flags submissions already marked as having issues.', true, '{}'::JSONB),
      ('rapidSuccession', 'Rapid succession', 'Flags same-submitter submissions too close together.', true, '{"minutes":3}'::JSONB),
      ('possibleDuplicate', 'Possible duplicate', 'Flags same submitter, form, and district submissions within a short window.', true, '{"minutes":10}'::JSONB),
      ('offHours', 'Off-hours', 'Flags submissions sent during low-supervision hours.', true, '{"startHour":0,"endHour":5}'::JSONB),
      ('unusualVolume', 'Unusual volume', 'Flags daily submitter volume much higher than their baseline.', true, '{"minDailyCount":8,"multiplier":2.5,"lookbackDays":45}'::JSONB)
    ON CONFLICT (key) DO NOTHING
  `);
};

const down = async (db) => {
  await db.raw('DROP TABLE IF EXISTS field_data_quality_rules');
};

module.exports = { up, down };
