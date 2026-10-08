---
name: field-data-analysis-workspace
description: Implement a unified Field Data analysis workspace with shared filters, tables, charts, maps, saved views and existing dataset integrations. Use for analysis-workspace implementation, not generic dashboard repairs.
---

# Field Data analysis workspace

## Inspect first

- `central/client/apps/central/src/components/field-data/explore.vue`
- `central/client/apps/central/src/components/submission/widgets.vue`
- `central/client/apps/central/src/components/project/merged-datasets.vue`
- `central/client/apps/central/src/components/submission/filtered-datasets.vue`
- `central/server/lib/util/widgets.js`, `merged-datasets.js`, `filtered-datasets.js`
- `central/server/lib/resources/field-data.js` and `field-data-workspaces.js`

Charts, saved widgets, filtered datasets and merged datasets already exist.
Integrate them; do not rebuild their query or permission model.

## Implementation

1. Define supported sources: form, filtered dataset and merged dataset. Preserve
   source identity and field provenance when switching views.
2. Add one Analysis route with source selection and table/chart/map tabs. Use a
   single typed/validated filter contract for all tabs, counts and exports.
3. Extend the current widget aggregations (`count`, `sum`, `mean`, `median`) only
   when a requested chart needs it. Preserve answered/total denominators, missing
   data counts, and the documented grouping of excess categories into Other.
4. Persist saved views with a versioned source/filter/layout definition, ownership,
   and the existing permission model. Restore selections from a deep link; show
   a repairable state if a source or field disappears.
5. Use pagination/streaming and database aggregation. Prevent old requests from
   replacing a newly selected source or filter. Clearly distinguish an empty
   result from a failed or unauthorized request.
6. Make charts keyboard usable, label their units and denominators, provide a
   table/text alternative, and verify desktop and narrow layouts.

## Acceptance

The same filter produces consistent rows, chart counts, mapped records and
exports. A saved view survives reload. A reader of a restricted dataset cannot
recover excluded columns through grouping, tooltips, saved definitions or export.
Browser checks cover source switching, stale responses, empty/error states,
saved-view recovery and restricted access. Existing widgets and dataset pages
continue to work. Test real database aggregation separately from API fixtures.

## Working rules

Read `../field-data-implementation/references/engineering.md` before implementation.
Use the current checkout as the source of truth; this skill describes a target,
not proof that the target is absent. Inspect existing code and tests first.
Complete a working vertical slice, run the relevant checks, and report concrete
behavior, validation, and remaining acceptance work. Honor the user's existing
scope and deployment authorization; do not introduce additional approval gates.
