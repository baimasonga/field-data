---
name: orchestrate-field-operations
description: Design, implement, audit, or test intelligent fieldwork planning and control. Use for autonomous sampling correction, mission and route optimization, living accessibility maps, workload balancing, anomaly-generated assignments, back-check allocation, dynamic replanning, field safety constraints, and operational monitoring of data-collection campaigns.
---

# Orchestrate Field Operations

Convert survey objectives into feasible, safe, explainable assignments that adapt as evidence arrives. Read [references/features.md](references/features.md) and [references/optimization-contract.md](references/optimization-contract.md).

## Workflow

1. Inspect the sampling frame, assignments, staff/teams, geography, transport, scheduling, permissions, mobile sync, and completion states.
2. Define the optimization objective and hard constraints separately. Never trade away consent, safety, eligibility, or sampling validity for efficiency.
3. Establish a deterministic planning baseline before introducing optimization.
4. Model uncertainty in travel time, access, respondent availability, workload, and completion probability.
5. Generate a plan with reasons and constraint diagnostics. Keep manual edits possible and auditable.
6. Deliver signed, versioned assignment bundles that function offline.
7. Replan only on meaningful events; protect already-started work and communicate changes clearly.
8. Compare planned versus actual outcomes and update operational models without rewriting history.

## Guardrails

- Preserve sample design, inclusion probabilities, replacement rules, quotas, and weighting metadata.
- Treat safeguarding, daylight, local authorization, conflict, weather, disability access, and transport limits as hard or explicitly governed constraints.
- Never infer that a road is safe solely because it was traversed before.
- Do not penalize collectors for model errors, inaccessible areas, or incomplete map data.
- Show why an assignment was created or reprioritized.
- Require approval for autonomous actions that alter sample validity, compensation, or sensitive site visits.

## State model

Use explicit assignment states such as `proposed`, `approved`, `offered`, `accepted`, `downloaded`, `started`, `blocked`, `completed`, `cancelled`, `superseded`, and `verified`. Protect transitions with version checks. A replan creates a new plan version; it does not silently mutate field reality.

## Acceptance gate

Prove baseline and optimized plans against the same fixture. Test infeasible constraints, stale device plans, concurrent reassignment, offline completion, blocked roads, collector absence, safety exclusion, partial quotas, cancellation, and rollback to a previous approved plan.
