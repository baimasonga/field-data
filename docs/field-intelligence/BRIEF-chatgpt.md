# Brief: ChatGPT / Codex

Two tasks, both parallel to work already in progress. Read
`docs/field-intelligence/P0.1-provenance-envelope.md` and
`FIELD-INTELLIGENCE-PLAN.md` first. The nine skills are installed under
`.claude/skills/`; their `agents/openai.yaml` allows implicit invocation.

Work on your own branch. Open a pull request per task.

---

## Task 1 — P0.1 pure functions

Build exactly two files.

**`central/server/lib/util/provenance.js`**

```js
canonicalHash(xml)          // lowercase hex sha256 over the exact stored bytes
buildEnvelope({ origin, sourceRef, capturedAt, xml, transformVersion })
validateEnvelope(envelope)  // throws, per the error table in the contract
```

The table already exists in the database and the schema in the contract is
authoritative. Match its column names exactly; they are quoted camelCase in
Postgres.

Rules that are not negotiable, because they are the point of the feature:

- `capturedAt` stays null when it is not known. Never substitute the receipt
  time. An invented timestamp is worse than an absent one.
- A `capturedAt` in the future beyond clock skew is accepted and marked
  `degraded.capturedAt = "implausible"`. Do not silently correct it.
- `degraded` records what was unavailable. Absence is not evidence.
- `origin` is a closed vocabulary: `collected`, `imported`, `migrated`, `api`.

**`central/server/test/unit/util/provenance.js`**

Cover every row of the contract's error table, plus: a null `capturedAt`, an
implausible `capturedAt`, a hash over non-ASCII XML, and a hash that is stable
across two calls on the same input.

### Do not

Do not write migrations. Do not wire routes. Do not touch
`central/server/lib/resources/field-data.js`, the submission routes, or
anything under `central/client/`. Those are being changed concurrently and a
conflict there is expensive — that resource file is 2,900 lines.

### Done when

`npx mocha test/unit/util/provenance.js` passes and `npx eslint lib/util/provenance.js test/unit/util/provenance.js` is clean.

**Passing unit tests is not the same as working.** They will be re-verified
through the real routes before merge. On the last review, four defects passed
every unit test and only appeared when the code ran: a route that never
received its upload, a tab rendering a raw translation key, a tab that never
disappeared, and a workflow that could not go green. This is a property of
testing pure functions in isolation, not a criticism — it is why the split is
drawn where it is.

---

## Task 2 — Contracts for P0.2 to P0.5

Draft four contracts in the shape of `P0.1-provenance-envelope.md`. That file
is the template: the decision it improves, what exists today, the design
decision and why, schema, API, an error table, the division of work, and a
done-condition that is not "the table exists".

| File | Package |
| --- | --- |
| `docs/field-intelligence/P0.2-claim-versioning.md` | A Submission version becomes an addressable immutable claim with a version chain |
| `docs/field-intelligence/P0.3-evidence-records.md` | Immutable evidence linked to a claim; originals stored apart from anything derived |
| `docs/field-intelligence/P0.4-idempotency.md` | Stable client identifiers and server-side dedupe on submission, media and action creation |
| `docs/field-intelligence/P0.5-review-surface.md` | A queue showing a claim, its evidence and provenance, with an audited override |

Ground every one in this repository, not in the abstract. Read the real schema
before proposing a change to it: `submissions`, `submission_defs`, `forms`,
`form_defs`, `audits`, `actees`. Say what already exists before saying what to
add — P0.1's "What exists today" table is the model, and it exists because the
envelope must not duplicate columns `submission_defs` already has.

Three constraints that apply to all four:

- **New tables, not columns on core ODK tables.** This is a fork that keeps
  merging upstream. `field_data_*` is the existing convention.
- **Additive migrations.** Backfills state their own assumptions rather than
  presenting them as knowledge.
- **Say who owns which file.** No file may appear in both agents' lists.

For P0.5, also propose the API contract the review UI is built against, since
that UI is likely to be your work and it is cheaper to argue about the shape
now than after either of us has written it.

### Done when

Four files exist, each naming its own open questions rather than smoothing over
them. A contract that hides a decision is worse than one that flags it.
