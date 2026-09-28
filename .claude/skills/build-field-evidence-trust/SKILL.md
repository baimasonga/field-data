---
name: build-field-evidence-trust
description: Design, implement, audit, or test verifiable field evidence and proof-of-presence capabilities. Use for Field Evidence Graphs, Reality Scores, GNSS spoof detection, environmental fingerprints, motion proof, randomized capture challenges, proof-of-life media, peer or beacon witnesses, encrypted field black boxes, survey replay, evidence provenance, and explainable confidence.
---

# Build Field Evidence and Trust

Turn a submission into a defensible claim supported by independent evidence. Read [references/features.md](references/features.md) for feature behavior and [references/evidence-contract.md](references/evidence-contract.md) for the canonical model.

## Workflow

1. Inspect current capture, storage, sync, review, security, and audit paths.
2. Define the claim being verified and the fraud or error scenario. Do not collect sensors merely because they are available.
3. Select independent evidence families: GNSS, network context, inertial motion, device attestation, media continuity, witness token, route, time, and historical context.
4. Define an evidence envelope and capture state machine that survives process death and offline operation.
5. Verify integrity and freshness before extracting derived features. Preserve originals immutably.
6. Calculate component-level results, then a calibrated confidence classification. Treat missing sensors as degraded evidence, not automatic fraud.
7. Build a reviewer experience showing the claim, evidence timeline, contradictions, confidence components, limitations, and permitted actions.
8. Test real, degraded, replayed, tampered, spoofed, duplicated, and privacy-sensitive scenarios.

## Trust rules

- Never equate a coordinate with physical presence.
- Require at least two reasonably independent evidence families for a “verified” status when risk warrants it.
- Sign evidence envelopes with hardware-backed keys when available; expose capability and attestation state when unavailable.
- Bind challenge responses to a nonce, assignment, device, time window, and capture session.
- Store environmental fingerprints as salted, rotating, privacy-preserving features rather than raw nearby device identifiers whenever possible.
- Make witness protocols unlinkable beyond what investigation requires. Rotate beacon identifiers and prevent passive tracking.
- Separate event time, device time, server receipt time, and estimated clock error.
- Let legitimate collectors continue in degraded mode and route high-risk cases to review.
- Never reveal anti-fraud thresholds or challenge schedules to the collector client.

## Reality Score

Expose components, not just a total. Typical components include presence, temporal integrity, media authenticity, movement consistency, route plausibility, device integrity, duplication risk, historical consistency, and independent corroboration.

Use explicit states such as `verified`, `probable`, `insufficient_evidence`, `conflicting_evidence`, and `suspected_manipulation`. Version weights and thresholds. Calibrate with local ground truth and report false-positive rates.

## Implementation requirements

- Use stable IDs for claims, evidence, capture sessions, challenges, witnesses, verifications, and reviews.
- Hash original payloads and maintain chain-of-custody events for capture, relay, receipt, transformation, access, and disposition.
- Encrypt sensitive evidence at rest and in transit; isolate key material and use least privilege.
- Queue expensive verification asynchronously and make it safe to retry.
- Make replay a projection of immutable events, not a separately edited narrative.
- Add retention classes so raw sensor streams expire sooner than necessary audit summaries.

## Acceptance gate

Require one representative end-to-end proof: issue assignment -> capture offline -> collect evidence -> synchronize -> verify -> inspect replay -> make review decision -> retain audit history. Include adversarial tests for nonce replay, clock manipulation, copied media, mock location, evidence mutation, and duplicate sync.
