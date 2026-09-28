# Adaptive runtime contract

## Version bundle

Include instrument ID/version, schema version, canonical variable dictionary, language resources, expression bytecode or AST, adaptive-policy version, compatibility map, integrity hash, signing metadata, minimum client version, and effective window.

## Decision log

For each navigation decision record session ID, state hash, policy version, input variable IDs, decision type, selected question/branch, reason code, model version if used, timestamp, and offline/online mode. Avoid recording unnecessary raw sensitive values in logs.

## Response envelope

Store canonical variable ID, raw response, normalized response, unit, provenance, uncertainty class/value, source evidence IDs, captured-at, actor, device, edit history, and instrument version.

## Compatibility

Maintain mappings for renamed variables, recoded options, split/merged questions, unit conversions, and derived indicators. Mark changes as fully comparable, comparable with transform, partially comparable, or not comparable.

## Failure behavior

If an adaptive model is unavailable, fall back to an approved deterministic path. If the version bundle is invalid, prevent new sessions but allow safe completion of already-started sessions using the previously verified bundle.
