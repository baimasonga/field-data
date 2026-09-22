# Multimodal AI contract

## Inference request

Include request ID, task/schema version, media evidence IDs, permitted transformations, locale/domain, device capability, privacy policy, model preference, and idempotency key.

## Inference result

Include result ID, request ID, model/config version, execution location, start/end time, input hashes, extracted fields, grounding references, confidence/quality, abstentions, warnings, and review status.

## Extracted field

Store canonical variable ID, proposed value/unit, method, confidence or ordinal quality, grounding (box/segment/frame/span), evidence ID, alternatives, and confirmation state. Keep user corrections as new decisions, not overwritten model output.

## Evaluation

Use task-appropriate metrics: detection mAP, count error, OCR character/field accuracy, transcription WER plus semantic field accuracy, calibration, abstention quality, correction rate, completion-time change, and harmful-error rate. Slice by device, environment, language/accent, and domain subtype.

## Model lifecycle

Register approved versions, signatures, minimum client/runtime, dataset lineage, evaluation, release cohort, monitoring thresholds, retirement date, and rollback. Never auto-upgrade an offline model without integrity verification and enough storage.
