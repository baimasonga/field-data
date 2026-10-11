// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { sql } = require('slonik');
// A single statement commits task changes and their audits atomically. Hashing
// and mutations are bounded to 100 candidates per batch. No task is dispatched.
const generateReverification = (db, assetId = null) => db.any(sql`
  WITH current_facts AS (
    -- Observations belong to the asset the ownership view names (K4 merges and splits).
    SELECT DISTINCT ON (owner."assetId", o.predicate) o.*, owner."assetId" AS "ownerId", a."formId",
      (s."deletedAt" IS NULL AND sf."deletedAt" IS NULL) AS available
    FROM field_data_asset_observations o
    JOIN field_data_observation_owners owner ON owner."observationId" = o.id
    JOIN field_data_assets a ON a.id = owner."assetId" AND a.status = 'active'
    JOIN projects project ON project.id = a."projectId" AND project."deletedAt" IS NULL
    JOIN forms f ON f.id = a."formId" AND f."deletedAt" IS NULL
    JOIN field_data_claim_versions cv ON cv.id = o."claimVersionId"
    JOIN submission_defs sd ON sd.id = cv."submissionDefId"
    JOIN submissions s ON s.id = sd."submissionId"
    JOIN forms sf ON sf.id = s."formId"
    WHERE o."validFrom" <= clock_timestamp()
      ${assetId == null ? sql`` : sql`AND a.id = ${assetId}`}
    ORDER BY owner."assetId", o.predicate, o."validFrom" DESC, o."recordedAt" DESC, o.sequence DESC
  ), obsolete AS MATERIALIZED (
    SELECT t.id FROM field_data_reverification_tasks t
    JOIN field_data_asset_observations previous ON previous.id = t."observationId"
    JOIN field_data_observation_owners previous_owner ON previous_owner."observationId" = previous.id
    JOIN current_facts current ON current."ownerId" = previous_owner."assetId" AND current.predicate = previous.predicate
    WHERE t.status = 'queued' AND current.id <> previous.id ORDER BY t.id LIMIT 100
  ), superseded AS (
    UPDATE field_data_reverification_tasks t SET status = 'superseded', "supersededAt" = clock_timestamp()
    WHERE t.id IN (SELECT id FROM obsolete) AND t.status = 'queued' RETURNING t.id, t."observationId"
  ), restorable AS MATERIALIZED (
    -- A task superseded earlier whose observation is current again (after an
    -- asset merge or split is undone, K4) goes back to the queue.
    SELECT t.id FROM field_data_reverification_tasks t
    JOIN current_facts current ON current.id = t."observationId"
    WHERE t.status = 'superseded' ORDER BY t.id LIMIT 100
  ), restored AS (
    UPDATE field_data_reverification_tasks t SET status = 'queued', "supersededAt" = NULL
    WHERE t.id IN (SELECT id FROM restorable) AND t.status = 'superseded' RETURNING t.id, t."observationId"
  ), candidates AS MATERIALIZED (
    SELECT c.* FROM current_facts c WHERE c.state = 'known' AND c.available
      AND c."validFrom" + c."validityDays" * interval '24 hours' <= clock_timestamp()
      AND NOT EXISTS (SELECT 1 FROM field_data_reverification_tasks t WHERE t."observationId" = c.id)
    ORDER BY c."validFrom", c.id LIMIT 100
  ), inserted AS (
    INSERT INTO field_data_reverification_tasks ("observationId", "dueAt")
    SELECT c.id, c."validFrom" + c."validityDays" * interval '24 hours' FROM candidates c
    JOIN field_data_claim_versions cv ON cv.id = c."claimVersionId"
    JOIN submission_defs sd ON sd.id = cv."submissionDefId"
    JOIN field_data_submission_provenance p ON p."submissionDefId" = sd.id
    WHERE CASE WHEN octet_length(sd.xml) <= 2097152 THEN p."integrityHash" = c."sourceHash"
      AND p."integrityHash" = encode(sha256(convert_to(sd.xml, 'UTF8')), 'hex') ELSE false END
    ON CONFLICT ("observationId") DO NOTHING RETURNING *
  ), events AS (
    SELECT id, "observationId", 'field_data.asset.reverification' AS action FROM inserted
    UNION ALL SELECT id, "observationId", 'field_data.asset.task.superseded' FROM superseded
    UNION ALL SELECT id, "observationId", 'field_data.asset.task.restored' FROM restored
  ), audited AS (
    INSERT INTO audits (action, "acteeId", details, "loggedAt", processed, failures)
    SELECT e.action, f."acteeId",
      json_build_object('taskId', e.id, 'observationId', e."observationId", 'assetId', owner."assetId"),
      clock_timestamp(), clock_timestamp(), 0
    FROM events e JOIN field_data_observation_owners owner ON owner."observationId" = e."observationId"
    JOIN field_data_assets a ON a.id = owner."assetId" JOIN forms f ON f.id = a."formId" RETURNING id
  ) SELECT * FROM inserted`);
module.exports = { generateReverification };
