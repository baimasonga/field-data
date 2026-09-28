---
name: build-field-intelligence-platform
description: Architect, plan, implement, review, and verify next-generation field-data capabilities that turn submissions into evidence-backed intelligence. Use for cross-cutting work spanning proof of presence, fraud detection, adaptive surveys, satellite or GIS verification, field operations, offline synchronization, multimodal AI, digital asset passports, knowledge freshness, or a Field Evidence Graph; also use to sequence multiple specialist feature groups into a coherent delivery roadmap.
---

# Build a Field Intelligence Platform

Treat this as the coordinating skill for the complete product. Convert the legacy pipeline `form -> submit -> dashboard` into:

`collect -> prove -> cross-check -> score -> investigate -> act -> reverify`.

Read [references/capability-map.md](references/capability-map.md) to route the request to the correct capability. Read [references/engineering-standard.md](references/engineering-standard.md) before editing production code or approving an implementation plan.

## Operating workflow

1. Inspect the repository, architecture, schemas, migrations, API contracts, mobile client, web client, background jobs, tests, and deployment configuration. Read project instructions first.
2. State the user outcome and identify the affected capability, actors, trust boundary, offline path, evidence sources, and decision supported.
3. Trace the existing end-to-end path before changing it: capture -> local persistence -> sync -> ingestion -> processing -> review -> action.
4. Produce a thin vertical slice. Prefer one complete, observable, testable flow over disconnected screens, tables, or services.
5. Preserve backwards compatibility unless the user explicitly authorizes a migration break. Version schemas, models, form definitions, scoring policies, and APIs.
6. Implement with deterministic rules first. Add probabilistic models only where they create measurable value, and always retain reason codes and human review.
7. Validate the happy path, offline path, retry/idempotency behavior, denied-permission path, degraded-sensor path, adversarial path, and rollback path.
8. Update documentation and operational controls needed to run the feature. Do not declare completion from UI presence alone.

## Required architectural invariants

- Represent a real-world assertion as a versioned **claim**, not merely a form answer.
- Link each claim to zero or more immutable evidence records, verification results, confidence components, review decisions, and actions.
- Store original evidence separately from derived features and model outputs.
- Record provenance: actor/device, capture time, receipt time, source, transformation version, policy version, and integrity hash.
- Make synchronization idempotent. Use stable client-generated identifiers and server-side deduplication.
- Make every automated score explainable through components and reason codes; never use a single opaque risk number as the sole basis for sanctions.
- Keep collection operational when connectivity, precise GPS, camera, or AI inference is unavailable. Record degradation explicitly.
- Apply data minimization, purpose limitation, role-based access, retention, consent, and deletion policies to sensitive evidence.
- Keep reviewers able to override machine output with a reason, and preserve the audit trail.

## Delivery contract

For every feature, deliver or explicitly mark not applicable:

- user story and measurable success criteria;
- architecture and threat-model delta;
- schema/API/event changes with versioning and migration path;
- mobile/offline behavior and synchronization semantics;
- web review and investigation workflow;
- security, privacy, consent, accessibility, and retention controls;
- observability: metrics, structured logs, traces, alert thresholds, and model/policy versions;
- unit, integration, end-to-end, offline, concurrency, and adversarial tests;
- rollout plan with feature flag, pilot cohort, baseline, acceptance threshold, and rollback condition.

## Implementation sequencing

Build in dependency order unless repository evidence supports another sequence:

1. Identity, versioning, evidence envelope, immutable audit events, and idempotent sync.
2. Explainable verification and review queues.
3. Operational assignment, back-check, and remediation loops.
4. Domain-specific sensing, geospatial, fraud, or multimodal capabilities.
5. Learning, optimization, institutional memory, and counterfactual analysis.

Never begin with frontier AI while evidence provenance, synchronization, permissions, and review controls are missing.

## Specialist routing

Use the matching specialist skill when available:

- `$build-field-evidence-trust`: proof of presence, evidence graph, confidence, sensor integrity, media challenges, witnesses, and replay.
- `$detect-field-fraud`: data DNA, collusion, synthetic respondents, contradiction analysis, and targeted back-checks.
- `$build-adaptive-surveys`: adaptive interviews, survey simulation, live evolution, uncertainty, and local-language generation.
- `$build-geospatial-field-intelligence`: satellite witness, change detection, uncertainty mapping, and survey-from-space.
- `$orchestrate-field-operations`: sampling control, mission planning, accessibility learning, and anomaly-generated assignments.
- `$build-offline-field-sync`: progressive sync, store-and-forward relays, physical courier mode, and chain of custody.
- `$build-multimodal-field-ai`: photo/video/voice extraction, object-led workflows, and questionless surveys.
- `$build-field-knowledge-system`: asset passports, change histories, institutional memory, freshness, and digital twins.

## Completion gate

Reject “complete” when any applicable condition fails:

- The feature is only a mock UI or stubbed endpoint.
- Evidence or model output cannot be traced to source and version.
- Retries can duplicate submissions or side effects.
- A collector is blocked because connectivity or inference is unavailable.
- Reviewers receive a score without reasons or supporting evidence.
- Sensitive data lacks access, retention, export, and deletion controls.
- No representative end-to-end test proves the full workflow.
- No measurable pilot criterion or rollback path exists.
