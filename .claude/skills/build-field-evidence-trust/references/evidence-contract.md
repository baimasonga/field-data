# Evidence contract

## Minimum records

**Claim**: ID, entity ID, project ID, type, normalized value, unit, valid interval, source observation, status, schema version.

**Evidence**: ID, claim links, capture session, type, storage reference, media type, byte size, hash, capture/receipt times, device/actor, coarse location policy, encryption key reference, retention class, consent basis, integrity status.

**Derived feature**: ID, evidence ID, feature type, value/vector reference, algorithm/model version, computed time, quality, reproducibility inputs.

**Verification result**: ID, claim ID, component, outcome, score if applicable, reason codes, evidence IDs, policy/model version, limitations, created time.

**Review decision**: ID, reviewer, decision, rationale, prior version, supporting evidence, created time.

## Capture session states

Use explicit transitions: `created -> challenge_issued -> capturing -> sealed -> queued -> relayed? -> received -> verified|degraded|rejected`. Persist transitions locally before side effects. A sealed session is append-only.

## Confidence design

Keep confidence separate from completeness and risk. A record can be complete but untrusted, or incomplete but authentic. Use calibrated probabilities only when calibration data exists; otherwise use ordinal bands with transparent rules.

## Privacy controls

- Configure sensor/evidence collection by purpose and risk tier.
- Display understandable consent or project authorization where applicable.
- Support subject access, redaction, export, legal hold, and deletion workflows.
- Restrict raw evidence more tightly than derived summaries.
- Audit every privileged evidence access.
