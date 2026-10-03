---
name: field-data-public-catalog
description: Implement opt-in public discovery of Field Data projects and safely published datasets, including previews, licensing and revocation. Use for public catalogue implementation.
---

# Field Data public catalog

## Inspect first

- Existing `/field-data/shared/:token` and `/field-data/public/report/:token` routes.
- `central/client/apps/central/src/components/field-data/public-report.vue`
- `central/server/lib/util/summary-fields.js` and `docs/security-review-2026-09.md`
- Organization permissions, filtered datasets and share revocation behavior.

Existing share links are not a public catalogue. Public discovery must not make
existing projects, raw submissions, media, evidence or shares public implicitly.

## Implementation

1. Add an explicit publication record owned by an authorized project/form owner.
   Default to unpublished. Save a versioned allowlist of public metadata, fields,
   aggregation rules, licence and attribution; do not publish on project creation.
2. Separate catalogue metadata from released data. An owner previews the exact
   anonymous response and confirms publication in the product interface. This
   is a product feature, not an additional agent approval requirement.
3. Reuse disclosure thresholds for aggregates; suppress rare categories and
   unsafe Other buckets. Address sensitive combinations, free text, media and
   precise locations. Any raw-row publication needs an explicit release policy
   and separately approved fields, not just a share token.
4. Build browse/search/project detail views and explicit download terms. Index
   only published material. Avoid search snippets or counts revealing private
   records. Make licences and update dates visible.
5. Provide unpublish, revoke and audit history. Ensure direct URLs, exports,
   indexes and cache invalidation respect revocation. Explain that previously
   downloaded public files cannot be recalled.
6. Add rate limits, bounded searches, cache policy and anonymous access tests
   using the same public-response builder as preview and downloads.

## Acceptance

Nothing becomes public by default. Preview and anonymous output match. Private
metadata, single-person answers and restricted fields stay inaccessible through
search, downloads, old links and caches. Tests cover unauthenticated requests,
owner permission, publication edits, suppression, revocation and stale indexes.
Use synthetic public fixtures; never publish actual project data as a test.

## Working rules

Read `../field-data-implementation/references/engineering.md` before implementation.
Use the current checkout as the source of truth; this skill describes a target,
not proof that the target is absent. Inspect existing code and tests first.
Complete a working vertical slice, run the relevant checks, and report concrete
behavior, validation, and remaining acceptance work. Honor the user's existing
scope and deployment authorization; do not introduce additional approval gates.
