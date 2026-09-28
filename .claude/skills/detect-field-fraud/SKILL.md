---
name: detect-field-fraud
description: Design, implement, review, or test explainable quality assurance and fraud-intelligence capabilities for field data. Use for Data DNA, collusion graphs, synthetic respondent detection, enumerator or questionnaire fingerprints, semantic contradiction detection, invisible cross-validation, risk queues, targeted back-check selection, investigator workflows, and responsible model governance.
---

# Detect Field Fraud

Build decision support for detecting error, fabrication, duplication, coercion, or collusion without turning weak signals into automatic accusations. Read [references/features.md](references/features.md) and [references/investigation-model.md](references/investigation-model.md).

## Workflow

1. Define abuse cases, benign lookalikes, harm from false positives, and who may see or act on a signal.
2. Inventory available evidence and establish lawful, purpose-limited use. Exclude features that encode protected traits or unjustified proxies.
3. Create deterministic data-quality rules and investigator labels before training complex models.
4. Generate versioned feature snapshots from immutable source data. Prevent temporal and project leakage.
5. Combine record-level, respondent-level, collector-level, device-level, location-level, and network-level signals.
6. Produce reason-coded risk signals with supporting evidence, uncertainty, and recommended next action.
7. Route cases into a case-management workflow: triage, assign, investigate, back-check, resolve, appeal/correct, and learn.
8. Evaluate with representative local data and report precision/recall at operational thresholds, subgroup performance, reviewer agreement, and cost per confirmed issue.

## Non-negotiable safeguards

- Treat every model output as an allegation-free risk signal.
- Do not expose sensitive detection logic or thresholds to collector clients.
- Require human review before punitive or payment-impacting action.
- Keep an appeal and correction path; immutable history must coexist with corrected operational truth.
- Distinguish suspicious similarity from expected similarity caused by common forms, shared devices, clustered households, or synchronized fieldwork.
- Limit graph guilt-by-association: one risky neighbor must not automatically taint an entire team.
- Train and evaluate on time-separated data where possible.
- Track label provenance and investigator disagreement.

## Engineering pattern

Use a pipeline of `source events -> versioned features -> rules/models -> risk signals -> case queue -> review outcome -> back-check -> labels/metrics`. Ensure each stage is replayable and idempotent. Store model/policy versions, reason codes, evidence references, and threshold at decision time.

Prefer batch analytics for broad pattern discovery and event-driven rules for urgent integrity failures. Keep online collection responsive; never make submission depend on a remote fraud model.

## Acceptance gate

Demonstrate at least one known-bad and two benign-lookalike scenarios for each signal family. Prove that a reviewer can understand the signal, inspect evidence, order a targeted back-check, resolve the case, and see the outcome reflected in metrics without mutating the original submission.
