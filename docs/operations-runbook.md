# Field Data operations runbook

## Ownership and dependencies

| Service | Failure impact | Operator |
| --- | --- | --- |
| GitHub → Cloudflare Worker/container | Deployment, frontend/API availability | Repository/deployment owner; human contact pending |
| PostgreSQL/Supabase | All application data and permissions | Database owner; contact pending |
| Configured object storage | Attachments, layer files, reports and encrypted backups | Storage owner; contact pending |
| Internal compiler/export writer | XLSForm compilation and native downloads | Application operator |
| Cron/backlog workers | Backups, reports, evidence and integration delivery | Application operator |
| Email/integrations | Notifications and downstream delivery | Channel/provider owner; contact pending |

No commercial SLA, staffed response coverage or external alert delivery is
created by the application. Name the humans and channels before offering managed
support. Do not place credentials, encryption keys or recipient secrets here.

## Monitoring and alert response

System → Operations shows five-minute samples; samples older than ten minutes
are stale. Database SELECT, internal compiler health and existing-layer object
reads are read-only. Storage without a probe object is unknown, not healthy.
Authenticated API/static frontend latency is measured from the browser. Successful
compiler health proves process availability, not every possible form compilation.
Email configuration is not proof of delivery. An external HTTPS monitor must
cover the frontend and an authorized synthetic API request from outside the
container; database failure may prevent the local worker recording its sample.

Every deploy also reads System → Operations with its smoke-test session and
waits up to eight minutes for a sample recorded by the newly deployed
container. It warns in the run summary ("Scheduled jobs are not running in the
new container" or "have never run") when none arrives; an older sample does not
count, since the samples table outlives containers. The samples come from
the same five-minute cron job that runs backups, re-verification tasks,
scheduled back-check samples and alerts, so a stale sample means those stopped
too. Each operations run also writes a started/succeeded/failed row, with
the runner's error, to `cron_log` (kept 7 days); the deploy's database report
prints the latest rows. No rows means cron never fires: check that `cron` is
running and that `ODK_ENVBLOCK` was written at start-up. "failed" rows carry
the cause. Cron scripts send output to the container log only where PID 1's
stdout can be reopened; on Cloudflare it cannot, and before this was handled
every cron job failed with exit 1 before starting.

The default policy opens an alert after three consecutive failures, with one
record per alert transition and a recovery after success. Alert history lasts
30 days. Notification delivery is intentionally not wired to outside recipients.
Configure and authorize the delivery channel separately, then exercise it.

P1: service unavailable or suspected loss/disclosure of field data. Contain the
failure, preserve logs/audits, page the named operator and record the incident.
P2: a service is degraded (compiler/storage/backlog), collection remains possible.
P3: isolated nonblocking defects. Establish response/update times with the actual
staffing plan; they remain pending rather than promised.

## Backups, retention and isolated recovery

Database backups are the existing ChaCha20/PBKDF2 encrypted pg_dump format.
Configure FIELD_DATA_BACKUP_PASSPHRASE securely (at least 16 characters), escrow
its recovery copy and database/application encryption-key recovery requirements.
Enable daily scheduling and UTC hour in Operations only after a successful
manual encrypted backup/download/decrypt drill. The default is disabled. The
minute worker processes queued backups; the five-minute operations worker queues
at most one daily job. Default retention is 30 days and always keeps the latest
successful database backup. A backup older than 48 hours alerts by default.

Database dumps contain DB-resident blobs; object storage is a separate backup
boundary. Enable the provider's versioning/retention or controlled replication,
and inventory attachments, evidence, map layers, generated reports and backup
objects. Store object manifests/checksums with the recovery snapshot. Escrow
configuration and secret names plus their secure recovery locations separately;
never put plaintext secret values in Git or log files. A database restore alone
is not complete recovery when objects live outside PostgreSQL.

Run the included fixture drill without touching production:

```sh
python tools/restore-drill.py \
  --container field-data-feature-db \
  --source-database field_data_test \
  --storage-directory /workspace/.field-data-setup/drill-files \
  --report /tmp/field-data-restore-result.json
```

The script only accepts explicitly named local test containers/databases and
fixture directories. It encrypts/decrypts a custom dump, restores to a new randomly
named disposable database, compares all row/file hashes, reports elapsed time and
drops only the database it created. Do not run it alongside tests that rebuild the
source fixture database. The measured fixture RPO is its snapshot without
concurrent writes; RTO was approximately 21 seconds for 87 tables and two files.

For production recovery, first provision a separate isolated database/schema and
storage destination. Download and decrypt the approved backup using Central's
backup tools; verify the archive; restore into the empty isolated destination
with the correct PostgreSQL version. Restore the corresponding object snapshot
and keys/configuration. Compare table counts, checksums and attachment links;
then test login, form retrieval, submission history and a synthetic upload before
any cutover. Record recovery duration and missing changes since the snapshot.
Production RPO/RTO, provider retention and key recovery remain unverified here.
Perform a documented restore drill at least quarterly and after storage/schema
changes; the named operator must own this schedule.

## Deploy, rollback and incidents

Pushes to main run GitHub validation and Cloudflare deployment. Verify the exact
commit's workflow result and public health before declaring deployment complete.
The image includes pinned PyXForm, pandas, PyReadStat and openpyxl dependencies.
The additions use forward migrations; rolling back application code retains
saved views, releases, layers and operations history. Do not undo migrations or
delete fieldwork/audit history to make old code boot. Roll back the Worker/container
to the last verified image after checking schema compatibility.

Compiler/export outage: inspect internal health and compiler logs; restart the
owned process/container, reproduce with a nonsensitive fixture and verify recovery.

XLSForm uploads fail with "Form validation is unavailable ... (Java ...)" (HTTP 502,
Problem 502.4): the file is fine; the runtime cannot run ODK Validate. Check
`GET /readyz` on the internal compiler (also surfaced as `systemStatus.pyxform` on
`/v1/field-data/stats`): `java.available` must be true. Confirm inside the deployed
image with `java -version` and `python verify_runtime.py` (see
`cloudflare/form-compiler/README.md`). The fix is a runtime image that contains
Java, not a configuration switch. Do not set `FORM_COMPILER_SKIP_VALIDATE` in
production: it is honoured only alongside `FORM_COMPILER_PERMIT_SKIP_VALIDATE`,
which production must never set. Liveness (`/healthz`) stays green while Java is
missing, by design, so the container still boots; readiness is what reports it.
Storage outage: check provider status/access before changing keys; preserve queued
jobs; retry an authorized existing object read; verify attachments and layers.
Database outage: check pool/schema/TLS/provider status; do not recreate or migrate
an unavailable database blindly. Queue interruption: inspect job state and the
existing backup/report/evidence recovery workers, then rerun the documented runner.
Rotating credentials: add a valid replacement securely, verify the exact service,
then revoke the old binding; do not print values or invent recovery credentials.

Replaced/deleted layer object keys are queued for cleanup after one hour. Worker
errors preserve queue entries for retry. Failed writes before transaction commit
may require a storage inventory/orphan audit; compare keys to DB references before
removal. Review provider storage/egress/container/database costs monthly, monitor
pool/backlog/capacity, and set provider budgets. Alert recipients, capacity budgets,
24-hour staffing and signed support commitments must be assigned by a human owner.

## Scheduled back-check samples

Configure daily or weekly UTC samples on the form's Verification page. The
existing five-minute operations cron runs them without the browser remaining
open. No extra cron entry or credential is needed. First-period sampling begins
when the schedule is enabled; older submissions need a manual sample.

History shows drawn, empty and failed periods with sample coverage links.
Oversized draws fail without partial writes and advance the period; use a lower
rate or draw that period by hand. Unexpected write failures retain their period
and retry automatically, with a sanitized message in the operations log. Lost
manager permission or a deleted/archived project pauses the schedule; an
authorized manager must re-enable it. Deleted forms are skipped.

Reviewers still request each independent backcheck themselves; scheduled
sampling does not automatically assign App Users.

## Automatic back-check allocation

On a form's Verification page, configure and enable Automatic independent
assignment. Select a response form and instructions, due interval and pending
capacity. Set a collector's override to zero when unavailable. This opts into
claiming open sampled cases for the configuring manager and requesting checks
from independent, authorized App Users through the usual inbox/push workflow.

The existing operations cron runs allocation after sampling every five minutes.
Cases wait unchanged when there is no independent checker or no capacity.
Pending counts include manual requests; manual assignment can override the
automatic limits. Linking or cancelling work frees capacity, but cancelled
cases require manual replacement and are not automatically requested again.
The last-run report shows assigned and waiting counts or a sanitized failure.
Revoked manager permission or unavailable source/response scope pauses the policy.
Correct the settings and re-enable it to resume. Unexpected write failures retry
without partial case claims or requests. Route and calendar capacity planning
remain future work; verify real inbox/push and field response delivery in the pilot.

## Calendar availability and itinerary previews

In Verification → Automatic independent assignment → Availability and route
planning, select a project App User and save weekly UTC backcheck quotas and
dated exceptions. Zero means unavailable. Then enable Respect calendar
availability in the allocation policy. Missing calendars or full dates leave
cases waiting; requested and linked visits consume the daily quota, and
cancelled requests free it. Pending-work capacity limits still apply. Existing
visits keep their dates after calendar edits; overbooking is flagged.

The online and signed offline fieldwork inbox show the planned UTC visit date.
For a manager itinerary preview, choose collector/date and starting coordinates.
Only readable, current and integrity-verified pinned source locations are used.
The first geopoint outside repeats is selected; missing/oversized/unverified
sources and unavailable tasks are counted as exclusions. The preview is limited
to 100 tasks; truncation and unknown or poor GPS accuracy require review.
Download CSV to retain the proposed ordering and its warnings. Distances are
straight-line great-circle distances with a return to start: review roads,
travel time, access and safety separately. Preview/export do not dispatch or
change visits. Road navigation and automatic route dispatch remain pending.
