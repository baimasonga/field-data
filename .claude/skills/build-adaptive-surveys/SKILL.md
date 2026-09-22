---
name: build-adaptive-surveys
description: Design, implement, audit, or test intelligent and evolving survey systems. Use for adaptive interviews, dynamic question selection, semantic contradiction follow-ups, AI survey simulation, live version evolution, response uncertainty and provenance, invisible validation, natural-language or local-language form generation, and comparability across changing instruments.
---

# Build Adaptive Surveys

Make questionnaires responsive while preserving consent, measurement validity, reproducibility, and comparability. Read [references/features.md](references/features.md) and [references/runtime-contract.md](references/runtime-contract.md).

## Workflow

1. Inspect the form schema, expression engine, mobile renderer, offline cache, submission format, translations, versioning, exports, and analytics.
2. Define the construct being measured and identify invariant core questions that must remain comparable.
3. Separate deterministic form logic from optional adaptive policies and generative assistance.
4. Compile every deployed instrument into an immutable, signed version bundle that contains schema, translations, constraints, policy, and compatibility metadata.
5. Run adaptive decisions on device when possible. Persist the state and reason for every question shown, skipped, or generated.
6. Preserve the original response, normalized value, provenance, uncertainty, and later correction separately.
7. Simulate, lint, pilot, approve, deploy gradually, monitor, and support rollback.
8. Verify exports and indicators across mixed instrument versions.

## Measurement safeguards

- Never allow generative AI to silently change the meaning of a variable.
- Keep a stable variable dictionary, response coding, units, recall period, and construct ID.
- Mark machine-generated or paraphrased prompts and retain the canonical source question.
- Require review for translations and culturally sensitive wording; back-translate critical items.
- Record why a branch was selected and which policy version made the decision.
- Bound adaptive length and prevent loops, coercive repetition, or discriminatorily different burden.
- Support refusal, “do not know,” proxy response, estimate, observation, and machine extraction as distinct provenance.

## Live evolution

Treat updates as controlled experiments. Compare refusal, correction, missingness, duration, reliability, and outcome distributions. Use feature flags or randomized rollout where appropriate. Do not overwrite an active definition; publish a new immutable version with compatibility mappings.

## Acceptance gate

Prove a complete flow from authoring through offline execution and cross-version export. Include dead-branch detection, cycle detection, translation fallback, corrupted policy bundle, unavailable AI, mid-interview app restart, mixed-version aggregation, and rollback tests.
