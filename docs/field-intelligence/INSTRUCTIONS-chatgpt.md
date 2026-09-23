# Instructions for ChatGPT

Paste-ready. Everything below the rule is the message; nothing above it needs
to be sent.

**Send this only once PR #23 is merged.** Until then `main` carries an earlier
version of `BRIEF-chatgpt.md` that asks for
`central/server/lib/util/provenance.js`, which now already exists. Pointing
ChatGPT at `main` before that merge makes it duplicate finished work.

---

You are working on `baimasonga/field-data` alongside another agent (Claude).
Read these on `main` before starting:

- `docs/field-intelligence/BRIEF-chatgpt.md` — your task in full
- `docs/field-intelligence/P0.1-provenance-envelope.md` — the template to follow
- `FIELD-INTELLIGENCE-PLAN.md` — why the work is split this way

The nine Field Intelligence skills are installed under `.claude/skills/`.

## Your task: draft four contracts

| File to create | Package |
| --- | --- |
| `docs/field-intelligence/P0.2-claim-versioning.md` | A Submission version becomes an addressable immutable claim with a version chain |
| `docs/field-intelligence/P0.3-evidence-records.md` | Immutable evidence linked to a claim; originals stored apart from anything derived |
| `docs/field-intelligence/P0.4-idempotency.md` | Stable client identifiers and server-side dedupe on submission, media and action creation |
| `docs/field-intelligence/P0.5-review-surface.md` | A queue showing a claim, its evidence and provenance, with an audited override |

Follow P0.1's shape exactly: the decision it improves, what exists today, the
design decision **and why**, schema, API, an error table, division of work, and
a done-condition that is not "the table exists".

Ground every one in this repository, not in the abstract. Read the real schema
before proposing changes to it — `submissions`, `submission_defs`, `forms`,
`form_defs`, `audits`, `actees`. Say what already exists before saying what to
add; P0.1 carries a "What exists today" table for exactly this reason, because
the envelope must not duplicate columns `submission_defs` already has.

## Constraints on all four

- New `field_data_*` tables, never columns on core ODK tables. This is a fork
  that keeps merging upstream, and a column on a core table turns every future
  upstream migration into a conflict.
- Additive migrations. Backfills state their own assumptions rather than
  presenting them as knowledge.
- Name who owns which file. No file may appear in both agents' lists.

## What is already built

P0.1 is done: the `field_data_submission_provenance` table, its backfill,
`central/server/lib/util/provenance.js`, and the CSV import write path. The
origin vocabulary is `collected | imported | migrated | api`; the policy version
is `p0.1`. Build on it rather than restating it.

For P0.5, also propose the API contract the review UI is built against. That UI
is likely to be your work, and its shape is cheaper to argue about now than
after either of us has written it.

## Do not touch

`central/server/lib/resources/field-data.js`, `central/server/lib/util/provenance.js`,
the submission routes, or anything under `central/client/`. Those are changing
concurrently and a conflict there is expensive.

## Done when

Four files exist, each naming its own open questions rather than smoothing over
them. A contract that hides a decision is worse than one that flags it.

Work on your own branch. Open one pull request.

---

## Why this is the only task

Splitting P0.1's *code* between two agents was tried and undone twice: the
write path calls `buildEnvelope`, so assigning that function to one agent and
its callers to the other made the package sequential while the plan called it
concurrent. Contracts are genuinely independent work. Code inside one small
package is not.
