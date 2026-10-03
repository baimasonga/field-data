---
name: field-data-export-formats
description: Implement additional Field Data export formats, especially SPSS SAV, Stata DTA and KML, with statistical metadata and GIS validation. Use for native export-format implementation.
---

# Field Data export formats

## Inspect first

- `central/server/lib/resources/submissions.js`, `geo-extracts.js`
- `central/server/lib/util/filtered-dataset-export.js`, `merged-datasets.js`
- Existing CSV/Excel export, form field extraction and dataset-export tests.

CSV, Excel and GeoJSON already exist. Do not rename an existing CSV file to
`.sav` or `.dta`, and do not promise complete format support from one sample.

## Implementation

1. Define export scope and schema for each source and format: names, types,
   labels, choice coding, dates/timezones, missing values and repeat tables.
   Preserve identifiers that join repeat records to their parent submission.
2. Evaluate maintained, license-compatible writers (including a small Python
   worker using pyreadstat if appropriate). Record supported file versions and
   runtime/image dependencies before wiring a background export job.
3. Generate native SAV and DTA files. Resolve length/character limits through a
   deterministic mapping included in an export manifest; never silently drop a
   field, truncate text, or convert a missing value to zero.
4. Generate valid KML with WGS84 coordinates, supported geometry and properly
   escaped XML/text. Document how repeat geometries and missing locations are
   represented; avoid including sensitive answers by default.
5. Reuse existing authorization and source filters. Stream or queue large jobs,
   provide progress/failure/download states, expiry and storage cleanup. Freeze
   an export's schema/context so an update cannot corrupt a running job.
6. Offer only formats supported for the selected source and explain limitations
   before export. Apply the source's authorized field projection in every writer.

## Acceptance

Read SAV/DTA outputs with an independent reader and compare row counts, labels,
choice coding, missing values, Unicode, long values and dates to source fixtures.
Validate KML structure and coordinates with an independent GIS/XML tool. Include
repeats, empty data, malformed geometries, restricted datasets and large exports.
A successful download or a file extension alone does not establish correctness.

## Working rules

Read `../field-data-implementation/references/engineering.md` before implementation.
Use the current checkout as the source of truth; this skill describes a target,
not proof that the target is absent. Inspect existing code and tests first.
Complete a working vertical slice, run the relevant checks, and report concrete
behavior, validation, and remaining acceptance work. Honor the user's existing
scope and deployment authorization; do not introduce additional approval gates.
