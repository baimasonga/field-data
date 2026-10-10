# K2: cited search across a project's records

Status: proposed to the project owner on 2026-10-10 as the next slice; built
under their delegated authority ("continue"); open to revision.

A supervisor who remembers "the pump at Kissy was broken in August" or "we
explained that duplicate as a shared phone" has no way to find it again
without opening forms one by one. Asset facts (K1), integrity findings and
review decisions each live on their own page. K2 is one search across them,
where **every result cites the submission it rests on**, so an answer can be
checked rather than trusted. It is the "cited retrieval" deliverable of the
knowledge row, first slice: plain text matching, no model, no ranking beyond
recency.

## What it searches

| Kind | Matched on | Cites |
| --- | --- | --- |
| Asset | name, external ID, type | its owning form |
| Asset fact | predicate, value | the claim version (form, instance ID) it was recorded from |
| Finding | rule or key title, explanation, reviewer note | the submission it is about (and the related one) |
| Review decision | reason code, note | the claim version the case is about |

- Case-insensitive substring match; the query is 2 to 100 characters.
- At most 20 results per kind, newest first, with how many more matched.
- Each result returns the matching field and a short excerpt around the
  match (at most 160 characters), never other answers from the submission.

## Who sees what

`project.read` on the project; a result counts only when the caller may read
submissions of every form it involves (an asset fact: the asset's form and
its source form; a finding: its form, and a related submission in another
form is not cited, as on the F2b record).
Withdrawn findings and deleted submissions are left out. App Users see
nothing.

## API

`GET /v1/projects/:projectId/search?q=…` → `{ q, results: { assets, facts,
findings, decisions }, more: { assets, facts, findings, decisions } }`.
Invalid queries: 400.8.

## UI

Review page, after the collector groups: "Search the project's records", a
search box, results grouped by kind, each with its citation linking to the
submission (and the asset or Verification page).

## Not in this slice

Ranking by relevance, synonyms or translation, searching submission answers,
semantic or model-based retrieval, saved searches.

## Acceptance

- Integration: each kind found by its fields with citations; excerpts;
  limits and "more"; a data collector, who may not read submissions, finds
  nothing; withdrawn findings and deleted sources left out; viewers search,
  App Users refused; bad queries.
- Browser: results by kind with citation links; empty and failed searches.
