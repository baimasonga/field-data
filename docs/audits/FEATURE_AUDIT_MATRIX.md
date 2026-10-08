# Field Data feature audit and duplication assessment

Audit date: 2026-10-08 UTC. Baseline: `ce91bb870bbb22a1a44467e4f6ca4cfce9215d02` (main after PRs #40 and #41).

The proposed master instructions are a useful audit and extension programme, not a list of wholly new features. Preserve Central, the redesigned Vue UI, current published forms, original submissions and existing permission checks. Extend the owners below instead of creating parallel implementations.

## Evidence and status rules

- **Verified working** means the named checks actually executed successfully within the stated scope. It does not imply a physical-device pilot or complete production acceptance.
- **Partially working** means implemented behavior exists, but a required capability or acceptance gate is missing.
- **Broken** means a source-backed defect was reproduced or an operational acceptance condition failed.
- **Unverified** means code or a plan exists without adequate execution evidence for the requested use.
- **Not implemented** means no dedicated implementation was found in the audited source. Existing generic primitives may still support it.

Evidence: local audit run (53 root tests; 75 hardening tests; 1,594 backend unit passes and one pending); exact PR #41 checks [Full stability](https://github.com/baimasonga/field-data/actions/runs/37826278270) and [Field Data validation](https://github.com/baimasonga/field-data/actions/runs/37826278499); merged-main [validation](https://github.com/baimasonga/field-data/actions/runs/37826825203). CI browser tests use fixtures; API tests use disposable PostgreSQL and an actual compiler where configured. Production metadata was read-only; no production forms, submissions, keys, users or policies were modified by this audit.

## Repository inventory

[SOURCE_INVENTORY.json](SOURCE_INVENTORY.json) lists 1,456 source-module files, 33 resource registrations, 303 backend route declarations, 75 client path declarations, 281 migration files (261 JavaScript migration entries), 948 test-tree files including fixtures/helpers, workflow files and directly referenced environment names. [SOURCE_INVENTORY.md](SOURCE_INVENTORY.md) makes route declarations searchable. Counts describe the baseline, not executed test counts. Dynamic routes (41 declarations), conditionals and nested client routes are explicitly identified; no claim is made that static inventory enumerates every runtime expansion.

The apparent duplicate `POST /users` is a mutually exclusive OIDC/password branch. No static Field Data route collision was found. Existing hardening tests also register the core/workspace resources together and reject duplicate route registrations.

## Existing platform foundations

Paths in this table are relative to the repository root. Backend resource shorthand `resources/` means `central/server/lib/resources/`; client component shorthand means `central/client/apps/central/src/components/`.

| Capability | Status / evidence scope | Existing owner and tests | Dependencies, defect or missing acceptance | Decision |
| --- | --- | --- | --- | --- |
| Central projects, forms, App Users, roles and submissions | Verified working: unit and scoped PostgreSQL/collection checks | `resources/projects.js`, `forms.js`, `app-users.js`, `submissions.js`, `assignments.js`; `test/integration/api/field-data-collection-smoke.js` | PostgreSQL; broad upstream integration suite is not a passing release gate | Reuse; do not replace APIs |
| Native browser forms and legacy URL compatibility | Partially working: build, health, link provisioning and scripted routes verified | `central/client/apps/forms/`, `lib/external/enketo.js`, `lib/util/web-forms-health.js`, `cloudflare/nginx.conf`; `test/field-data/native-webforms.cjs`, browser suites | Full live fill/edit/offline/restart acceptance remains outstanding | Reuse bundled Web Forms; no second renderer |
| Advanced builder, import, validation, preview and publishing | Verified working: compiler/API/round-trip scope | `lib/util/advanced-form-builder.js`, `builder-import.js`, `xlsform-builder.js`; builder components; `test/xlsform/`, `field-data-extensions.js` | PyXForm 4.5.0; unsupported constructs retain original XLSForm upload path; device multilingual/media pilot outstanding | Extend existing schemaVersion 2 builder |
| Android/OpenRosa form download and upload | Partially working: server protocol checks pass | `resources/forms.js`, `datasets.js`, `submissions.js`; collection smoke and existing submission API tests | Physical Collect drafts, restart and interrupted media sync unverified; Collect Android source is not in this repo | Keep ODK-compatible protocol |
| Beneficiary/site cases and visits | Partially working | `resources/field-data-workspaces.js`, `components/field-data/cases.vue`, `case-detail.vue`; `20260710-01-add-case-management.js` | Global `project.create` gate, no project/organization ownership column, timeline lacks source-form checks; actor FK missing on case assignments (FD-P1-005) | Scope and harden existing cases before census extension |
| Field assignments | Partially working | Same resource; `components/field-data/assignments.vue`; case-management migration | Existing actor/case/form fields and statuses; geographic assignments and institution scoping absent | Extend these records, not a separate assignment engine |
| Central entity datasets and longitudinal records | Unverified for census use | `resources/entities.js`, `datasets.js`, `lib/model/query/entities.js`; existing entity integration/unit tests | Entity protocols and conflicts exist; household/establishment schema and pilot acceptance not established | Assess Entity reuse alongside cases |
| Media, filtered/merged datasets, dashboards, widgets and sharing | Verified working: scoped unit/API checks | `resources/field-data.js`; `test/field-data/hardening.cjs`, analysis/extension tests | Explicit delegation and source checks must remain; anonymous publication requires approved allowlists | Reuse existing access boundaries |
| Explorer CSV | Broken at baseline; fixed and regression-tested in audit package | `resources/field-data-workspaces.js`; two added hardening cases | Collected metadata could become spreadsheet expressions; existing `_csvSafe` helper is reused (FD-P1-003) | Repair existing serializer |
| Cloudflare startup, routing and build retirement | Partially working | `cloudflare/worker.js`, `entrypoint.sh`, nginx, both Dockerfiles, wrangler; startup/root tests | `/healthz` is nginx liveness, not backend readiness; deployment false-negative reproduced (FD-P1-001) | Repair verification; preserve architecture |
| Supabase/PostgreSQL application isolation | Verified working: read-only metadata and CI replay scope | `lib/model/knex-migrator.js`, entrypoint; schema migration check | Production: private application schema, 261 ledger entries, zero unvalidated constraints; full historical upgrade/restore still unverified | Keep Knex and private schema |
| Encrypted backups, recovery bundles and monitoring | Partially working; production acceptance broken | `lib/worker/field-data-backups.js`, `field-data-operations.js`, `lib/util/recovery-bundle.js`, `tools/restore-drill.py`, `verify-recovery-bundle.py`; operations tests | Production has zero successful recorded backups, disabled schedule and no operations checks (FD-P1-004); provider restore outstanding | Activate and prove existing mechanisms before new features |

## Phase 3 proposals: verification and quality

| Proposal | Status | Existing owner / evidence | Increment needed without duplication |
| --- | --- | --- | --- |
| Explainable GPS travel anomalies | Verified working: unit logic; production investigator flow unverified | `lib/util/fieldwork-integrity.js`, form integrity routes in `resources/field-data.js`; `test/unit/util/fieldwork-integrity.js`; verification component | Reuse versioned findings, accuracy allowances, capture-time evidence, alternatives and human decisions. Add field-pilot acceptance and policy configuration only if needed |
| Survey duration checks | Not implemented as capture-based interview duration | Quality rules in `field-data-workspaces.js` implement **server receipt** rapid succession and off-hours | Add an audit/start/end-derived duration rule to existing integrity findings. Never treat receipt spacing as interview duration; missing clock evidence must be inconclusive |
| Duplicate respondent identification | Partially working | `possibleDuplicate` quality rule checks same collector/form/district within a receipt window | Add explicit respondent identity definitions and bounded matching within authorized scope; this is different from protocol duplicate-instance prevention |
| Missing/unreliable GPS evidence | Partially working | `noLocation`, `parseGeopoint`, travel inconclusive outcomes and provenance | Reuse existing evidence; add explicit standalone accuracy/missing-location coverage if required. Do not invent coordinates or equate a fix with presence |
| Response-pattern analysis | Not implemented as an explainable response-pattern rule | Analysis distributions and quality-rule infrastructure exist | Add versioned straight-lining/repeated-answer indicators with respondent context and alternatives; no automatic fraud verdict |
| Enumerator performance monitoring | Partially working | `/field-data/team`, `components/field-data/team.vue`; authorized submission counts/approval rates | Add capture-based duration and investigation outcomes to the same team surface after rule acceptance; existing receipt counts are not productivity proof |
| Supervisor investigation | Partially working | Form integrity flags and unified claim review queue; evidence/claim/review resources and tests | Connect existing findings to existing cases/evidence; do not create a third review queue. Keep core submission review state distinct from claim decisions |
| Offline back-checks | Partially working | `resources/field-data-backchecks.js`, review queue component; PostgreSQL and browser request/link/cancel/replacement tests | Existing request uses another collector's same-form submission after sync. Actual Collect pilot, collector notification and specialized form workflow remain outstanding |
| Evidence-based approval/rejection | Verified working: transactional API/browser scope | `field-data-claims.js`, `field-data-evidence.js`, `field-data-reviews.js`; corresponding API tests | Preserve immutable versions, evidence snapshots, assignment/revision/idempotency checks; no automatic adverse decision |

## Phase 4 proposals: GIS and census

| Proposal | Status | Existing overlap | Safe implementation direction |
| --- | --- | --- | --- |
| Configurable geographic hierarchies | Not implemented as a relational, country-neutral hierarchy | District text, project map layers, geometry fields | Add versioned hierarchical geography definitions linked to current project/case/assignment owners; no replacement GIS stack |
| Sierra Leone presets | Partially working | `central/client/apps/central/src/assets/sl-districts.json`, explorer/report district maps | Validate provenance, license, boundary vintage and naming before adopting as authoritative; district polygons alone are not a full administrative preset |
| Enumeration areas | Not implemented | GeoJSON/remote map layers and polygon rendering | Extend reference geography with EA identity, parentage and lifecycle, reusing map layers |
| Household/establishment listing | Partially working | Household case type, generic entity datasets | Extend existing cases/entities after scoping; add listing identifiers, establishment type/schema and uniqueness policy |
| Geographic assignments | Partially working | Existing case assignments; district metadata | Link existing assignments to authorized EA/geography records; keep existing case/form associations |
| Offline geographic reference data | Not implemented as managed, versioned delivery | Collect form attachments and uploaded GeoJSON exist | Produce bounded authorized form/reference packages through existing download/manifest protocol; device acceptance required |
| Coverage monitoring | Partially working | District submission counts, analysis maps and team summaries | Add EA/household denominators and explicit assigned/completed/revisit counts to existing dashboards; raw counts are not coverage rates |
| Census revisits/supervision | Partially working | Case timelines, assignments, review/back-check workflow | Extend existing case visit/assignment state transitions with append-only review history |
| Geographic quality checks | Partially working | Coordinate validation, travel rule, GPS missing/accuracy evidence | Add country/EA boundary, assignment and topology checks to existing versioned findings; border/accuracy uncertainty must be explicit |

## Phase 5 proposals: institutional analytics

| Proposal | Status | Existing overlap / owner | Increment needed |
| --- | --- | --- | --- |
| Organization dashboards | Partially working | Organizations/actees, project dashboards/widgets and program overview in `field-data.js` | Organization filter and authorized roll-ups; reuse current dashboard renderer |
| Cross-project reporting | Verified working: authorized API scope | `/field-data/report`, explorer/team summaries, form/submission/map listing and merged datasets | Add institution selections through existing per-source permission checks |
| Custom indicators | Partially working | Widgets and analysis count/sum/mean/median aggregations | Versioned numerator/denominator definitions, units and disaggregation; no second expression engine |
| Secure exports | Verified working: writer/API scope | Analysis exports and queued jobs; CSV/XLSX/SAV/DTA/KML writers, repeat tables and manifests | Keep permission rechecks, field allowlists, limits and independent readers; fix explorer path separately |
| Scheduled reports | Partially working | XLS report templates/runs, report worker and cron | Clarify requested cadence/delivery requirements; reuse the report/job pipeline, not a new scheduler |
| Controlled sharing | Verified working: scoped API tests | Filtered delegation, shared views, token reports and explicitly approved public catalog snapshots | Extend policy/organization governance while retaining source revocation and public-release confirmation |
| Power BI compatibility | Partially working | Existing `resources/odata.js`, `odata-entities.js`, CSV exports | Test actual connector authentication, refresh, repeat relationships and scoped access before adding anything. No dedicated Power BI connector found |
| DHIS2 | Partially working | Existing saved mapping/export screen, `lib/util/rest-targets/dhis2.js`, webhook target and integration tests | Real authenticated receiver acceptance and institution-specific mappings; do not build a duplicate integration |
| Institutional users/permissions | Partially working | Organizations, owner role, Central actees/roles/assignments, organization tests | Finish project/case/assignment institution scoping and lifecycle; no second identity system |

## Flags and dependencies

Client defaults: `showsAnalytics=false` controls upstream usage-reporting navigation, **not** Field Data's analysis workspace; `oidcEnabled=false`, `showsFeedbackButton=false`, `devTools=false`, `sentryDsn=null`. Optional OIDC and email are runtime configuration. Alerts default off. Scheduled/complete backups are persisted operations-policy settings, not new implementations. Production storage is explicitly object mode; missing credentials must not silently select ephemeral storage. Schema selection must match `FIELD_DATA_DB_SCHEMA` before migration. Names (not values) appear in the inventory; credentials must never be copied into audit artifacts.

## Next package and gates

First finish this reliability package and prove deployment. Then address **FD-P1-004: production recovery and worker execution**, followed by **FD-P1-005: scoped case/assignment integrity**, then the remaining client failures and live form/device acceptance. Major census/institution extensions stay blocked while these release-readiness gaps are open. Once foundations pass, add capture-derived duration/identity findings to the existing integrity/review owners, followed by geography/EA models and institutional indicator definitions. Each extension needs scoped authorization tests, compatibility fixtures and recorded device/provider acceptance where relevant.
