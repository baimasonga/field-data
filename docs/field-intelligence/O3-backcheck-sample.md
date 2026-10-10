# O3: random backcheck sample

Status: contract decided 2026-10-10 under the project owner's delegated
authority (the owner was away and asked for the work to continue). The
decisions below can be revisited.

Backchecks today start from a review case a reviewer already has: a finding,
degraded provenance or a manager's rule. Submissions that raise no flag are
never revisited, so a careful fabricator is never checked. Survey practice
answers this with a random backcheck sample: a share of every collector's
work, chosen by chance, revisited by someone else. O3 draws that sample,
reproducibly, and routes it into the existing review and backcheck workflow.
It is the "independent backcheck allocation" and "sampling coverage"
deliverables of the operations row, first slice.

## What it does

- A manager draws a sample for a form on its Verification page: a rate
  (1 to 100 percent of each collector's submissions), a minimum per collector
  (0 to 20, default 1) and an optional received-date range.
- **Eligible**: current, non-draft, non-deleted submissions of the form,
  received in the range, with a claim version, and not already in an earlier
  sample of the form (those are counted as "sampled before" and skipped, so
  successive samples do not pick the same submission twice).
- **Strata**: one per submitter (App User or web user). For a stratum of
  `n` eligible submissions, `min(n, max(minimum, ceil(rate × n / 100)))` are
  taken, so a collector with few submissions still gets the minimum.
- **Chance, reproducibly**: each submission's draw order is
  `sha256(seed + ":" + instanceId)`, lowest first. The seed is 32 random
  hex characters chosen by the server and stored with the sample; with the
  seed and the stored list of eligible submissions, anyone can recompute the
  draw and check that nothing was chosen by hand. The order does not depend
  on submission order, collector or answers.
- **Routing**: each sampled submission's claim version gets the reason code
  `backcheck-sample` on its review case (a new open case if it has none; the
  code is added to an open or in-review case). A case already decided is not
  reopened: the item is recorded as "already decided", shown in the sample,
  and a reviewer can reconsider it through the existing reconsideration path.
- **Independence** is the existing backcheck rule: the reviewer requests the
  backcheck from an App User other than the submission's original collector
  (the request route already refuses the original collector).
- **Coverage**: each sample shows, per collector, eligible and sampled counts,
  and how many sampled submissions have a backcheck requested and linked.
- A sample is a record of what was drawn and never changes or is deleted.
  It is not a finding and says nothing about the collector.

## Limits and safety

- At most 500 submissions in one sample (a larger draw is refused before any
  change, with the number it would have taken), at most 50,000 eligible.
- One draw at a time per form (transaction advisory lock 74139 with the form).
- `requestId` (a client UUID) makes a draw safe to retry; reusing it with
  different settings is refused.
- Encrypted forms can be sampled: the draw reads no answers.
- Audit entry `field_data.backcheck_sample.draw` with the sample ID, seed and
  counts.

## API

- `POST /v1/projects/:projectId/forms/:xmlFormId/backcheck-samples`
  `{ requestId, rate, minPerCollector?, receivedFrom?, receivedTo? }`:
  `submission.update` on the form. 201 with the sample. Invalid settings:
  400.58. Too large: 400.59.
- `GET .../backcheck-samples`: the form's samples, newest first, with counts.
- `GET .../backcheck-samples/:sampleId`: settings, seed, per-collector
  coverage and the items (instance ID, collector, review case, routing,
  latest backcheck status). Both reads need `submission.read`.

## Storage

`field_data_backcheck_samples` (form, request ID and hash, seed, settings,
eligible list as instance IDs, counts, drawn by/at) and
`field_data_backcheck_sample_items` (sample, submission, instance ID,
submitter, rank, case ID, routing). An item's submission is unique across
samples. A purged submission keeps its item (instance ID, collector, rank)
without the link; a purged form takes its samples with it. On a migration rollback both tables are kept when they hold samples,
like the backcheck table.

## Not in this slice

Automatic or scheduled samples, stratification by area or question, dispatch
of sampled backchecks to App Users without a reviewer, backchecker workload
balancing, statistical estimates from backcheck results.

## Acceptance

- Unit: the draw (strata, minimum, rounding, rate 100, empty strata,
  reproducibility for a seed, independence from input order).
- Integration: a draw routes cases with `backcheck-sample` (new case, existing
  open case, already-decided case); recomputing from the stored seed and
  eligible list gives the stored items; a second sample skips the first one's
  submissions; retry with the same `requestId` is safe and a changed reuse is
  refused; too-large and invalid settings change nothing; permissions (viewer
  reads, cannot draw; App User neither); coverage counts follow a backcheck
  request and link; migration rollback keeps samples.
- Browser: draw a sample on the Verification page, see the coverage table and
  links to the review cases.
