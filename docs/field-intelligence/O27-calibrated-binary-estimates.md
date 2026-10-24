# O27: calibrated reviewed-binary estimates for a retained draw

After **Verification & planning → Random backcheck sample → Show sampling
weights**, use **Calibrated binary outcome estimate**. Download the outcome
template, fill selected records with reviewed 0/1 outcomes (null means unknown),
and upload it. Define what 1 means and identify the review source/date. No status,
backcheck difference, machine finding or unresolved case becomes an outcome
automatically. The user supplies and takes responsibility for the reviewed coding.

## Scope and calibration targets

The target is this draw's **recorded eligible submission frame**, not a whole
project, national population, or the set of all backchecks. Exact retained counts
N_h in each collector × recorded group stratum are the calibration targets. No
external population margins are invented. Collector-only, exact-answer, numeric
and polygon draws use the same retained grouping and seed checks as O26.

For stratum h, m_h records were selected and r_h have supplied reviewed outcomes;
t_h of those outcomes are 1. Base design weight is N_h/m_h. The response adjustment
is m_h/r_h, giving calibrated weight N_h/r_h. These weights sum to N_h over the
reviewed records in every stratum. Estimated positive total is the sum of
N_h × t_h/r_h; estimated proportion divides that total by sum(N_h).
For example, with target counts 8 and 2, four reviewed outcomes in the first
stratum (one positive) and two in the second (both positive), the estimate is
(8 × 1/4 + 2 × 2/2)/10 = 40%, compared with the naive respondent mean of 50%.

Every nonempty stratum needs at least one reviewed outcome. An empty frame or an
unreviewed stratum yields diagnostics and **no point estimate**. If any selected
outcomes are unknown, calculation additionally requires explicit acknowledgement
that response behaves like a random subsample within **every** stratum. Uploading
a file never checks this acknowledgement automatically. The system cannot verify
that assumption. Nonresponse related to the outcome can invalidate the result.
All selected outcomes reviewed needs no additional response assumption, but still
uses the random seeded sampling design model.

## Conservative uncertainty bound

The reported 95% interval is a conservative bounded-outcome Hoeffding bound under
independent simple random selection within strata and, where needed, the stated
random-response assumption. For N = sum(N_h), the radius is:

`sqrt(log(40)/2 × sum_h ((N_h/N)^2 / r_h))`

The sum excludes complete-frame census cells (r_h = N_h), whose contribution is
known exactly. Clip proportion ± radius to [0,1]. Sampling without replacement is
at least as concentrated as the with-replacement bounded model used by this
bound. It does not use an estimated variance that becomes zero for tiny samples
with all 0s or all 1s. A singleton sample from a larger stratum therefore retains
uncertainty. A completely reviewed eligible frame has radius zero and its exact
recorded proportion. Small or weakly covered frames may yield [0%,100%].

This is not a normal/Wald confidence interval, external calibration validation,
measurement-accuracy guarantee, or correction for systematic nonresponse. It
assumes binary outcomes are coded correctly and the selection/response model
holds. The interface makes conditional response assumptions visible beside the
result. No calibrated project-wide fraud/error rate is inferred.

## API and provenance

`POST .../backcheck-samples/:sampleId/estimate` is a calculation-only endpoint
requiring the same submission read/list permissions as weights. It accepts:

```json
{"sampleId":"<selected sample UUID>","definition":"What outcome 1 means","source":"Review register/date","assumeRandomResponse":false,"outcomes":[{"instanceId":"<selected record>","value":1},{"instanceId":"<another selected record>","value":null}]}
```

Only 0, 1 and null are accepted. Unselected records, duplicates, wrong sample IDs,
unknown fields, more than 500 rows, oversized IDs and missing/overlong definition
or source are rejected. Omitted selected records count as unknown, not zero.
Rows are canonicalized and sorted; metadata is NFC-normalized and trimmed. The
result contains the canonical input and SHA-256 input digest, retained sample ID
and seed, method `recorded-frame-poststratified-binary-v1`, target source
`retained-stratum-eligible-counts`, stratum diagnostics, outcome coverage,
calibrated weights, assumptions and any estimate/bound. The JSON export retains
these inputs for repeatable calculation. Displayed values are rounded; exported
numeric values and integer counts retain calculation precision.

Invalid/inconsistent sampling history is withheld through O26's settings and
seed-replay checks. The API returns private, no-store data. Inputs/results are not
persisted, do not redraw a sample, change a schedule or update review decisions.
Download the result to retain it. The browser clears stale results on input,
assumption or sample changes and disables edits while a calculation is pending.

## Validation and remaining scope

Unit tests cover unequal selection weights, known totals, calibration identities,
nonresponse acknowledgement, unreviewed strata, census and singleton bounds,
invalid inputs and deterministic provenance. PostgreSQL tests cover reader
permissions, request validation, scheduled draws, immutable snapshots and no
persistent mutation. Browser tests cover template/sample identity, unknowns,
retry, explicit acknowledgement, export, stale-result clearing and mobile layout.

This implements bounded post-stratified binary estimates for a retained frame.
External benchmark calibration/raking, validated outcome classifiers, measured
nonresponse models, richer outcomes, tighter variance-based intervals and
field acceptance remain separate work. Operations and all eight areas remain
partial; the broader programme is not marked complete.
