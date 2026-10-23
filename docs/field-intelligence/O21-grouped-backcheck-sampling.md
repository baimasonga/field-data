# O21: backcheck sampling by area or answer

On the form's **Verification & planning** page, choose **Group submissions →
By collector and area or answer**, then select a recorded district, facility
category or other supported question. The rate and minimum apply separately to
each collector × answer intersection. The collector-only default retains its
existing request shape, quotas and seeded draw behavior.

## Contract

Manual `POST .../backcheck-samples` accepts optional `groupField` (a published
question path). `GET .../backcheck-samples/fields` lists supported non-repeating
text, integer, decimal, date, barcode and single-choice questions. Multi-select,
media, locations, metadata and repeat answers are excluded. An area must be a
recorded answer; no geographic boundary is inferred from coordinates.

Grouped draws additionally require `submission.read` and `submission.list`.
All history, labels and eligible-list reads retain form-level authorization and
private/no-store responses. Encrypted published forms cannot use grouping.
Any eligible encrypted, malformed, ambiguous repeated answer or over-2-MiB XML submission rejects the whole
grouped draw rather than silently losing its coverage. This also catches historical
form versions where a currently scalar path had multiple answers. Collector-only sampling
continues to work without reading answers.

Groups use decoded text, trim surrounding whitespace, normalize Unicode NFC,
and keep case and internal whitespace distinct. Blank/missing answers use a
separate null group. The draw refuses more than 100 distinct answer groups,
including missing, or raw decoded answers over 200 characters. It never silently
truncates or merges categories. Existing 50,000 eligible and 500 sampled bounds
apply; minima across many collector/group intersections can exceed the sample
limit and must be reduced by the manager.

The existing setting `minPerCollector` is applied per collector/group intersection
when `groupField` is supplied. Each intersection takes
`min(n, max(minimum, ceil(rate * n / 100)))`. The published SHA-256 seed/instance-ID
ordering is unchanged. Eligible JSON records the selected normalized group value;
items' ranks are within their intersection. The saved seed, settings and eligible
list reproduce the choice independently of source order. Request hashes include
the grouping field; matching retries do not create a second sample. Already
sampled submissions remain excluded across both sampling modes.

Selected group values are retained in the immutable sampling record and returned
to authorized readers, even after source answers change. Choose categorical
questions rather than personal identifiers. No other answers are copied. Existing
records require no database migration.

## Coverage and follow-up

The detail API adds `groups: [{ value, eligible, sampled, requested, linked }]`
and each selected item's `groupValue`. Coverage aggregates across collectors for
each answer; collector coverage remains available alongside it. Requested includes
requested or linked latest backchecks; linked means response evidence has been
linked through the existing workflow. These are operational counts, not measured
fraud/error rates or statistical confidence. Historical eligibility/groups remain
fixed; requested/linked counts update from current backcheck state.

Selected cases enter the ordinary review queue. Human review, independent
backcheck assignment, opt-in allocation, quota/shift accounting and permission
rechecks retain their existing behavior. A group is not an allegation.

[O22](O22-scheduled-answer-sampling.md) extends this grouping to daily/weekly schedules.
[O23](O23-group-specific-sampling-rates.md) adds unequal per-category rates.
Numeric bins, geographic polygon strata, weighting and calibrated estimates remain separate work.

## Validation

Unit tests cover intersection sampling, missing groups, seeded reproducibility,
field restrictions and path validation. PostgreSQL tests cover decoded/trimmed
answers, immutable snapshots, coverage following independent requested/linked
backchecks, permissions, retries, limits and atomic refusal. Browser tests cover
field loading/recovery, idempotent draw retries, escaped labels, missing groups,
legacy sampling and mobile layout. Existing scheduled sampling is regression-tested.
