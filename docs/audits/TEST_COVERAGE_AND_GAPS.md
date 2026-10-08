# Test coverage and acceptance gaps

2026-10-08 UTC. A suite's green gate is evidence only for what it executes. SOURCE_INVENTORY.json lists test-tree files including fixtures/helpers; it is not a coverage percentage.

## Executed during this audit

| Command / location | Result | What it establishes |
| --- | --- | --- |
| `node --test tests/*.test.*` at repository root | 53 passed, zero failed | Lazy registration, navigation preservation, cron allowlist, external monitoring/error redaction plus new actual-shell deployment and AST inventory cases |
| `node --test test/field-data-hardening.test.js test/field-data/hardening.cjs test/field-data/native-webforms.cjs` in server with isolated storage | 75 passed, zero failed | Storage stream failures, SSRF/delivery, organization/delegation/permission rules, registration/schema scans, native links and two new CSV cases |
| `NODE_CONFIG_ENV=test BCRYPT=insecure FIELD_DATA_STORAGE_DIR=<temporary-dir> mocha --recursive test/unit` in server | 1,594 passed; one pending | Existing parsing/export/rule/utility regressions; not a real database integration test |
| ESLint of `lib/resources/field-data-workspaces.js` | Passed | Changed backend source lint |
| `python -m unittest -v test_app.py test_data_exports.py` in compiler | Blocked locally: Flask and pyreadstat imports unavailable | No local compiler pass claimed; dependency-ready CI evidence below is distinct |
| `git diff --check` | Passed | Patch whitespace integrity, not behavior |

The deployment shell was executed against disposable curl/jq/sleep doubles: temporary 503 recovery; exhausted retries; HTTP 200 with unhealthy forms; unrelated API failure despite recovery; actual aggregate diagnostic JavaScript with a fixture pg client. Before the fix, recovery reproduced a false failure. CSV reproduction invoked the actual endpoint with authorized synthetic data and observed an unescaped formula; the repaired endpoint passed malicious text, normal quotes, dates, negative coordinates and denied-read checks.

## Exact baseline CI evidence

Baseline feature head `aa78441d53d56503773d8d2323b408d8a8eb20a1`: [Full stability 37826278270](https://github.com/baimasonga/field-data/actions/runs/37826278270) and [Field Data 37826278499](https://github.com/baimasonga/field-data/actions/runs/37826278499) passed. Merged-main [37826825203](https://github.com/baimasonga/field-data/actions/runs/37826825203) passed all non-skipped jobs.

- PostgreSQL claim/evidence/review/back-check and collection-smoke tests ran in a disposable database. Feature APIs use a real internal compiler/writer where configured.
- Fresh migration checks ran in public and field_data. They do not establish arbitrary historical upgrade or production restore correctness.
- Form compiler/native-writer and simple/advanced/extension XLSForm round trips passed CI. SAV has an independent minimal acceptance reader, not a general SPSS product certification.
- Production frontend build passed. Fixture browser suite: **36 passed**. Actual backend-browser/Android runs are separate from this configuration.
- Karma client suite: **58 failed, 3,246 successful** under ceiling 61. This is a tolerated existing failure set, not a clean pass. Counting alone can miss replacing an old failure with a new one. Individual failure reconciliation remains FD-P1-006.
- Whole upstream backend integration is a dispatch-only report job and not a passing PR gate; required upstream service setup remains a gap. Two legacy frontend lint files are excluded.
- live-smoke workflow is skipped unless explicitly dispatched. Its code includes authenticated media round-trip and optional encrypted backup/download checks; their presence is not execution evidence.

## Required acceptance by area

| Area | Existing executable owner | Outstanding acceptance |
| --- | --- | --- |
| Authentication/permissions | Session, organization, hardening and API tests; deployment login | Full ASVS review, rate-limit behavior, custom-role and organization case/source isolation |
| Form lifecycle | Compiler/roundtrip/builder APIs; collection smoke; service-backed Web Forms specs | Live simple/complex preview/fill/edit/publish/version/export with representative media and translations |
| Android/offline sync | OpenRosa collection test and existing submission/attachment/edit tests | Physical Collect version matrix, offline drafts/reboot, airplane mode, interrupted multipart upload, byte/hash checks and duplicate-safe replay |
| Review/back-checks | Claim/evidence/idempotency/review/back-check PostgreSQL tests and browser fixtures | Actual Collect second-collector response and cancellation/replacement pilot; immutable evidence review after edits |
| GIS/census | Map-layer/remote-map/analysis tests and district UI | Authoritative boundary provenance, hierarchy/EA design, topology/border/accuracy rules, offline reference package and census denominators |
| Institutional reporting | Analysis/sharing/organizations/export/DHIS2 resources/tests | Organization dashboard selections, custom indicator definitions, real Power BI/DHIS2/Google receiver authentication and refresh |
| Deployment/recovery | Startup workflow, root smoke regressions, migration CI, fixture recovery tools | Exact audit-merge live gate, actual worker freshness, successful encrypted snapshot and isolated restore/relink/hash report |

## Extension policy

Every future package must state user behavior, existing owner, compatibility constraints, permission/data boundaries, exact test commands/results, CI head and merged deployment evidence. Required gates must pass before dependent work starts. Never count fixture browser tests as external-service/physical-device acceptance. Preserve original UI flows and immutable submission/review history while fixing the tolerated failures.
