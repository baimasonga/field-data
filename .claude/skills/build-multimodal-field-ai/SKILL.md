---
name: build-multimodal-field-ai
description: Design, implement, review, or test multimodal AI for field collection. Use for semantic photo-to-database extraction, offline computer vision, object-triggered forms, proof-of-life capture, questionless inspections, video or voice-first surveys, speech-to-structured-data, local-language conversations, media provenance, human confirmation, and evidence-linked AI outputs.
---

# Build Multimodal Field AI

Turn media and conversation into structured, reviewable observations while preserving the original evidence and human control. Read [references/features.md](references/features.md) and [references/ai-contract.md](references/ai-contract.md).

## Workflow

1. Define the field decision and target schema before selecting a model.
2. Inspect media capture, permissions, local storage, sync, object storage, form engine, inference environment, and review UI.
3. Define a capture protocol that guides framing, scale, lighting, coverage, audio quality, and consent.
4. Run lightweight quality checks and safe inference on device where practical; queue server inference without blocking collection.
5. Preserve original media immutably and store each extracted value with spatial/temporal grounding, model version, confidence, and evidence reference.
6. Ask collectors only for missing, ambiguous, high-risk, or non-observable facts.
7. Require confirmation for material values and provide correction and abstention paths.
8. Evaluate on representative local devices, languages, accents, environments, assets, and network conditions.

## AI safeguards

- Never fabricate a value to complete a form. Return `unknown`, `not_visible`, `not_applicable`, or `needs_confirmation`.
- Distinguish detection, classification, counting, measurement, OCR, transcription, and inference; each needs different validation.
- Preserve bounding boxes, segments, timestamps, transcript spans, or frames that ground extracted values.
- Record model, prompt/configuration, label taxonomy, threshold, and preprocessing version.
- Do not infer sensitive personal attributes from media or voice unless explicitly necessary, lawful, consented, and approved.
- Make capture usable without AI; delayed inference must not corrupt or block the submission.
- Treat model-generated form selection as a proposal and support manual correction.
- Provide accessible alternatives to camera, motion, and voice workflows.

## Edge/server split

Place immediate quality checks, privacy redaction where safe, and small models on device. Use server processing for heavier models, aggregation, and reprocessing. Design a common inference contract so either location yields traceable outputs. Keep the original available for authorized re-evaluation when policy permits.

## Acceptance gate

Demonstrate capture -> offline persistence -> inference or queued inference -> human confirmation -> structured record -> evidence review -> correction. Test low light, blur, occlusion, multiple objects, background speech, code-switching, unsupported language, unavailable model, partial upload, repeated inference, and model upgrade.
