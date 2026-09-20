---
name: rest-service-targets
description: Extend Field Data's webhooks into typed integration targets — Google Sheets, DHIS2, TextIt, raw JSON or XML — the way Ona's REST services work. Use this whenever someone wants submissions to flow automatically into another system, asks to sync a form to a Google Sheet, push data to DHIS2 or an aggregator, trigger an SMS flow on submission, or asks for "REST service", "integration", "connector", "send my data to X", or per-form rather than site-wide webhooks. Read it before adding a second webhook type, because the existing table is site-wide and untyped and that is the thing to fix first.
---

# Typed REST service targets

Field Data already posts submissions to a URL. `field_data_webhooks` has a
name, a URL, an events list, a signing secret and a deliveries log. What it
does not have is a *type*: every target is assumed to be an endpoint that
will accept the JSON we happen to send.

That assumption breaks the moment somebody wants a Google Sheet — which
needs a sheet title, an OAuth grant, and a decision about backfilling
existing rows — or DHIS2, which needs its own payload shape. Ona solved this
with one registry and a named target per row. Copy that.

Read `.claude/skills/ona-parity/references/house-style.md` for wiring and the REST services
table in `.claude/skills/ona-parity/references/feature-inventory.md` for the required fields
per target.

## Fix the scope before adding types

The existing table has **no `formId`**: webhooks are site-wide. Ona's are
per-form, which is what people actually want — "sync *this* survey to *that*
sheet", not "send everything everywhere".

Do this migration first, on its own, before any new target exists:

```sql
ALTER TABLE field_data_webhooks ADD COLUMN IF NOT EXISTS "formId" INTEGER REFERENCES forms(id);
ALTER TABLE field_data_webhooks ADD COLUMN IF NOT EXISTS target TEXT NOT NULL DEFAULT 'json';
ALTER TABLE field_data_webhooks ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}';
```

A null `formId` keeps meaning "every form", so existing rows keep working and
nobody's integration breaks on deploy. Say that in the migration comment —
the next person will wonder whether null was an oversight.

## One dispatcher, one interface per target

Put targets in `central/server/lib/util/rest-targets/`, one file each,
exporting the same small interface:

```js
module.exports = {
  name: 'google-sheets',
  // Required config keys, and what each is for. Used for validation and to
  // build the form, so the two can never disagree.
  configSchema: { ... },
  // Given a submission and the stored config, produce the outbound request
  // or throw a Problem the operator can act on.
  buildRequest: (submission, config) => ({ method, url, headers, body })
};
```

The dispatcher looks up the target by name, validates config against the
schema, and posts. Keeping `buildRequest` pure — no network, no database —
is what makes each target unit-testable without credentials, which is the
difference between targets that get tested and targets that get hoped about.

## What each target actually needs

| Target | Config | The part that bites |
|---|---|---|
| `json` / `xml` | `url` | already built; keep the HMAC signature |
| `google-sheets` | `sheetTitle`, `sendExisting`, `syncUpdates` | OAuth: a stored refresh token that expires, and a backfill that can be enormous |
| `dhis2` | `url`, credentials, dataset mapping | field mapping is a whole feature; do not pretend it is config |
| `textit` | `authToken`, `flowUuid`, `contacts`, `url` | sends messages to real people — see below |

Build `json`/`xml` and one real target. Building all five as a demonstration
of the abstraction produces four integrations nobody has tested against a
live system.

## Credentials

These targets hold secrets — OAuth refresh tokens, API keys — where the
existing webhook only held a signing secret it generated itself.

- Never return a stored credential from a read endpoint. Return a hint, the
  way `field_data_dashboards` stores `tokenHint` beside `tokenSha`.
- Support rotation from day one; there is already
  `/field-data/webhooks/:id/rotate-secret` to follow.
- An expired OAuth token is a normal condition, not an error to swallow.
  Mark the service as needing reauthorisation, stop retrying, and show that
  in the UI. A sync that silently stopped three weeks ago is worse than one
  that visibly broke.

## Delivery, retries and the one genuinely dangerous target

The deliveries log already exists. Keep using it, and keep it honest: record
the attempt, the status and the response, including failures.

Retry with backoff, and cap it. An endpoint that 500s on every submission
must not generate unbounded retries against somebody else's server.

**TextIt sends SMS to real people.** A retry storm there is not a log line;
it is a hundred messages to a respondent and a bill. Make delivery idempotent
per submission, cap retries hard, and require an explicit confirmation when a
service is configured with `sendExisting` — backfilling a messaging target
across an existing form is exactly the mistake that only gets noticed
afterwards.

## Verifying

Unit-test each target's `buildRequest` against a recorded submission —
no network needed, which is the point of the interface. Test that the
migration leaves existing rows working with `target = 'json'` and a null
`formId`. Test that read endpoints never return a credential. Then say which
targets have been exercised against a real external system and which have
only been tested against fixtures; for integrations that distinction is the
whole truth.
