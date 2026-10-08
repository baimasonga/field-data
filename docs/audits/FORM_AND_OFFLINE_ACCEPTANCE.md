# Form lifecycle and offline collection acceptance

FD-P0-04 / FD-P0-05; 2026-10-08 UTC; baseline `ce91bb870bbb22a1a44467e4f6ca4cfce9215d02`.

Existing Central/XLSForm/Collect workflows are the implementation owners. Do not add a second compiler, mobile sync queue, submission store or form publishing route.

## Current evidence

| Lifecycle stage | Existing implementation / executable check | Result and remaining acceptance |
| --- | --- | --- |
| Create/import | Basic/advanced builder and `builder-import.js`; API extension fixtures | Baseline CI passes actual authorized import/validation. Unsupported constructs retain original upload/edit path |
| Compile | `cloudflare/form-compiler/app.py`; `test_app.py`; PyXForm 4.5.0 | Dependency-ready CI passes; local invocation blocked by missing Flask/pyreadstat, not recorded as an application regression |
| Simple/complex round trip | `test/xlsform/roundtrip.js`, `advanced-roundtrip.js`, `extensions-roundtrip.js` | CI executes real PyXForm and Central parser; covers builder definitions, repeats, references and entity extensions. Not a Collect render/capture certificate |
| Preview/publish/version | Central forms/draft/version resources and existing integration/browser tests | Source present; scoped create/publish used by collection smoke. Full native service-backed browser flow is outside fixture-only gate |
| Android download | OpenRosa formList, manifest, XML/attachments endpoints | Published collection smoke checks actual listing and XML download in disposable PostgreSQL |
| Offline capture/sync | Collect-owned device storage and standard server multipart protocol | No physical Android device or Collect source/binary is available in this workspace. Physical restart/interrupted sync/media acceptance unverified |
| Review/back-check | Claim/evidence/review/back-check resources; API and fixture browser suites | Revision, permission, idempotency and cancellation/replacement checks pass; actual two-collector offline pilot outstanding |
| Export | Briefcase/analysis/native writers and queued jobs; unit/API/writer checks | Automated repeat joins, missing values, field boundaries and formats verified within fixtures. External consumers/device data still require acceptance |

Existing executable protocol tests include `test/integration/api/submissions.js` (identical attachments, duplicate/edited-instance behavior), `forms/list.js`, `forms/versions.js`, `forms/draft.js` and `field-data-collection-smoke.js`. Run them against a dedicated disposable database with required compiler/Web Forms services configured; the whole upstream suite is currently report-only. Their existence is not reported as a new execution result in this audit.

## Device acceptance checklist

Use a disposable project and synthetic records. Record Collect version, Android version, device model, form/version hash and test timestamps; never include account credentials or respondent details in the report.

1. Simple fixture: text, integer, required field, select-one and metadata instance ID. Complex fixture: nested repeats, conditions/calculations, translations, entity lookup, image/audio, geopoint with accuracy and audit/start/end data where supported.
2. Download published form and attachments while online; verify form/version and files. Enter airplane mode, fill partially, save draft, force-close/restart device, reopen and confirm values/attachments intact.
3. Finish two distinct submissions offline. Re-enable intermittent connectivity and interrupt a multipart upload between XML/media parts. Resume repeatedly. Verify one logical submission per instance ID, expected versions and attachment byte/hash matches; never interpret a retry as a duplicate respondent.
4. Exercise edits/version updates according to Central/Collect protocol. Confirm original submission definitions, claim/evidence history and provenance remain intact; stale or unauthorized changes cannot overwrite them.
5. Record no fix, low accuracy, changed device time and repeated coordinates. Findings must explain missing/unreliable evidence rather than assert presence, speed or fraud without support.
6. Assign reviewer, request second-collector back-check, capture/sync/link the result, inspect both collectors' provenance, record a decision and immutable snapshot. Cancel an unlinked request, retain its reason, issue replacement to another eligible collector; cancelled requests cannot accept results.
7. Verify authorized export contents/relationships and denied-source behavior. Record failures individually. Mark device acceptance passed only after this checklist actually runs.

## Compatibility gate

Before adding geography packages or duration/identity rules: keep OpenRosa URLs/content types, attachment manifests, form versions and instance/edit semantics unchanged; add regression fixtures to existing suites. Geography must be bounded reference data, not a proprietary replacement form format. Duration must derive from available capture evidence, not server receipt spacing. Offline cancellation does not erase already downloaded device forms and must not be presented as notification delivery.
