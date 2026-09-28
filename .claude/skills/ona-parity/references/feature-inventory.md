# Ona feature inventory, and what Field Data already has

Researched 2026-09-20. Sources at the bottom, including what could not be reached.

## How this was gathered, and its limits

`ona.io` and `help.ona.io` both refuse direct fetches from this environment
(the egress proxy answers 403). Two things were reachable and carry most of
the weight here:

- **`raw.githubusercontent.com/onaio/onadata`** — the API documentation
  source for the open-source server that ona.io runs. This is authoritative
  for what the platform can do, because it is the platform.
- **Web search summaries** of the help centre, which describe the same
  features from the user's side rather than the API's.

So the API shapes below are quoted from the product's own docs. The
descriptions of *how a user experiences* a feature come from search
summaries of pages that could not be opened directly, and are correspondingly
softer. Where a decision turns on a detail of the user-facing behaviour,
check the help centre rather than trusting this file.

The premium/pricing boundary is not reproduced here. Some of these are paid
features on ona.io; that has no bearing on whether Field Data should have
them, but it does explain why the public help pages describe some in less
detail than others.

## The API surface

From `docs/index.rst`, the documented endpoint groups:

```
charts          data            dataviews       merged-datasets
widgets         stats           submission_stats entities
forms           formlist        media           metadata
notes           files           projects        submissions
restservices    submission_review
orgs            profiles        teams           user/users
flow-results    onadata-tableau messaging       messaging_stats
```

## Feature by feature, against this codebase

| Ona feature | Field Data today | Gap |
|---|---|---|
| XLSForm authoring | `cloudflare/form-compiler` wraps pyxform | none |
| Web + Android collection, offline | Web Forms + ODK Collect | none |
| Entities / longitudinal | inherited from ODK Central | none |
| Charts from a field | `submission/summary.vue` | none |
| Photo gallery | `submission/photos.vue` | none |
| Maps | ODK's map view | filtering by answer |
| Exports CSV/Excel | inherited | Google Sheets sync |
| Submission review + notes | ODK review states + comments | see below |
| Project-level roles | ODK assignments | orgs and teams |
| Webhooks | `field-data.js` webhooks | typed service targets |
| Stats | `/field-data/stats` | none |
| **Filtered datasets (dataviews)** | — | **absent** |
| **Merged datasets** | — | **absent** |
| **Saved chart widgets** | — | **absent** |
| **Organizations and teams** | — | **absent** |
| **XLS Reports** | — | **absent** |
| Tableau connector | ODK's OData serves the same need | none worth closing |
| Flow Results, messaging | — | niche; ignore unless asked |

Field Data also has things Ona does not: shareable read-only dashboards
(`submission/share.vue`), fieldwork verification
(`submission/verification.vue`), scheduled backups, and a media library.
Parity is not the goal; the gaps above are the ones worth closing because
each answers a question field teams actually ask.

## The four shapes worth copying, quoted

### DataViews — filtered datasets

A saved subset of one form: chosen columns, plus row filters.

```json
{
  "name": "Bombali only, no names",
  "xform": ".../forms/12",
  "project": ".../projects/1",
  "columns": ["district", "hh_size", "submitted_at"],
  "query": [
    {"column": "district", "filter": "=",  "value": "bombali"},
    {"column": "hh_size",  "filter": ">",  "value": "4", "condition": "AND"}
  ]
}
```

Operators: `=`, `>`, `<`, `>=`, `<=`, `<>`, `!=`. `condition` defaults to AND.
The dataview may live in a different project from its form, which is how a
subset gets shared with people who cannot see the whole form. It carries its
own `/data`, `/charts` and export endpoints, so anything built on a form can
be built on a filtered view of it.

### Widgets — saved charts

```json
{
  "title": "Household size",
  "content_object": ".../forms/9929",
  "column": "age",
  "group_by": null,
  "aggregation": "mean",
  "widget_type": "charts",
  "view_type": "horizontal-bar",
  "order": 0,
  "key": "e60c148d19464365b4e9a5d88f52694b"
}
```

`content_object` points at either a form or a dataview — the same widget
machinery works on a filtered subset. `key` is an unguessable public handle,
the same idea as Field Data's dashboard share tokens. `order` is maintained
per form/dataview, so widgets are a dashboard, not a bag of charts.

### Merged datasets

```json
{
  "name": "All 2026 rounds",
  "xforms": [".../forms/12", ".../forms/13"],
  "project": ".../projects/13"
}
```

Read-only by construction: rejects submissions and edits, and exposes only
the fields common to every merged form. Each row carries `_xform_id_string`
so a reader can tell which form it came from. The docs call it experimental.

### REST services — typed integration targets

One endpoint, `restservices`, with a `name` selecting the target:

| Target | Needs |
|---|---|
| `json` / `xml` | `service_url` |
| `google_sheets` | `google_sheet_title`, `send_existing_data`, `sync_updates` |
| `textit` | `auth_token`, `flow_uuid`, `contacts`, `service_url` |
| `dhis2` | `service_url` |
| `bamboo` | `service_url` |

Field Data's webhooks are the `json` row of this table. The shape to copy is
the *typing*: one registry, a named target, per-target required fields.

### Submission review

Statuses are approved / rejected / pending, and **a note is required to
reject**. Field Data's fieldwork verification already applies that principle
to its own findings (a note is required to substantiate). If submission
review is ever revisited, keep the rule.

### Organizations and teams

Five roles: owner, manager, editor, data entry, read only. Members are
managed under `/orgs/{username}/members`. ODK Central has project roles but
no tenant above the project, which is the actual gap.

## Sources

- [onaio/onadata](https://github.com/onaio/onadata) — `docs/index.rst`,
  `dataviews.rst`, `widgets.rst`, `merged-datasets.rst`, `restservices.rst`,
  `orgs.rst`, `submission_review.rst` (fetched via raw.githubusercontent.com)
- [Ona Data](https://ona.io/home/) and
  [Ona Data Help Center](https://help.ona.io/) — via search summaries only;
  both blocked for direct fetch
- [Guide: Introduction to Ona](https://help.ona.io/knowledge-base/guide-new-to-ona/)
- [How to: Create a filtered dataset](https://help.ona.io/knowledge-base/how-do-filtered-datasets-work/)
- [Guide: Entities](https://help.ona.io/knowledge-base/entities/)
- [Glossary: XLS Report (Beta)](https://help.ona.io/knowledge-base/what-is-an-xls-report/)
- [How to: Configure webhooks](https://help.ona.io/knowledge-base/how-do-i-configure-webhooks/)
- [How to: Merge Datasets](https://help.ona.io/knowledge-base/merging-datasets/)
- [Premium Features](https://help.ona.io/article-categories/premium-features/)
