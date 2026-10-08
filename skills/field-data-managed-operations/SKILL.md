---
name: field-data-managed-operations
description: Implement Field Data monitoring, alerting, backup/restore verification, incident runbooks and service-support readiness on Cloudflare/GitHub/Supabase. Use for operational reliability and managed-support implementation.
---

# Field Data managed operations

## Inspect first

- `cloudflare/README.md`, `cloudflare/entrypoint.sh`, `wrangler.jsonc`, `Dockerfile`
- `.github/workflows/deploy-field-data.yml` and `container-startup.yml`
- `central/server/lib/worker/field-data-backups.js`, storage/database adapters.
- The currently configured GitHub production environment and service providers.

Cloudflare hosting, health checks, backups and deployment smoke tests already
exist. Commercial staffing, contracts and service guarantees cannot be supplied
by code alone. State this distinction in operational deliverables.

## Implementation

1. Inventory database, object storage, Worker/container, form compiler, email,
   integrations and scheduled tasks. Record ownership and failure dependencies
   without copying secrets into documentation, logs or tracked configuration.
2. Define measurable availability, latency and recovery objectives. Add metrics
   and synthetic read-only checks that distinguish frontend, authenticated API,
   database, storage and compiler failures. Bound probes and avoid exhausting
   database-pool slots or treating configured email as proof of successful mail.
3. Add actionable alert rules, deduplication and recovery signals. Prepare alert
   configuration first. Sending Slack/email or other messages requires existing
   explicit authorization; configuring a channel is not permission to message it.
4. Verify scheduled backups include database, attachments, relevant configuration
   and encryption-key recovery requirements. Encrypt and expire backups with
   documented access. Restore into an isolated disposable environment and compare
   record/file counts and integrity checks. Never test restoration over production.
5. Document deploy/rollback, credential rotation, queue recovery, outage diagnosis,
   storage failure and restore procedures. Preserve audit and fieldwork history
   when rolling back application code; do not invent destructive migration steps.
6. Produce a support runbook with severity definitions, contacts, response process
   and escalation coverage. Mark unassigned staffing and unsigned SLAs as pending.
7. Define retention, capacity/cost monitoring, periodic restore drills and how
   responsibility is transferred to a human operator.

## Acceptance

Exercise a controlled local/staging failure and restoration; verify detection,
recovery and data integrity. Document the tested RPO/RTO and the actual environment
rather than promising objectives that were never measured. Confirm deploy smoke
checks without printing login tokens. External alert delivery, production drills,
provider access, staffing and commercial commitments require their own evidence.

## Working rules

Read `../field-data-implementation/references/engineering.md` before implementation.
Use the current checkout as the source of truth; this skill describes a target,
not proof that the target is absent. Inspect existing code and tests first.
Complete a working vertical slice, run the relevant checks, and report concrete
behavior, validation, and remaining acceptance work. Honor the user's existing
scope and deployment authorization; do not introduce additional approval gates.
