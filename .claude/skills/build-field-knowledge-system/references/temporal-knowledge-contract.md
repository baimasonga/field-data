# Temporal knowledge contract

## Entity identity

Record entity ID/type, source identifiers, canonical attributes, geometry references, status, created/retired time, match/merge history, and tenant/project visibility. Keep merge and split events reversible.

## Temporal claim

Record subject, predicate, object/value/unit, valid-from/to, recorded-at/superseded-at, source evidence, confidence, provenance type, schema/policy version, and status. Do not overwrite a prior fact when validity changes.

## Freshness policy

Define claim type, nominal validity, decay function or bands, event-based invalidators, seasonal rules, minimum evidence, risk weighting, grace period, and required action. Version the policy.

## Knowledge answer

Return answer text or structured result, cited claim/evidence IDs, query time scope, authorization context, retrieval/index version, model/prompt version if generated, confidence/limitations, and feedback/correction path.

## Causal analysis

Require treatment, outcome, population, time horizon, estimand, assumed causal graph, confounders, identification strategy, missing-data treatment, diagnostics, uncertainty, sensitivity analysis, and plain-language limitations.

## Twin projections

Record projection type/version, source-event watermark, build time, completeness, scenario assumptions, and uncertainty. A stale or partial projection must announce that state to users and APIs.
