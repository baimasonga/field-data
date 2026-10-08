---
name: field-data-advanced-form-builder
description: Extend the Field Data browser form builder with repeats, cascading choices, calculations, relevance and constraints while preserving XLSForm/pyxform compatibility. Use for advanced visual form authoring.
---

# Field Data advanced form builder

## Inspect first

- `docs/form-builder.md`
- `central/client/apps/central/src/components/form/builder.vue`
- `central/server/lib/util/xlsform-builder.js`
- `/form-builder/xlsform` and `/builder-definition` routes in `field-data.js`
- `central/server/test/xlsform/roundtrip.js`, `cloudflare/form-compiler/`

Advanced uploaded XLSForms already work. The gap is browser authoring. Continue
emitting XLSForm into the ordinary upload/draft/publish flow; do not create a
second form compiler or alter Collect's publishing protocol.

## Implementation

1. Version the builder definition. Read old definitions without losing labels,
   question names, choice lists or editability. Do not infer an editable builder
   definition for arbitrary uploaded XML/spreadsheets unless round-trip fidelity
   is demonstrated; preserve download/upload as the fallback.
2. Add nested groups and repeats with stable question identifiers, valid names,
   balanced begin/end rows and safe reorder/delete behavior.
3. Add relevance/skip logic, required expressions, constraints/messages and
   calculations. Use explicit supported expression syntax and field references;
   never evaluate arbitrary author input as JavaScript or server-side code.
4. Add choice filters/cascading selects, multilingual labels/hints and reusable
   lists. Make expression dependencies visible and flag broken references when
   a question is renamed, moved or deleted.
5. Generate the correct survey, choices and settings sheets. Keep pyxform as
   the authoritative validator and map its diagnostics back to builder fields.
6. Preserve draft edits and provide XLSForm download plus a real compiled-form
   preview. Validate publish behavior against the existing form-version rules.

## Acceptance

Round-trip definitions through XLSForm, pyxform and Central's parser. Inspect
repeats, names, relevant/constraint/calculation expressions, cascading filters and
language columns. Verify sample answers in a real browser form; a Collect device
pilot remains separate acceptance. Old definitions still open. Unsupported forms
are downloadable and clearly identified, not silently rewritten or simplified.

## Working rules

Read `../field-data-implementation/references/engineering.md` before implementation.
Use the current checkout as the source of truth; this skill describes a target,
not proof that the target is absent. Inspect existing code and tests first.
Complete a working vertical slice, run the relevant checks, and report concrete
behavior, validation, and remaining acceptance work. Honor the user's existing
scope and deployment authorization; do not introduce additional approval gates.
