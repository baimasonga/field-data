# K3: asset status across a project

Status: next slice chosen under the project owner's delegated authority
("continue", 2026-10-10); details open to revision.

An asset passport (K1) shows one asset's facts with their freshness. A
manager deciding where to send a repair team, or how many water points work,
has to open every passport. K3 is one fact (for example `condition`) across
all of a project's assets at once, decided by the same rules as the passport,
with a count by value that only counts knowledge still current. It is the
first "decision-specific twin projection" of the knowledge row: a table, not
a model.

## What it shows

For a chosen predicate, as of a time (`at`, default now) and with what was
recorded by a time (`knownAt`, default now), each asset of the project:

- its **current fact** for that predicate, chosen exactly as the passport
  chooses it (latest valid-from not after `at`, recorded by `knownAt`, then
  latest sequence), with its value, state, valid-from, source claim version
  and integrity status;
- its **freshness** under the asset-age policy: fresh, review due, expired,
  unknown, source unverified, or **no fact** when none was recorded.

A **summary** counts assets by value **only where the fact is fresh or review
due**; expired, unknown, unverified and missing facts are counted by status
instead, so stale knowledge is never counted as current.

Filters: asset type (optional). The list of predicates recorded in the
project is returned for choosing one.

## Who sees what

`project.read` on the project, and only assets whose form the caller may
read submissions of, as in the asset list. As with a passport, an asset is
left out (and counted) when any of its facts' sources is deleted or in a form
the caller may not read. At most 1000 assets, by name; the response says when
more exist.

## API

`GET /v1/field-data/projects/:projectId/assets/projection?predicate=&assetType=&at=&knownAt=`
→ `{ predicate, at, knownAt, predicates, assets: [{ id, name, externalId,
assetType, xmlFormId, fact }], summary: { byValue, byStatus }, excluded:
{ notReadable, sourceDeleted }, truncated }`. Invalid parameters: the asset
problem (400).

## UI

Review page, after the search: "Asset status across the project": a
predicate picker, optional asset type and "as of" date, the summary, and the
table with each asset's value, freshness and "Open asset".

## Not in this slice

Several predicates at once, maps, aggregation by area, charts over time,
saved projections, export.

## Acceptance

- Unit: summary counting only fresh and review-due values; statuses.
- Integration: current fact per asset as the passport chooses it (later
  valid-from, later recorded, `at` and `knownAt`); freshness statuses
  including expired and no fact; asset type filter; predicates list;
  unreadable form and deleted source leave an asset out; altered source shows
  unverified; permissions; bad parameters.
- Browser: picker, summary and table; "Open asset"; empty and failed loads.
