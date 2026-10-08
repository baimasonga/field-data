# Migration and backup verification

2026-10-08 UTC; baseline main `ce91bb870bbb22a1a44467e4f6ca4cfce9215d02`. No schema or data modification was executed against production. Read-only metadata results are summarized here without credentials, records or object keys.

## Migrations and schema integrity

| Check | Result | Evidence boundary |
| --- | --- | --- |
| Source migration inventory | 261 JS migration entries; 20 companion SQL files | SOURCE_INVENTORY.json; file counts are not database replay results |
| Fresh disposable replay | Both public and field_data jobs passed for baseline main | [Run 37826825203](https://github.com/baimasonga/field-data/actions/runs/37826825203); `test/field-data-migration-check.js` |
| Replay isolation | Script checks current_schema, backup table schema, hash_text placement and no public tables in private-schema run | This does not prove every historical upgrade/rollback path |
| Production ledger | 261 completed entries; latest `20261008-01-add-backcheck-cancellation.js`; migration lock not held | Read-only query of application Knex ledger, not Supabase CLI migration history |
| Cancellation compatibility | All four added columns present | Existing metadata/constraint migration retains legacy cancelled rows; down preserves cancellation history rather than dropping it |
| Referential/check constraints | 140 foreign keys, 63 check constraints, zero unvalidated constraints | Live catalog counts only; not a row-by-row orphan audit of all relationships |
| Duplicate prevention | Pending back-check partial unique index present | API replay/cancellation tests run in disposable PostgreSQL; upstream duplicate-instance and edit semantics still require full service/device acceptance |
| Transaction behavior | Review assignment/decisions/back-checks use case locks, revisions and idempotent operations; tests pass | Exact PR #41 PostgreSQL gate, not a production fault-injection run |
| Legacy case assignment integrity | Actor FK absent | Confirmed in migration source and production constraint catalog; FD-P1-005 requires compatible cleanup/backfill/constraint planning |

`lib/model/knex-migrator.js` refuses migration when current_schema differs from FIELD_DATA_DB_SCHEMA. Deployment entrypoint explicitly selects field_data,extensions,public. Keep Central's Knex ledger as the authoritative application migration history; do not introduce a parallel Supabase migration mechanism for the same tables. Future changes must be additive, with historical upgrade fixtures and a documented compatibility/backfill plan.

## Access and function hardening

Production has 90 application tables, no Field Data tables in public, no anon/authenticated USAGE on field_data and zero SECURITY DEFINER functions. None of these tables has RLS enabled. The present authorization boundary is the Central server role/actee system over a private schema. This finding does not authorize exposing the schema or replacing its permissions with a second identity system.

Security advisors report 41 mutable-search_path functions. Fix through reviewed migrations with trigger/hash compatibility tests; do not edit production functions during the audit. [Advisor remediation](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable). Data API exposed-schema setting remains unverified; any future exposure requires a separate privilege/RLS design.

## Backup evidence and missing proof

Production application ledger: zero successful backups, no successful completion timestamp, scheduledBackups=false, completeBackups absent (normalizes false). The object bucket exists and is private. This does **not** establish whether provider-managed database backups exist; those are separate infrastructure controls.

Already implemented: `lib/worker/field-data-backups.js`, schema-specific lock, existing encrypted database dump path, `lib/util/recovery-bundle.js`, operations retention/last-good preservation, `tools/restore-drill.py`, `tools/verify-recovery-bundle.py`, `docs/operations-runbook.md`. Backup abort/source rejection tests passed locally. The runbook describes a prior 87-table/two-file fixture drill; its elapsed time is historical documentation, not a re-executed result or a production RTO claim.

No Docker or PostgreSQL client is available locally in this session, so a new restore drill was not executed. Local compiler tests initially could not import Flask/pyreadstat; baseline CI supplies these dependencies and passed. No production database was restored, rolled back, truncated or reseeded.

## Executable acceptance plan

1. Use a clearly named disposable database/container and separate fixture object destination; seed simple/complex forms, repeats, entities, original/edited submissions, media, claims/evidence/review/cancellation and operations records.
2. Replay from empty and from a pre-extension ledger, then replay again and compare ledger/schema. Check all relevant source FKs, unique constraints and rollback history retention. Both public/private schema paths must be covered.
3. Use existing complete recovery bundle generation. Decrypt with an ephemeral fixture key outside command arguments/logs; validate manifest bounds, table fingerprints, attachment digests and object bytes.
4. Run `tools/verify-recovery-bundle.py --bundle <fixture-bundle> --container field-data-drill-<suffix> --report <fixture-report>` with its required key provided securely by environment. It creates a disposable restore database; never point destructive tests at production.
5. Relink into isolated object destinations and open restored form/media/submission/review/export references. Record measured local elapsed time and concurrent-write limitations.
6. Only after successful recovery acceptance, activate production cadence/retention/key custody through the existing policy. Verify fresh Success timestamps, expected schedule executions and alerts on a stale/failed backup. Keep provider-native recovery proof separate.

## Package database changes

This audit package adds **no database migration** and performs **no production policy mutation**. Existing published forms and submissions are untouched. New census/institution schema proposals are deferred until scope and recovery gates pass.
