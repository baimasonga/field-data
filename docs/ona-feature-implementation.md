# Field Data feature additions

These packages implement the targets in the repository's `skills/` bundle.
This is a description of verified Field Data behavior, not a certification of
Ona product parity. Ona's documentation could not be independently fetched in
the development environment.

| Package | Where to use it | Implemented behavior |
| --- | --- | --- |
| Analysis | Data Collection → Analysis | Project/form, filtered and merged sources; a shared filter for table, count/sum/mean/median chart and map; pagination; private saved views and `?project=…&view=…` links |
| Map layers | Analysis → map | Up to 10 project reference layers in durable configured storage; GeoJSON upload/replacement; visibility/order; fit; categorical and fixed numeric bins; missing styles; escaped popups and text alternatives |
| Export formats | Analysis → Export | Native SPSS SAV and Stata 15 DTA, CSV ZIP, XLSX and KML; authorized projection/filter; repeat tables and parent IDs; deterministic names and schema manifest |
| Advanced authoring | Project → New Form → Build a Form → Advanced authoring | Nested group/repeat nodes; calculations; relevant/required/constraint expressions; reusable choice lists and filters; translated labels/hints; draft persistence and reopening stored builder definitions |
| Public catalogue | Data Collection → Public catalogue; anonymous `/catalog` | Explicit preview and publication of approved single-choice aggregate snapshots, licence/attribution, search, detail/download and revocation history |
| Operations | System → Operations | Five-minute database/compiler/storage/backup samples; latencies; consecutive-failure alerts and recovery history; opt-in daily encrypted DB backup queue, retention and storage cleanup |

## Scope and limits

Analysis requires project read and submission read/list access, including the
underlying forms for merged sources. Filtered datasets retain the existing
explicit delegation boundary; hidden base-filter fields are never projected.
Scalar analysis excludes group structures and repeat descendants instead of
silently treating the first repeated answer as the whole answer. Charts cap
categories honestly and show contributing counts. Means/medians never combine
into a summed Other value. The map explicitly shows the current page, not the
entire dataset. Saved views are personal; links do not grant access.

Reference layers accept WGS84 GeoJSON without a CRS declaration, at most 2 MB,
5000 features and 50000 vertices. Only scalar properties are allowed. Uploaders
must keep personal submission values out of reference properties, which project
readers can see. Remote WMS/credentialed tile sources are outside this release.
Editors need project.update; readers need project.read. Replacements and removals
queue old object keys for deletion after one hour by the operations worker.

Exports are synchronous and bounded: at most 5000 parent submissions, 20 MB of source XML, a 24 MB
internal request and a 64 MB generated download. Add filters for larger sources.
No export file is retained on the server. The repeat-export checkbox includes all authorized repeat fields alongside the selected scalar columns; disable it to export only the scalar selection. Each repeat table retains record_id,
parent_id, instance_id, source_form and submitted_at; nested repeat parent IDs
join to their immediate parent. CSV/native formats are ZIPs with a manifest;
XLSX includes repeat sheets and a manifest sheet. Source choice names are strings,
not invented numeric codes; multiselect values retain their original tokens.
Native variable labels are capped at 80 characters with full labels in the
manifest. UTC dates become native date/datetime columns; blanks become numeric
system missing, never zero. Invalid numbers/dates and unsafe precision fail the
export. Spreadsheet-active text is escaped in CSV/XLSX. KML contains scalar
geopoints and submission identifiers, excludes answer properties, and reports
invalid/missing coordinates; repeat geopoint selection is outside the scalar
analysis surface.

Advanced definition schemaVersion 2 is separate from old editable definitions.
The server validates names, nesting and field references; PyXForm 4.5.0 remains
the compiler. Expressions are XLSForm XPath, never evaluated JavaScript. Choice
attributes and translations use JSON controls alongside the nested question UI.
Local drafts are scoped to the signed-in user/project in sessionStorage. A
snapshot is frozen for compilation and the matching saved definition. The
ordinary created draft supplies Central's compiled preview and publish/version
workflow. Arbitrary uploaded forms without a saved definition remain editable
through XLSForm download/upload, not guessed reverse conversion.

Catalogue releases contain one approved nonrepeating single-choice distribution.
Every approved category must have at least five records, otherwise the entire
distribution is withheld. Unknown categories block preview; totals, missing-answer
counts, Other buckets, raw rows, free text, media and location values are absent.
Public metadata is supplied explicitly rather than inherited from private
project/form names. Publication requires project.update plus source read rights,
a fresh preview hash and product confirmation. Responses are bounded and rate
limited, carry no-store, and query published records directly. Unpublish closes
the URL and discovery immediately; files already downloaded cannot be recalled.
A release is immutable: revoke and preview a new snapshot to change it. This
single-field threshold policy does not replace an organization's assessment of
sensitive categorical data or disclosure across multiple public releases.

## Evidence

- Real PostgreSQL API checks cover empty selections, unauthorized sources,
  hidden fields, repeat exclusion, native export, private retry-safe views,
  layer persistence/stale writes, catalogue default privacy/preview/revocation,
  and privileged operations policy.
- Python acceptance reads DTA with pandas, reads uncompressed SAV with a separate
  minimal system-file reader, and parses KML with ElementTree. Fixtures include
  Unicode, dates, missing numbers, repeat parent joins, empty files and formula
  injection. The reader is an acceptance fixture, not a general SPSS reader.
- Basic and advanced definitions round-trip through XLSForm, real PyXForm and
  Central's parser. Collect/device and organization-specific multilingual pilots
  remain separate acceptance.
- Browser checks use the actual local API for analysis/saved views/layer upload
  and removal, operations policy controls, anonymous discovery and advanced
  builder XLSForm download/draft persistence.
- An isolated encrypted recovery drill compared all 87 fixture database tables
  and two fixture files by row/file hashes; all matched. Local elapsed recovery
  was about 21 seconds with no concurrent writes. This is not a production RTO.
- A local compiler outage opened one alert after three failed checks; further
  failures did not duplicate it, and restart recorded a recovery.

CI runs the feature API suites, native-writer acceptance, both builder round trips
and the frontend production build. See [operations runbook](operations-runbook.md)
for deployment, recovery and provider acceptance that code cannot establish.
