# Field Data production audit package

Baseline main: `ce91bb870bbb22a1a44467e4f6ca4cfce9215d02`. Date: 2026-10-08 UTC.

The master proposal substantially overlaps existing functionality. This package inventories the current implementation, distinguishes automated/live/device evidence, fixes two reproduced defects and reduces workflow logging exposure. It adds no product framework, database migration, duplicate feature module or UI redesign.

## Documents

- [Feature and overlap matrix](FEATURE_AUDIT_MATRIX.md): proposed Phase 3–5 capabilities and their existing owners/gaps.
- [Production reliability](PRODUCTION_RELIABILITY_AUDIT.md): infrastructure, deployment and worker/recovery acceptance.
- [Migration and backup verification](MIGRATION_AND_BACKUP_VERIFICATION.md): actual schema metadata and safe replay/restore plan.
- [Test coverage and gaps](TEST_COVERAGE_AND_GAPS.md): commands executed, exact baseline CI and outstanding acceptance.
- [Defect register](DEFECT_REGISTER.md): prioritized findings and closure criteria.
- [Form and offline acceptance](FORM_AND_OFFLINE_ACCEPTANCE.md): lifecycle evidence and physical-device checklist.
- [Security and access control](SECURITY_AND_ACCESS_CONTROL_AUDIT.md): source/test/provider observations against ASVS/MASVS control areas.
- [Source inventory](SOURCE_INVENTORY.md) and [machine-readable inventory](SOURCE_INVENTORY.json): all tracked module, route declaration, migration and test-tree paths in scope.

## Files and behavior changed

| File | Change |
| --- | --- |
| `.github/workflows/deploy-field-data.yml` | Retryable Web Forms readiness does not permanently fail the deployment; other failures remain blocking. Account diagnostics use aggregate/status-only logging |
| `.github/workflows/field-data-validation.yml` | Execute new deployment/privacy and inventory regression tests in dependency-ready jobs |
| `central/server/lib/resources/field-data-workspaces.js` | Reuse existing CSV neutralization for explorer exports; ordinary values/API fields stay compatible |
| `central/server/test/field-data/hardening.cjs` | Test formula-capable metadata, negative coordinates/dates/quotes and absent source read permission |
| `tests/deployment-critical-path.test.cjs` | Execute actual workflow shell/diagnostic script against isolated doubles; cover recovery/exhaustion/unhealthy/independent error cases |
| `tools/audit-inventory.cjs`, `tests/audit-inventory.test.cjs` | Read-only AST inventory with explicit dynamic declarations, collision detection and no credential values; uses existing locked client parser |
| `docs/audits/` | Source-backed reports and baseline inventory |

No migrations added/changed. No production database/policy mutations, destructive restore tests, real public-data release, collector messaging or credential changes were performed.

## Acceptance and delivery

Local: 53 root tests pass; hardening 75/75; backend unit 1,594 pass/one pending; changed resource lint and diff whitespace pass. Compiler execution was dependency-blocked locally; exact baseline CI passed its compiler and real feature-API/roundtrip jobs. Browser baseline is 36 passing fixtures; client baseline is 58 existing failures under ceiling 61. Audit-head CI, PR merge and exact deployment must be checked separately; baseline evidence is not a test result for uncommitted changes.

Required GitHub delivery is a short-lived PR on main with exact-head gates; commit/PR/deployment links belong in its delivery report and PR discussion. Merge only after relevant checks pass. Preserve the redesigned UI and current Central workflows.

The next package is existing production recovery/operations activation and proof, then scoped legacy case/assignment integrity. No major new census/institution package should proceed while their release-readiness gaps remain open.

Regenerate the source snapshot after intentional repository changes with `node tools/audit-inventory.cjs > docs/audits/SOURCE_INVENTORY.json` after installing existing client dependencies. Keep the audit's baseline commit/date explicit; inventory counts are never acceptance claims.
