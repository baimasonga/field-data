# O23: different sampling rates by recorded answer group

On **Verification & planning → Random backcheck sample**, choose collector and
answer grouping, a question, then **Add group rate**. The same controls are
available for the daily/weekly schedule. Each rule selects an exact answer or
**Missing answer**, and a whole percentage from 1 to 100. The normal share is
the default for unmatched answers. For example, with a default of 10%, North at
100% and missing answers at 50%, every North submission is selected while other
answers retain the default. The minimum and rounding up apply separately within
each collector × answer intersection. Small groups can therefore have a larger
realized share than their configured percentage.

## API and normalization

Manual POST settings and schedule PUT accept optional
`groupRates: [{ value: "North", rate: 100 }, { value: null, rate: 50 }]`.
Nonempty rules require `groupField`. There are at most 100 rules, bounded to 200
characters per answer both before and after NFC normalization and trimming.
Capitalization and internal spaces remain distinct. Null means missing; the
literal string `"null"` is a different answer. Empty strings, duplicate normalized
answers, unknown rule properties and invalid percentages are rejected atomically.
Rules for values not yet observed are permitted for future scheduled periods.

Rules are normalized and sorted before hashing and recording the settings.
Reordering rules or changing only edge whitespace replays the same manual
request ID; changing a rate with that ID is rejected. An omitted/empty list
preserves the legacy API settings shape. PUT replaces schedule settings, so
omitting rules or sending an empty list clears them. Switching to collector-only
sampling clears rules as well. Changing the question in the UI clears its edits.

## Execution, history and safety

Both manual and scheduled draws use the same seeded hash ranking, choosing each
intersection's lowest ranks up to its effective rate/minimum. Rate changes do not
restart a schedule period. UTC boundaries, catch-up, form locks, shared exclusion,
permission checks, unsafe-data pause and transaction retry behavior are retained.
Rules are included in immutable settings snapshots and audit details. Old draws
keep their rules when the current schedule changes. No seed or source-data edits
are introduced by configuring rates.

The UI shows all saved/recorded rules, including currently unobserved values.
Coverage shows the effective percentage for each observed group alongside
eligible, sampled, requested and linked counts. Grouped API detail adds `rate`
to each group when rules are present; legacy responses retain their shape.
These are operational backcheck counts, not weighted population estimates,
measured fraud rates or confidence intervals. Independent review/allocation and
existing total draw limits continue to apply.

A nullable JSONB schedule column stores canonical rules. Migration up is
idempotent; rollback retains configured rules to avoid silently changing a
sampling design. Unused columns can be dropped and recreated.

## Validation and remaining scope

Unit tests exercise deterministic unequal selection, default fallback, missing
versus literal-null answers, minimums, Unicode normalization and invalid bounds.
PostgreSQL tests exercise manual replay/refusal, retained settings, actual
scheduled selection, clearing without period reset and rollback/reapply.
Browser checks exercise editing both forms, retrying a manual draw, saved rule
reload, coverage and clearing on a narrow mobile viewport.

[O24](O24-numeric-range-sampling.md) adds numeric ranges. Geographic polygon strata, weighting and calibrated estimates
remain separate work. This completes the bounded unequal group-rate capability;
the wider Operations area and the eight-area programme remain partial.
