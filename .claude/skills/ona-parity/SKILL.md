---
name: ona-parity
description: Researched inventory of ona.io's platform features, what Field Data already has, and which gaps are worth closing. Use this whenever someone asks what Field Data is missing, asks for a feature by an Ona name (filtered dataset, data view, merged dataset, widget, XLS report, REST service, organization, team), asks how Ona or OnaData does something, or plans roadmap work for this repo — and before starting any of the feature skills it points to, so the design starts from what the platform actually does rather than from a guess.
---

# Ona parity

Ona Data and Field Data are both built on ODK. That shared ancestry is why
Ona is the useful comparison: its features are mostly things that *could*
exist here, on the same data model, rather than a different product's ideas.

Start by reading `references/feature-inventory.md`. It carries the researched
feature list, a table of what this repo already has, and the API shapes
quoted from Ona's own documentation. It also states plainly which parts came
from primary sources and which from search summaries of pages that could not
be fetched — worth knowing before a design decision rests on one of them.

Then read `references/house-style.md` before writing code. It covers how a
feature is built in this codebase: where server routes go, the six edits that
wire a client tab, the migration convention, and a list of gotchas that have
already cost time here. Every feature skill below assumes it.

## Choosing what to build

The inventory names five real gaps. They are not equal:

**Filtered datasets** are the one to build first. Every other gap is a
convenience; this one answers a question teams are blocked on — how do I
show a partner their district's data without showing them names, or the
other districts? Today the only answers are "give them the whole form" or
"export a spreadsheet by hand". It is also the foundation the others want:
in Ona, charts, exports and widgets all work on a dataview exactly as they
work on a form.

**Saved chart widgets** turn the existing one-off summary charts into a
dashboard somebody arranges once and returns to. Cheap, because the charting
already exists.

**Merged datasets** matter when a programme runs the same survey as several
forms across rounds or districts. Ona's own docs call theirs experimental;
treat that as a warning about scope, not a reason to skip it.

**Typed REST services** generalise the webhooks already here. Worth doing
when somebody actually needs Google Sheets or DHIS2 — the abstraction is
not worth building for its own sake.

**Organizations and teams** are the largest change, because ODK Central has
no tenant above the project. Only worth it if Field Data is to host more
than one organisation.

**XLS Reports** were researched but have no skill, because the feature is
mostly an Excel templating engine and the value here is unclear. Read the
inventory entry before deciding.

## The skills

| Skill | Builds |
|---|---|
| `filtered-datasets` | saved column + row subsets of a form |
| `saved-chart-widgets` | persisted, ordered charts over a form or filtered dataset |
| `merged-datasets` | read-only union of forms over their common fields |
| `rest-service-targets` | typed integration targets on top of webhooks |
| `organizations-and-teams` | a tenant above the project, with roles |

## Before you start any of them

Two habits matter more than the code.

**Check the gap is still a gap.** These skills were written against this
repo on 2026-09-20. Grep `central/server/lib/resources/field-data.js` and
`apps/central/src/components/` before assuming something is absent.

**Copy the shape, not the surface.** Ona's dataview query language is a JSON
array of `{column, filter, value, condition}` objects. That shape is worth
copying because it is honest about what it can express and easy to validate.
Its URL structure and Django-era naming are not. When the two conflict,
follow what reads clearly to somebody using Field Data.
