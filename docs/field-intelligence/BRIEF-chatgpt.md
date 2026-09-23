# Brief: ChatGPT / Codex

Two tasks, both parallel to work already in progress. Read
`docs/field-intelligence/P0.1-provenance-envelope.md` and
`FIELD-INTELLIGENCE-PLAN.md` first. The nine skills are installed under
`.claude/skills/`; their `agents/openai.yaml` allows implicit invocation.

Work on your own branch. Open a pull request per task.

---

## Task 1 — withdrawn

P0.1 is being done end-to-end by the other agent, including the pure functions
first assigned here.

The reason is worth recording, because it is a lesson about the split rather
than about either agent. P0.1's write paths call `buildEnvelope`, so assigning
that function to one agent and the paths that call it to the other made the
package sequential: one side waiting on the other's handoff while the plan
called it concurrent. The same mistake had already been made once in this
package with the migration and corrected.

**A package this small should not be divided.** The real parallelism is two
packages in flight, not two agents inside one. Task 2 is that parallel work:
it shares no file with P0.1.

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
