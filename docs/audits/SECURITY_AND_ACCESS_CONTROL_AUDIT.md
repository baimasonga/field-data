# Security and access-control audit

FD-P0-06; 2026-10-08 UTC. Scope is source review, executed tests and read-only provider metadata, not a complete ASVS/MASVS certification or penetration test. No production credentials or person-level records were read into these artifacts.

Reference framework: [OWASP ASVS](https://owasp.org/projects/asvs) for web/API controls and [OWASP MASVS](https://mas.owasp.org/MASVS/) for Android storage/auth/network/platform/privacy acceptance. Requirement numbers must be pinned to the selected standard version before a formal control-by-control assessment. ASVS source identifies 5.0.0; this document maps control areas without inventing requirement IDs.

| Control area | Existing owner and evidence | Finding / next acceptance |
| --- | --- | --- |
| Authentication and sessions | `resources/sessions.js`, `http/sessions.js`, preprocessors; session unit/integration tests; live administrator login | Server sessions, CSRF and secure/httpOnly/sameSite cookies retained. Logout/session cleanup runs in deployment. Account lock/rate-limit/expiry/revocation scenarios need full live/staging checks |
| Project/form/source authorization | Central actees/roles; analysis/sharing/export handlers; hardening tests | Both submission.list/read are checked on many cross-project paths; filtered delegation is explicit and source revocation preserved. Cases/legacy assignments have global project.create gate and source-link gaps (FD-P1-005) |
| Organization permissions | Existing organization actee/owner/member logic and tests | Owner/manager boundaries, last-owner and role-grant limits covered. Institution-wide case/assignment scope is not complete; do not expose global cases as tenant-isolated |
| Public sharing | Public catalog allowlists, preview hash and confirmation; revocation API tests | Keep immutable approved snapshots and private defaults. No publication of operational data occurred during audit |
| Database isolation | Private field_data schema; zero public Field Data tables; anon/authenticated schema USAGE false; no SECURITY DEFINER functions | RLS disabled on backend-only application tables. Exposed-schema/provider grants require separate audit before Data API access; 41 mutable-search_path function warnings remain |
| Webhooks/remote GIS | `safe-webhook-url.js`, worker delivery, remote-map proxy and hardening tests | DNS revalidation/pinned addresses, private IPv4/IPv6 rejection, no redirects, encrypted credentials and bounded delivery. Actual receiver/provider acceptance remains unverified |
| Upload/XML/XLSForm boundaries | Existing type/size/ZIP/field/reference validation, storage-generated keys and permission tests | Preserve bounds and escaping. Full parser/media attack matrix and realistic device attachment acceptance not completed |
| Spreadsheet exports | Existing analysis/filtered export protections | Explorer path omitted formula neutralization. Reproduced and fixed by reusing existing helper; two meaningful regression cases pass |
| Secrets and logging | Environment-only server bindings, encrypted webhook credentials, deployment-error redaction test | Workflow accounts/raw error responses exposed identities. Patch switches to aggregates/status-only logs. Runtime bootstrap/task logs and historical logs need separate review; no blanket remediation claim |
| Recovery confidentiality/integrity | Existing encrypted bundles, manifest/table/file digests, bounded restore verifier | Zero recorded successful production backup; full restored database/object acceptance and key custody unverified. Do not treat confidentiality as proof of recoverability |
| Mobile controls | Collect is a separate Android application, not maintained in this repository | Validate local storage, device security, session termination, TLS, sensitive UI/logging and offline restart/sync on actual supported binaries. Server tests do not certify MASVS |

Security advisor output was inspected: **41 application functions with mutable search_path**, all warnings; zero SECURITY DEFINER functions. [Remediation guidance](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable). Changes require schema replay/trigger tests; no DDL was applied during audit.

The production bucket is private. This alone does not establish all Storage policy/key privileges or guarantee that every attachment access path is correctly authorized. Reuse the existing server storage adapters and per-source permission checks. Never put S3 keys, passwords or backend privileged credentials into client configuration.

Priority sequence: complete audited workflow/CSV fixes and deployment; prove recovery/worker execution; harden case/source/actor boundaries; reconcile the client failure set; then finish formal ASVS/MASVS and actual external/device acceptance. Anomaly findings remain human-review indicators, never automatic evidence of misconduct.
