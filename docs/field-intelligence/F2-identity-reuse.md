# F2: identity reuse across submissions

Status: draft contract, awaiting decisions (see "Decisions needed").

Second slice of the fraud-intelligence area (row 6 of the delivery ledger:
"similarity/identity-reuse signals"). F1 looks inside one submission. F2 looks
across submissions of one form: the same household, respondent or phone number
appearing more often than the survey design allows, or appearing again with
details that should not have changed. Findings are deterministic, show the
submissions behind them, and go to a reviewer. Nothing is rejected, scored or
attributed to a collector automatically, and no model or fuzzy matching is used.

## Abuse cases and benign lookalikes

| Abuse or error | What it looks like | Benign lookalikes the design must allow for |
| --- | --- | --- |
| One household interviewed twice (double pay, padding the sample) | Same household code in two submissions | Panel or follow-up visits; a submission re-sent after correction where the first was not deleted |
| Invented respondents reusing a real ID | Same ID with a different district, name or head of household | A household that moved; a typo in the ID (two households now share one) |
| Collector filling forms with their own or a friend's phone number | One phone number on many submissions, often by one collector | A shared family or community phone; a phone kept by the chief or a health worker for a village |
| Placeholder values | "0000000", "none", "99" repeated | Respondent refused, or had no phone. These must not become findings |

## Identity keys

A project manager declares, per form, one or more **identity keys**: the
questions whose answer identifies a household, respondent or other unit.

| Part | Purpose |
| --- | --- |
| `title` | Shown to reviewers, e.g. "Household code". |
| `fields` | 1–3 top-level questions whose answers together form the key (e.g. district + household number). Text, number or single-select questions; not repeats, groups, media or locations. |
| `match` | Per field: `exact` (trimmed, case-insensitive, internal spaces collapsed) or `digits` (digits only, for phone numbers and IDs typed with dashes or spaces). |
| `maxUses` | How many submissions may share a key. Default 1. A panel with three rounds in one form would use 3. |
| `windowDays` | Optional. Only submissions within this many days of each other count as sharing a key (for repeated rounds in one form: e.g. 30 means "not twice in the same month"). Measured on the time the submission was received. |
| `sameFields` | 0–10 top-level questions that should not differ when the key repeats (district, head's name, respondent sex). |
| `ignoreValues` | Values that are never identities (placeholders): "0", "000000", "none", "n/a", "99". Compared after normalising. A sensible default list is offered and can be edited. |
| `minLength` | Keys shorter than this after normalising are ignored (default 3), so "1" and "A" never match. |
| `explanation`, `benignExplanations` (at least one), `nextStep` | As in F1, written by the manager and shown with each finding. |
| `active` | Inactive keys are kept, not run. |

At most 20 active keys per form. Conditions, fields and limits are versioned as
in F1: changing `fields`, `match`, `maxUses`, `windowDays`, `sameFields`,
`ignoreValues` or `minLength` creates a new version; changing the texts or
`active` does not. A key whose question was renamed or removed in a later form
version is reported as unusable and not run.

## What a run finds

Rules run inside the existing `POST .../integrity/run`, over the current
version of every non-deleted, non-draft submission, ordered by the time they
were received. For each key, submissions are grouped by normalised key value;
blank, ignored and too-short values are skipped and counted as "no usable key".

1. **`identity-reused`** (outcome `concern`): a group has more than `maxUses`
   submissions (within `windowDays` where set). The earliest `maxUses`
   submissions are taken as expected; every later one gets one finding related
   to the earliest submission in its group, as repeated locations do in G1.
   Evidence: the key value, how many submissions share it, the other
   submissions' IDs, received times and collectors.
2. **`identity-inconsistent`** (outcome `concern`): two submissions share a key
   (whether or not reuse is allowed) but differ on a `sameFields` question.
   Each later submission gets one finding related to the earliest, showing both
   answers for each field that differs. Blank answers on either side are not
   counted as a difference.

Both are stored in `field_data_integrity_flags` with `rule` =
`identity:<keyId>` and the evidence's `kind` = `reused` or `inconsistent`, so
they are resolved, withdrawn and audited exactly like F1 findings:

- Withdrawn when a later run no longer finds them (the duplicate was deleted,
  the ID corrected), keeping the reviewer's status and note; and when the key's
  definition changes ("the rule changed; it is now version N").
- An open finding adds reason code `identity-reused` or `identity-inconsistent`
  to the submission's review case, and holds up acceptance until resolved.
- Reviewers resolve with the existing decisions. `explained` is the expected
  outcome for a shared family phone; a resolved finding stays resolved on later
  runs while the same submissions still match.

Who collected each submission is shown as evidence. F2 does **not** add
collector-level counts, rankings or alerts ("collector X has 12 reused phone
numbers"): that is collector-level triage, planned with calibrated triage later,
and it needs the false-positive evaluation first.

## Who can see and change what

As F1: managers (`project.update`) write keys; reviewers with
`submission.update` read keys, run checks and resolve findings; anyone who can
list and read the form's submissions sees findings (they could already see the
answers in them). Collectors and App Users see nothing; keys are never sent to
a device. Key changes are audited.

## API

`/v1/projects/:projectId/forms/:xmlFormId/identity-keys`: `GET`, `POST`,
`PUT /:keyId` with `If-Match: "key-N"`, `DELETE /:keyId` (deactivates). Same
problem codes and limits pattern as F1 contradiction rules. The run report
gains a per-key summary: examined, no usable key, distinct keys, reused,
inconsistent, unusable.

## Limits and scale

20 active keys per form, 3 fields per key, 10 `sameFields`, 50 `ignoreValues`.
Grouping is in memory per run; at the current run size (all submissions of one
form) this is the same order as F1. A form above 50,000 submissions is reported
as too large for identity checks in this slice rather than run partially.
Encrypted forms cannot be read and are reported as such.

## Not in this slice

- Matching across forms (survey round 1 against round 2 kept as separate forms)
  or across projects. Planned next as F2b, using explicit field mappings like
  the back-check mappings.
- Near matches: similar names, transposed digits, Soundex. Deterministic exact
  matching first; similarity needs labelled data to tune.
- Keys inside repeats (roster member IDs).
- Collector-level aggregation, collusion graphs and scores.
- Hashing or masking key values. Reviewers who see findings can already read
  the submissions; see decision 3.

## Acceptance

Through the real API and a browser flow, with a test form holding a household
code, phone number and district:

- Known-bad: the same household code in two submissions is found once, on the
  later one, related to the earlier; the same code with a different district is
  found as inconsistent with both districts shown.
- Benign lookalikes: (a) placeholder phone "0000000" on ten submissions makes no
  finding; (b) a panel key with `maxUses` 2 makes no finding for two visits and
  one for a third; (c) `windowDays` 30 makes no finding for visits 40 days
  apart; (d) phone numbers typed "076 123 456" and "076-123-456" match under
  `digits` and do not under `exact`; (e) a blank `sameFields` answer is not a
  difference; (f) a shared phone resolved as `explained` stays resolved on the
  next run.
- Deleting the duplicate withdraws the finding with the note kept; editing the
  key's fields creates a new version and withdraws old-version findings.
- Reason codes reach the review case; acceptance waits on open findings.
- A dropped question makes the key unusable and not run; limits and validation
  enforced; paths and values cannot reach SQL.
- Permissions as F1: managers write, reviewers run and resolve, viewers see
  findings not keys, App Users refused, other projects 404.
- Deliberate breakages in normalising, grouping, window, inconsistency and
  withdrawal each fail at least one test.

## Decisions needed

1. **Default when a key repeats**: is a repeated key a finding by default
   (`maxUses` 1, managers raise it for panels), or should managers choose
   per key with no default?
2. **Received time or a form date question for `windowDays`**: received time
   is always present but reflects when the phone synced, not when the visit
   happened. Using the form's `start` or a date question is closer to the
   visit but can be missing or set wrongly on the device.
3. **Key values in stored evidence**: store the key value (e.g. the phone
   number) in the finding so reviewers see it at a glance, or store only the
   submission IDs and show the value by reading the submissions when the
   finding is opened (so a deleted or purged submission's number does not
   remain in the findings table).
