# F1: deterministic answer contradictions

Status: contract for review. No code yet.

First slice of the fraud-intelligence area (row 6 of the delivery ledger:
"deterministic contradictions"). A project manager writes, per form, rules
saying which combinations of answers should not occur together. A run checks
every current submission and records each match as a finding a reviewer
inspects. Nothing here rejects a submission, marks a collector, scores anyone or
uses a model.

## Why, when forms already have constraints

XLSForm constraints run on the device while the form is filled. They miss:

- **Cross-question conflicts the form author did not encode**, for example
  "no electricity" with "owns a fridge".
- **Roster totals**: the number of adults listed in a household roster against
  the adult count asked earlier. Constraints see one answer at a time.
- **Data that never passed through the form**: CSV imports, API submissions
  and edits after submission.
- **Rules learned after collection began**, which can then be checked against
  data already received.

## Rules

A rule belongs to one form and has:

| Part | Purpose |
| --- | --- |
| `title` | Short name shown to reviewers, e.g. "Adults in roster ≠ adult count". |
| `conditions` | 1–10 conditions, **all** of which hold for a contradiction. There is no OR: write a second rule. Each rule then says exactly which answers conflict. |
| `explanation` | What the conflict means, in plain words. |
| `benignExplanations` | **Required, at least one.** Ordinary reasons the answers could both be true. A rule author who cannot name one should reconsider the rule. |
| `nextStep` | What a reviewer should do, e.g. "Ask the collector to recount the roster." |
| `active` | Inactive rules are kept but not run. |

### Conditions

Each condition compares a **field** of the current published form with either a
**fixed value** or **another field**:

    { "field": "/electricity", "op": "=", "value": "none" }
    { "field": "/adult_count", "op": "<>", "otherField": "/roster_adults" }

Operators: `=`, `<>`, `>`, `<`, `>=`, `<=`, `selected` and `notSelected` (for
select-multiple answers), `empty`, `notEmpty`.

- Fields are resolved against the form definition, by path. Comparisons are
  numeric for `int` and `decimal` fields, and text otherwise. `selected` is only
  allowed on select-multiple fields.
- **Repeat groups** (such as a household roster) cannot be compared member by
  member in F1. They can be counted:

      { "count": { "repeat": "/member", "where": [{ "field": "/member/member_age", "op": ">=", "value": "18" }] },
        "op": "<>", "otherField": "/adult_count" }

  `where` takes the same conditions, on fields inside that repeat. An empty
  `where` counts every entry.
- **Missing or unreadable answers**: if any condition cannot be evaluated (blank
  optional answer, text in a number field), the rule does not match. The run
  counts these by rule ("could not evaluate"), so a rule that rarely applies is
  visible, but no finding is created.

### Versions and changes to the form

- Editing a rule's conditions creates a new version. Findings keep the version
  they were found under, so older findings stay readable as what they were.
  Editing only the title, texts or `active` does not.
- If a later form version renames or drops a field a rule uses, the rule is
  **reported as unusable and not run**. It is never run with the condition
  silently dropped, because a rule missing a condition matches far more than
  intended.

## Findings

Recorded in the existing integrity framework (`field_data_integrity_flags`),
alongside the travel and location rules:

- `rule` = `contradiction:<ruleId>`, `ruleVersion` = the rule's version,
  outcome `concern`.
- Evidence shows the actual answers behind each condition, e.g. "Electricity:
  none · Assets: tv, phone", plus the explanation, benign explanations and next
  step written by the rule author.
- Reviewers resolve findings with the existing decisions (`explained`,
  `data-error`, `unresolved`, `substantiated`, the last requiring a written
  reason).
- **Withdrawn** applies as for location findings: when a later run no longer
  matches (for example after the submission was corrected), the finding is
  withdrawn, keeping the reviewer's status and note, and stops holding up
  review.
- An open contradiction adds reason code `answer-contradiction` to the
  submission's review case.

## Who can see and change what

- **Write rules:** project managers (`project.update`).
- **Read rules, run them, resolve findings:** reviewers who can change
  submissions on the form (`submission.update`). This is the same permission the
  existing checks use.
- **Findings** are readable, as all integrity findings are today, by anyone who
  can list and read the form's submissions (viewers included). A finding shows
  the answers it rests on, which those readers can already see, and the rule's
  explanation. The rule's full condition list is visible only with
  `submission.update`.
- **Collectors and App Users** cannot see rules or findings. The rule logic is
  never sent to a collection device. This follows the guidance that detection
  logic must not reach the people being checked.
- Rule changes are audited.

## API

Under `/v1/projects/:projectId/forms/:xmlFormId/contradiction-rules`:

- `GET` the form's rules with their current version and status (`ok` or
  `unusable` with the missing fields).
- `POST` to create a rule. `PUT /:ruleId` to change it, with `If-Match` on the
  rule revision. `DELETE /:ruleId` deactivates it; history is kept.
- Rules run through the existing `POST .../integrity/run`, which gains a
  per-rule summary: matched, could not evaluate, unusable.

## Limits

At most 50 active rules per form and 10 conditions per rule. Rules run over the
current version of every non-deleted, non-draft submission, as the existing
checks do. Encrypted forms cannot be read, so rules do not run on them, and the
run says so.

## Worked examples (from the housing survey test form)

Contradictions worth encoding:

1. **Roster adults ≠ adult count:** count of `member` with `member_age >= 18`
   `<>` `adult_count`.
2. **Not exactly one household head:** count of `member` with
   `member_relation = head` `<>` 1.
3. **Good condition but unstable:** `building_condition = good` and `hazards`
   `selected` `unstable`.
4. **No electricity, mains appliance:** `electricity = none` and `assets`
   `selected` `fridge`. Benign explanations: the fridge is owned but not in
   use; it is powered from a neighbour's supply.

A combination that **should not** be a rule: `shocks` selected `flood` and
`hazards` selected `none`. A flood in the last 12 months and no hazard today are
both true when the damage was repaired. Rules should encode answers that cannot
both be true, not answers that are merely unusual together.

## Not in this slice

Comparing repeat members one by one (e.g. a child older than the head);
cross-submission checks such as the same household code with a different
district (planned as F2, identity-reuse signals); similarity, collusion graphs
and any model or score; shipped rule presets.

## Acceptance

Through the real API and a browser flow:

- Known-bad: a roster/adult-count mismatch is found, with both answers shown.
- Benign lookalikes: (a) an optional answer left blank is counted as "could not
  evaluate", not a finding; (b) a combination that is legitimately possible
  (the flood/no-hazard case) is not flagged because no rule encodes it, and a
  rule whose benign explanation applies is resolved as `explained`.
- Each operator, numeric versus text comparison, select-multiple, field versus
  field, repeat counts with and without `where`.
- Editing conditions creates a new version and keeps older findings; editing the
  title does not.
- A form version that drops a field makes the rule unusable and not run.
- Corrected submission withdraws the finding; reviewer's note kept.
- Reason code reaches the review case; acceptance waits on unresolved findings,
  as for other checks.
- Permissions: managers write; reviewers run and resolve; viewers see findings
  but not rule definitions; App Users get 403/404; other projects 404.
- Paths and values cannot inject into queries; limits enforced.
- A reviewer can order a back-check from the submission's review case (which
  carries the `answer-contradiction` reason) through the existing back-check
  flow, and resolving the finding does not change the submission.
