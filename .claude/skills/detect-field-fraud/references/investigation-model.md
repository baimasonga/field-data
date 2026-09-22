# Investigation model

## Core records

- **Risk signal:** subject type/ID, signal type, severity, score or rule outcome, reason codes, evidence references, model/policy version, created time, expiry.
- **Case:** scope, owner, priority, status, linked signals, due date, access group, safeguarding flag.
- **Investigation event:** action, actor, timestamp, note/evidence, prior state.
- **Disposition:** confirmed issue, data error, benign pattern, insufficient evidence, policy exception, model error, duplicate case.
- **Back-check:** target claims, instrument version, independent assignee, result, reconciliation.

## Queue behavior

Deduplicate correlated signals, group by investigative unit, and prioritize expected information value and potential harm—not only highest anomaly score. Include aging, service-level targets, conflicts of interest, reassignment, and escalation.

## Evaluation

Track precision at review capacity, recall on seeded or independently verified cases, false-positive burden, time to disposition, back-check yield, reviewer agreement, appeal overturns, and drift. Slice metrics by project, geography, language, device class, and other justified operational groups.

## Security

Restrict identity-linked fraud data, prevent bulk export by default, watermark sensitive reports, audit access, and define retention. Do not place confidential rule logic or investigator notes in general analytics tables.
