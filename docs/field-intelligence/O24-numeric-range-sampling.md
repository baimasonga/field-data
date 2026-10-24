# O24: backcheck sampling by numeric ranges

Manual and daily/weekly scheduled draws can group a supported integer or decimal
question into ranges. On **Verification & planning → Random backcheck sample**,
choose collector/answer grouping, a numeric question, then **Group numeric answers
→ Numeric ranges**. Enter increasing boundaries, for example 18 and 35.
The groups are **Below 18**, **18 to below 35**, **35 or above**, plus a separate
**Missing answer** group. Boundaries belong to the range starting at that value;
all finite ordinary decimal values belong to exactly one range, including values
below the first or above the last boundary.

**Add group rate** offers the generated ranges and missing answers. Unspecified
ranges use the default percentage. The minimum and rounding up still apply
within each collector × range intersection; actual shares may exceed the
configured percentage for small groups. Changing a question, grouping mode or
boundary clears edited rate overrides. Saved schedules and recorded sample
history show all boundaries, rules and effective group coverage.

## API contract and exact comparison

Manual POST and schedule PUT accept optional
`groupBreaks: ["18", "35"]` alongside `groupField` and the existing default rate,
minimum and optional `groupRates`. Boundaries are **strings**, not JSON numbers,
so decimal precision is not lost in transport. There are 1–98 boundaries when
range mode is active, each at most 64 characters before and after canonicalization.
They must be distinct and increasing after stripping whitespace, a leading plus,
redundant leading zeros and trailing fractional zeros. Negative zero becomes zero.
Empty/omitted boundaries mean exact-answer grouping and retain the legacy shape.

Range labels are generated from canonical boundaries. For example,
`groupRates: [{ value: "Below 18", rate: 100 }, { value: null, rate: 50 }]`
targets the first range and missing answers. Unknown range labels are rejected.
Existing percentages of 1–100 and per-intersection minimums are unchanged.
Canonical equivalent boundaries replay the same manual request ID; changing a
boundary with that ID is refused. PUT replaces saved settings; omitted/empty
boundaries clear range mode without restarting the current period. Omit/clear
range rates too when switching to exact-answer sampling.

Answers are decoded, NFC-normalized and trimmed using existing field safety
checks. Missing/empty answers remain missing. Nonempty answers must be ordinary
signed decimal numbers, with an optional decimal point; exponent notation,
locale separators, hexadecimal, NaN and infinity are unsupported. Boundaries
and answers compare using scaled integers, with no binary floating-point
rounding, so `17.999999999999999999` remains below 18. Existing 200-character
answer and XML/readability limits apply. Numeric ranges require an unencrypted,
nonrepeating scalar integer or decimal question in the published form. Strings,
dates, media, repeats and multi-select questions cannot use numeric ranges.

## History, scheduling and safety

Only the final range label (not the raw numeric answer) is added to each retained
eligible row. Canonical boundaries and rate rules are included in immutable
sample settings and audit details. Reproduction uses those recorded memberships,
settings and the seed; source edits and later schedule changes cannot rewrite a
draw. Coverage is ordered by numeric range, followed by missing answers, and
shows effective percentage, eligible, sampled, requested and linked counts.

Manual/scheduled draws share one implementation, source exclusion and locks.
UTC boundaries, catch-up, permissions, independent allocation and retry behavior
remain unchanged. The runner rechecks that the current question is numeric. An
invalid nonmissing answer refuses a manual draw atomically and pauses a schedule
with a failed run, leaving no sample or sample audit. Disabling a schedule is
still possible when the saved question is unavailable; re-enabling starts a new
period. There are at most 99 numeric ranges plus missing, within the existing
100-group limit. Total eligibility/sample limits remain in force.

A nullable JSONB schedule column stores boundaries. Migration up is idempotent;
rollback retains configured designs and can drop/recreate unused columns.

## Validation and remaining work

Unit tests cover exact signed/large/long-fraction comparisons, boundary inclusion,
canonical validation and invalid inputs. PostgreSQL tests cover actual selection,
immutable range-only snapshots, audit settings, canonical retries, atomic failure,
scheduled catch-up, clearing without period reset, type restrictions and migration
rollback/reapply. Browser tests cover both editors, retries, saved reload, generated
rate targets, stale-rate clearing, coverage and mobile layout.

Geographic polygon strata, weighting and calibrated estimates remain separate
work. Numeric grouping does not produce weighted population estimates or measured
fraud/error rates. Operations and the overall eight-area programme remain partial.
