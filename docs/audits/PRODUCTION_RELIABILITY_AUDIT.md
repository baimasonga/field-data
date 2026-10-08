# Production reliability audit

2026-10-08 UTC. Source baseline: `ce91bb870bbb22a1a44467e4f6ca4cfce9215d02`. Findings distinguish source inspection, executed tests, read-only production metadata and production HTTP evidence. This is not a blanket production-readiness sign-off.

## Runtime and deployed commit

The existing stack remains a Cloudflare Worker/container, nginx, Central Node backend, native Web Forms frontend, internal Python compiler, external PostgreSQL and object storage. Both `Dockerfile` and `cloudflare/Dockerfile` were inspected. `wrangler.jsonc` selects the root Dockerfile. The separate Cloudflare Dockerfile is a maintenance surface and must not silently diverge.

Node is 24.16.0 in image/workflows; Python is 3.12, PyXForm 4.5.0 and native format writers are pinned in compiler requirements. The image checks compiler imports/health at build. Secret bindings are passed server-side; production forces object storage and application search_path. A small database pool reduces provider session pressure. The Worker uses a build ID to retire an existing container when a deployed image changes; otherwise the scheduled keepalive could keep an old image running indefinitely.

Deployment [37826825111](https://github.com/baimasonga/field-data/actions/runs/37826825111), attached to baseline main, successfully built/installed the image and passed database connectivity, HTTP liveness, management/form routing and administrator authentication. Critical-path current user, project/form lists and cross-project forms/submissions/map answered 200. Dashboard initially returned three temporary startup 503 responses, then 200 with `.systemStatus.enketo=true`. The workflow still failed due to FD-P1-001's sticky failure flag. It therefore provides successful individual observations, **not** a passed deployment gate. The audit patch must itself be deployed and checked before closing that finding.

## Reliability findings

| Area | Observed condition | Evidence / remaining gate |
| --- | --- | --- |
| Worker/container cold start | Boot wait bounded for the caller; startup returns parseable 503/Retry-After; crash/proxy failures reset boot state | `cloudflare/worker.js`; live startup responses observed. Load, concurrent retirement and outage chaos acceptance not performed |
| nginx routing | Management and forms use different SPA documents; historical Enketo redirects reach bundled forms | nginx source and live URL route gate passed. Full fill/edit/offline lifecycle is a separate gate |
| Container initialization | Required bindings validated; cron environment location has no-/dev/shm fallback; CA passed to Node; migrations run before backend listens | Entry/start scripts, cron regression and historical startup workflow. No Docker executable available for a new local image drill |
| Health | `/healthz` proves nginx/container liveness only; backend is deliberately not ready yet during boot | Do not equate this endpoint's 200 with database/compiler/form readiness. Live authenticated dashboard performed separate checks |
| PostgreSQL | Production version 17.6, application schema present, 90 application tables, 261 completed migrations and idle migration lock | Read-only metadata; latest cancellation migration and four columns present. Compatibility with exact source migration names is recorded in migration document |
| Isolation | No Field Data tables found in public; anon/authenticated lack application schema USAGE; private bucket | Read-only catalog/storage metadata. Data API exposed-schema configuration was not returned; owner/provider access audit remains outstanding |
| Object storage | Existing SigV4 Supabase adapter, HTTPS, fail-closed object mode, producer failure/abort propagation | 75 hardening passes. Bucket privacy verified. No new authenticated upload/download byte round-trip performed during this audit; previous stats 200 alone does not prove this |
| Scheduled operations | Cron source includes backup, Sheets, XLS reports, evidence, operations and exports | Production operations-check table is empty; actual cron/worker execution is unverified. Diagnose before relying on schedules |
| Backup/recovery | Existing encrypted database/complete recovery bundles and isolated verifier | Production successful backup count is zero and schedule disabled. Major production-readiness gap; provider backups not inferred absent from this application ledger |
| Monitoring/alerts | Operations policy/events/alert worker and external-monitor workflow already implemented | No recorded production check rows. External workflow requires base URL/secrets and alert destination; notification configuration/receipt unverified |
| Deployment logging | Existing diagnostics could reveal account identities and raw responses | Audit patch uses aggregates/status-only messages. Runtime bootstrap/task logging remains a recorded follow-up; no real identity is copied into these reports |

## Release acceptance for this package

1. Unit/hardening/root regressions and relevant lint pass; migration/compiler/frontend/PostgreSQL CI checks pass on the exact PR head.
2. Baseline false-negative reproduced; recovery passes while exhausted readiness, unhealthy 200 and independent API failures remain blocking.
3. Explorer export prefixes expression-capable text while preserving numeric coordinates, ordinary text and denied-source behavior.
4. Merge through a short-lived PR without bypassing protections. Verify the exact merged deployment's live checks; do not infer success from PR CI.
5. Keep FD-P1-004/005/006 and physical/provider acceptance open. This patch does not certify recovery, institutional isolation or Android fieldwork.

## Next operational package

Diagnose why cron/operations has no records; verify freshness and an alert/recovery transition using the existing pipeline. Create and download a complete encrypted fixture or authorized snapshot and restore only into disposable destinations; prove table/file digests, object relinking, key recovery, retention and elapsed recovery. Keep provider/source databases intact. Document separate provider-managed backup coverage and the actual operator/RPO/RTO. No new monitoring, backup or scheduler subsystem is needed.

Current provider documentation reviewed: [Supabase changelog](https://supabase.com/changelog), [custom schemas](https://supabase.com/docs/guides/api/using-custom-schemas), [17.11 compatibility notice](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes). A version/extension review is needed before provider maintenance; no upgrade was attempted.
