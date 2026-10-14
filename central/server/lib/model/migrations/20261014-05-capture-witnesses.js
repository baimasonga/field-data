// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const up = async db => db.raw(`CREATE TABLE IF NOT EXISTS field_data_capture_witnesses (
 id UUID PRIMARY KEY, "challengeId" UUID NOT NULL REFERENCES field_data_capture_challenges(id) ON DELETE CASCADE,
 "witnessId" INTEGER REFERENCES actors(id) ON DELETE SET NULL, "witnessName" TEXT NOT NULL,
 "requestId" UUID NOT NULL, "requestHash" TEXT NOT NULL, payload TEXT NOT NULL CHECK (length(payload) <= 12000),
 "publicKey" JSONB NOT NULL, signature TEXT NOT NULL, "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE ("challengeId", "witnessId"), UNIQUE ("challengeId", "requestId")
);`);
const down = async db => db.raw(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM field_data_capture_witnesses) THEN DROP TABLE field_data_capture_witnesses; END IF; END $$`);
module.exports = { up, down };
