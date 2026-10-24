# O26: sampling design weights

Under **Verification & planning → Random backcheck sample**, choose a retained
sample and **Show sampling weights**. Authorized readers can inspect stratum
counts, inclusion probabilities and design weights, then download JSON containing
one row for each selected submission. It works for manual and scheduled draws,
including historical collector-only, exact-answer, numeric-range and polygon
sampling. Viewing weights does not change or redraw a sample.

## Definition and scope

For each recorded collector × group stratum, let N be the number of eligible
records and m the number actually selected. Inclusion probability is m/N and the
expansion/design weight is N/m. Collector-only draws have one stratum per collector.
Counts use actual membership after ceiling, minimums and the cap at N, not the
requested percentage. For example, choosing two of five gives probability 0.4
and weight 2.5 even if a low configured rate was raised by the minimum. Different
rates and missing-answer groups retain their own denominators. Within a stratum,
weights summed over selected records equal its eligible count (up to numeric
rounding); this is a design identity, not an outcome estimate.

Scope is **this draw's recorded eligible submissions**. Earlier sampled records,
other forms/periods, deleted-before-draw records and other ineligible work are
outside that frame. The seeded hash draw uses a fresh random seed with uniform
hash ranking as its selection model. These are first-order design probabilities;
no joint inclusion probabilities, variances or confidence intervals are supplied.

Weights do not correct for unlinked/missing backchecks, nonresponse, erroneous
source values, geographic measurement uncertainty or population coverage. They
must not be applied only to responding records as though response were random.
No weighted fraud/error rates, calibrated estimates or claims about an entire
project population are produced in this milestone.

## Read API, integrity and retained identity

`GET .../backcheck-samples/:sampleId/weights` requires submission read and list
permissions for that form and returns private, no-store data. It includes sample
ID, draw time, scheduled flag, seed, optional grouping path and:

- `method: "stratum-expansion-v1"` and `scope: "recorded-eligible-submissions"`.
- `available`, eligible/selected totals, stratum rows and selected-record rows.
- Each row carries retained collector ID, optional group value, eligible/selected
  counts, inclusion probability and design weight; item rows add instance ID.

Before exposing weights, the service validates stored settings, unique bounded
eligibility, the seed and selected membership. It replays the draw and requires
an exact match to retained selected instance IDs. Inconsistent/incomplete history
returns `available: false` with a bounded reason and no weight rows. Empty draws
return available with empty arrays and no zero-denominator weights.

Collector IDs and group memberships come from the immutable eligibility snapshot,
not live source XML or nullable actor links on sample items. A purged source or
deleted collector therefore does not reassign a selected record to another
stratum. Requested/linked backcheck counts and current case status do not enter
weight calculations. Existing seed/snapshot protections and permissions remain.

The UI resets weight state when another sample is selected, exposes failures and
retry, and removes exports for unavailable history. Tables round to six decimal
places; JSON retains JavaScript numeric precision plus the integer numerator and
denominator counts for exact rational reconstruction. No database migration or
new persisted source data is needed.

## Validation and remaining scope

Unit tests cover unequal rates, minimums/rounding, missing groups, totals,
input order, deleted actor links, legacy/empty draws and inconsistent history.
PostgreSQL tests cover permissions, stable results after source edits, numeric
and polygon membership, scheduled draws and empty frames. Browser tests cover
reader access, retry, stratum display, JSON download, unavailable-state handling,
sample switching and mobile overflow.

This implements inspectable design weights. Calibrated estimates, nonresponse
adjustment, reviewed outcome estimands, variance and confidence intervals remain
separate work. Operations and the eight-area programme remain partial.
