---
name: saved-chart-widgets
description: Turn Field Data's one-off summary charts into saved, ordered, shareable dashboard widgets over a form or a filtered dataset — the feature Ona calls widgets. Use this whenever someone wants to save a chart, pin or arrange charts into a dashboard, keep a chart they built, group one field by another (average household size by district), add a chart to a shared link, or asks for "widgets", "saved charts", "a dashboard I can come back to", or charts over a filtered dataset. Read it before adding chart persistence, because the ordering, aggregation and public-key decisions are easy to get wrong and expensive to change later.
---

# Saved chart widgets

The Summary tab already computes charts for a form. They are computed fresh,
shown once, and cannot be arranged, kept, or sent to anybody. A widget is the
same chart made durable: somebody chooses a field, gives it a title, puts it
in an order, and comes back to it — or sends it to a colleague.

Read `.claude/skills/ona-parity/references/house-style.md` for wiring, and the Widgets
section of `.claude/skills/ona-parity/references/feature-inventory.md` for Ona's shape.
Before writing any chart code, read the `dataviz` skill; the chart form,
palette and accessibility rules there are not optional and this repo already
follows them.

## What already exists here

Reuse rather than rebuild:

- `apps/central/src/components/chart/bars.vue` and `chart/trend.vue` — the
  chart components, already built to the design system.
- `submission/summary.vue` and `summarizeForm` in
  `lib/resources/field-data.js` — the aggregation, including the XPath
  extraction and its path allowlist.
- `field_data_dashboards` and `submission/share.vue` — an existing, working
  answer to "give somebody a read-only link", with a SHA-256 token, a hint
  for display, expiry, revocation and a view count.

That last one matters. Ona gives each widget its own public `key`. **Do not
add a second, parallel sharing mechanism.** Field Data already has one, and
two token systems means two places to get revocation wrong. Attach widgets to
the existing shared dashboard instead, so revoking the link revokes
everything on it.

## Schema

```
field_data_widgets
  id, title, description,
  "formId", "filteredDatasetId",   -- exactly one is set
  column        text   -- field path, validated against form_fields
  "groupBy"     text   -- optional second path; must differ from column
  aggregation   text   -- count | sum | mean | median
  "viewType"    text   -- bar | horizontal-bar | line | table
  "order"       integer
  metadata      jsonb
  "createdBy", "createdAt"
```

`exactly one of formId / filteredDatasetId` is worth a database constraint
rather than a comment. A widget over a filtered dataset must inherit that
dataset's column restrictions — if `filtered-datasets` is not built yet,
leave the column null and add the constraint when it is, rather than allowing
a widget that quietly reads a hidden field.

## The three decisions that are hard to change

**Ordering.** Keep `order` contiguous per parent and renumber on insert and
delete. If gaps are allowed to accumulate, every later feature — drag to
reorder, insert above, duplicate — has to cope with them. Renumbering in one
transaction at write time is a few lines; retrofitting it is not.

**Aggregation honesty.** `mean` over a field where a quarter of submissions
are blank is not the mean anybody will assume. Carry the denominator with the
result and show it: "mean 4.2 across 318 of 412". The existing summary
endpoint already faces this and the verification tab already reports coverage
before findings; follow that instinct. A number that hides how much data it
rests on will be quoted in a report.

**Group-by cardinality.** Grouping by a free-text field produces four hundred
bars and a useless chart. Cap the groups, order by count, and say what was
left out — "top 12 of 47 districts" — rather than truncating silently. Never
let `groupBy` equal `column`.

## Endpoints

```
POST   /projects/:projectId/forms/:xmlFormId/widgets
GET    /projects/:projectId/forms/:xmlFormId/widgets?data=true
PATCH  /projects/:projectId/forms/:xmlFormId/widgets/:id
DELETE /projects/:projectId/forms/:xmlFormId/widgets/:id
PATCH  /projects/:projectId/forms/:xmlFormId/widgets/order
```

`?data=true` computes and includes the chart data; without it the list is
just the definitions, which is what an editor needs while dragging. Give
reordering its own endpoint taking the whole ordered list — reordering by
patching each widget's `order` one at a time races with itself.

## Client

A tab that lists the widgets and lets somebody add, title, reorder and remove
them. Reuse the existing chart components; the new work is the editor and the
arrangement, not the drawing.

Two details worth the effort: show the widget's title and its coverage
together, so the chart never appears more authoritative than its data; and
make an empty state that explains what a widget is, because a blank tab with
an "Add" button teaches nobody what they are for.

## Verifying

Unit-test the aggregation and the group-capping as pure functions. Test that
reordering stays contiguous across insert, move and delete. Render at 1440
and 390 and look at the charts — this repo has already shipped a chart that
drew 393 above 412, which only a human eye caught. Then state what has not
run against real submissions.
