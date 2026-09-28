# Capability map

## Portfolio

| Pillar | Features | Specialist |
| --- | --- | --- |
| Evidence and trust | Proof-of-Presence Engine; Evidence Graph; Reality Score; GPS Spoofing Radar; Environmental Fingerprint; Human Motion Proof; Random Reality Challenge; Proof-of-Life Media; Cross-Collector Witnessing; Community Witness Network; Field Black Box; Survey Replay | `build-field-evidence-trust` |
| Fraud intelligence | Data DNA; Collusion Detection; Synthetic Respondent Detector; Questionnaire Fingerprinting; AI Contradiction Hunter; Self-Designing Back-Checks; Invisible Cross-Validation | `detect-field-fraud` |
| Adaptive surveys | Adaptive Interview Intelligence; AI Survey Doctor; Live Survey Evolution; Answer Uncertainty; local-language form generation | `build-adaptive-surveys` |
| Geospatial intelligence | Satellite Witness; Survey-from-Space; Uncertainty Map; Reality Change Detector | `build-geospatial-field-intelligence` |
| Field operations | Autonomous Sampling Controller; Field Mission Autopilot; Living Accessibility Map; Machine-Generated Field Assignments | `orchestrate-field-operations` |
| Offline resilience | Data Mule Networking; Progressive Sync; Physical Data Courier Mode | `build-offline-field-sync` |
| Multimodal collection | Semantic Photo-to-Database; Object Becomes the Form; Questionless Survey; Voice-First Collection | `build-multimodal-field-ai` |
| Knowledge and decisions | Digital Passport for Physical Assets; Institutional Memory; Counterfactual Intelligence; Data Freshness Decay; Evidence Expiry; Project Digital Twin | `build-field-knowledge-system` |

## Shared domain model

Use these concepts consistently across capabilities:

- **Entity:** persistent person, household, organization, place, parcel, or asset.
- **Observation:** what was captured at a particular time.
- **Claim:** a normalized assertion about an entity or event.
- **Evidence:** immutable material supporting or challenging a claim.
- **Evidence feature:** a derived measurement such as image embedding, GNSS quality, or route plausibility.
- **Verification:** deterministic or probabilistic evaluation with reason codes.
- **Confidence:** calibrated belief with components, limitations, and policy version.
- **Risk signal:** indicator requiring triage; never proof of misconduct by itself.
- **Review:** human decision with disposition and rationale.
- **Action:** assignment, back-check, correction, maintenance, escalation, or re-verification.
- **Validity interval:** when a claim is believed to hold.

## Cross-capability events

Prefer versioned domain events over hidden coupling. Typical events include:

- `observation.captured`
- `submission.received`
- `evidence.registered`
- `verification.completed`
- `risk.signal.detected`
- `review.requested`
- `review.resolved`
- `assignment.generated`
- `entity.change.detected`
- `claim.expiring`

Include an event ID, aggregate ID, tenant/project ID, schema version, occurred-at, received-at, producer, correlation ID, causation ID, and minimal payload. Keep large media in object storage and reference it by immutable identifier and integrity hash.
