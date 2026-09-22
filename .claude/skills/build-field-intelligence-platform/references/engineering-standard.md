# Engineering and delivery standard

## Definition of ready

- Name the user decision the feature improves.
- Identify affected roles and permissions.
- Define the authoritative source and acceptable uncertainty.
- Specify offline and degraded-mode behavior.
- Establish a baseline metric and target.
- Complete a privacy and misuse assessment for sensitive evidence or scoring.

## Design review

Document decisions that affect data contracts, trust boundaries, model behavior, or future compatibility. Capture context, options, decision, consequences, migration, and rollback. Avoid architecture-by-diagram without executable contracts.

## Data and API rules

- Use additive migrations before destructive cleanup.
- Preserve raw inputs and derived outputs separately.
- Attach tenant/project scope to every protected record.
- Enforce authorization server-side and, where supported, with row-level policies.
- Use cursor pagination for growing timelines and evidence lists.
- Use optimistic concurrency or version checks for review decisions.
- Define idempotency keys for submission, media, relay, verification, and action creation.
- Validate at trust boundaries; never rely only on the mobile or web client.

## AI and scoring rules

- Record model, prompt, threshold, feature-set, and policy versions.
- Calibrate confidence on representative local data; report performance by geography, device class, language, and relevant demographic groups.
- Provide abstention and human-review states.
- Distinguish missing evidence from adverse evidence.
- Prevent training leakage from the evaluation set.
- Do not infer protected traits unless explicitly justified, lawful, consented, and necessary.
- Monitor drift, override rates, false positives, and downstream harm.

## Test matrix

At minimum cover:

| Layer | Required proof |
| --- | --- |
| Unit | Rules, scoring components, state transitions, serializers, permission checks |
| Contract | API/event compatibility and schema-version handling |
| Integration | Database, storage, queue, inference provider, map/satellite adapter |
| Mobile | process death, clock skew, permission denial, low storage, intermittent network |
| Sync | retries, reordering, duplication, partial media, conflict, relay chain |
| End-to-end | capture through review and resulting action |
| Adversarial | replay, tampering, spoofing, duplicate media, collusion patterns, poisoned input |
| Operations | migration, feature flag, rollback, alerting, audit export |

## Evidence for completion

Provide changed-file summary, migrations, API or event examples, test results, screenshots only where visual behavior matters, known limitations, rollout steps, and the next highest-risk gap. Do not hide failing tests or pre-existing defects; distinguish them clearly.
