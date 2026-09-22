# Field Intelligence Suite: review and delivery plan

Review of the nine-skill suite, what it means for this repository, and how the
work divides between two agents working at the same time.

## 1. What the suite is

Nine skills. One coordinator (`build-field-intelligence-platform`) and eight
specialists. The coordinator replaces `form -> submit -> dashboard` with:

    collect -> prove -> cross-check -> score -> investigate -> act -> reverify

It is good work, and not the usual prompt scaffolding. Three things make it
worth taking seriously:

- **The contracts are executable, not diagrams.** The sync protocol names the
  operation envelope, the manifest, idempotency, backpressure and the metrics
  to emit. The evidence contract names provenance fields. These can be built
  against.
- **It refuses opaque scoring.** Every score keeps components, reason codes,
  missing-data markers and a policy version, and a human can override with a
  reason. That is the difference between decision support and an accusation
  machine.
- **Its sequencing rule is correct**, and stated plainly: *never begin with
  frontier AI while evidence provenance, synchronization, permissions and
  review controls are missing.*

## 2. What this repository has today

Measured, not assumed.

| Suite concept | Here today |
| --- | --- |
| Versioned **claim** | No. A submission is a form answer. |
| Immutable **evidence** records | No. |
| Verification results, confidence, reason codes | No. |
| Review queue with override + audit | No. |
| Provenance envelope | Partial. `audits` records actions; submissions carry submitter, device, user agent. |
| Idempotent sync | Partial. ODK's instance IDs dedupe submissions; nothing like the operation envelope. |
| Offline capture | Yes, via ODK Collect. Progressive sync, relays, courier mode: no. |
| Geospatial | A sliver: `GeoExtracts`, the cross-project map. |
| Action layer | A sliver: webhooks, Google Sheets, DHIS2. |
| Adaptive surveys, multimodal AI, passports, twins | No. |

So the platform's foundation — sections 1 and 2 of the coordinator's own
sequencing — does not exist yet. Everything glamorous in the suite sits on top
of it.

**The evidence for taking that seriously is already in this repo.** The CSV
import merged today writes Submissions that are indistinguishable from
collected ones everywhere except the audit log. That is precisely the gap the
suite's evidence envelope closes, found independently before reading it.

## 3. What not to do

Do not start nine workstreams. Do not start with the AI skills. The suite says
so itself, and this repo has 60 failing client specs and an Enketo path with no
test coverage here; adding a fraud-scoring engine on that base would produce
confident output nobody should trust.

## 4. Phase 0 — the only phase worth starting now

One vertical slice, and it is the foundation every other skill depends on.

**Outcome:** a submission becomes a versioned claim carrying an evidence
envelope, and a reviewer can see where every value came from.

Five work packages:

- **P0.1 Provenance envelope.** Origin (`collected` | `imported` | `migrated`),
  source reference, capture vs receipt time, transformation version, integrity
  hash. Additive migration. Backfill existing rows as `collected`.
- **P0.2 Claim versioning.** A submission version becomes an addressable,
  immutable claim record with a stable identifier and a version chain.
- **P0.3 Evidence records.** Immutable rows linked to a claim, storing original
  evidence separately from anything derived. Media attachments are the first
  kind.
- **P0.4 Idempotency keys.** Stable client identifiers and server-side dedupe on
  submission, media and action creation, per the sync contract.
- **P0.5 Review surface.** A queue showing a claim, its evidence, its
  provenance, and an override with a reason that is itself audited.

P0.1 alone closes the import provenance gap and is worth doing this week.

## 5. How two agents work on this at once

### The split that matters

Not by feature. **By whether the work can be verified without running the
system.** Today's evidence, from reviewing PR #17:

- ChatGPT produced substantial, well-structured code with unit tests: a DHIS2
  target, CSV import, dataset exports.
- Four defects in it were invisible from source and only appeared by running
  the code: the import never received its upload at all; the tab rendered a raw
  translation key; the tab never disappeared; the CI workflow could not pass.
- Its unit tests passed throughout, because they called the pure functions
  directly and never went through a route.

That is not a criticism of the model. It is a description of a tooling
asymmetry, and the split should follow it.

### Assignments

**ChatGPT / Codex — generation where the contract is fixed and the unit is pure**

- Draft migrations and schema DDL from the contracts (reviewed before applying).
- Pure functions: envelope construction, hashing, canonical serialisation,
  reason-code evaluation, score component maths.
- Unit tests for those functions.
- Client components against an API contract agreed in writing first.
- Spec and contract documents; translating suite references into repo-specific
  ADRs.

**Claude — anything that needs a running system, plus integration**

- Applying migrations to a real Postgres and proving them reversible.
- Route wiring and the request path (where today's defects lived).
- Integration and end-to-end tests; the client suite; CI gates.
- Reviewing and verifying every piece before merge; owning deploys.

### Rules that make concurrency safe

1. **Agree the contract in writing before either agent codes.** A shared file
   per package: schema, API shape, error cases. Most merge pain is two agents
   inventing different contracts.
2. **Partition by file, not by feature.** Two agents editing
   `lib/resources/field-data.js` at once will conflict; that file is already
   2,900 lines. Split new work into new modules.
3. **One branch per work package, never shared.**
4. **Nothing reaches `main` unverified.** The gates exist now and run in ~3
   minutes; a package is done when they pass and an integration test exercises
   the real route.
5. **A feature is not complete because the UI renders.** The coordinator's
   completion gate says this, and this repo has three merged examples proving
   it.

### Honest cost

Concurrency is not free. Review and verification land on one agent, so
throughput is bounded by that, not by generation. Two packages in flight is
probably the useful maximum; more will queue behind verification anyway.

## 6. Suggested first two weeks

| | ChatGPT | Claude |
| --- | --- | --- |
| Now | P0.1 migration draft + envelope unit tests | P0.1 contract, then apply, integration-test, wire the import path |
| Next | P0.3 evidence model draft | P0.2 claim versioning against a real database |
| Then | P0.5 review UI against the agreed contract | P0.4 idempotency + the review route |

Do not schedule Phase 1 until a reviewer can open one claim and see where every
value came from.

## 7. Installing the skills

The suite ships `agents/openai.yaml` for ChatGPT, Codex, API and Atlas, with
implicit invocation allowed. For this repo, install the skills under
`.claude/skills/` so both agents route from the same specifications rather than
from two different readings of them.
