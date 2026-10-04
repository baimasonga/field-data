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
| Advanced authoring | Data Collection → Form Builder → Project → Open Advanced Form Builder | Nested group/repeat nodes; calculations; relevant/required/constraint expressions; reusable choice lists and filters; translated labels/hints; draft persistence, reopening stored builder definitions, dependency references, and field-linked compiler diagnostics |
| Public catalogue | Data Collection → Public catalogue; anonymous `/catalog` | Explicit preview and publication of approved single-choice aggregate snapshots, licence/attribution, search, release and approved project detail/download, and revocation history |
| Operations | System → Operations | Five-minute database/compiler/storage/backup samples; latencies; consecutive-failure alerts and recovery history; optional alert delivery with retries; external monitoring; configurable operator/targets; opt-in daily encrypted database or recovery bundles, retention and cleanup |

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

Immediate exports are bounded: at most 5000 parent submissions, 20 MB of source XML, a 24 MB
internal request and a 64 MB generated download. Add filters for larger sources.
Immediate exports are not retained. Queued exports snapshot up to 100,000 parent submissions and 200 MB of XML, process native parts in batches, and retain the result for 24 hours. The outer ZIP manifest records each part and its parent count. Progress, failures, removal, and download are available in Analysis. Downloads recheck source permissions and the filtered delegation boundary. Each job has a 30-minute processing limit and 1 GB output limit. The repeat-export checkbox includes all authorized repeat fields alongside the selected scalar columns; disable it to export only the scalar selection. Each repeat table retains record_id,
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

## Completion verification and production configuration

The sidebar Form Builder opens advanced authoring without requiring users to discover the upload tabs. Projects are restricted to those granting form.create, and server authorization remains authoritative. Keyboard users can also switch the Create Form tabs.

The completion API tests cover populated form/filtered/merged analysis, real compiler validation, a 5,101-parent queued native export, ownership, delegation changes, removal cleanup, and retry-safe alert delivery. Browser regression tests cover dashboard, review, stale analysis responses, reload of saved selections, catalogue project selection, builder discovery, dependencies, and real compiled form answers.

Alert delivery defaults off. Configure FIELD_DATA_ALERT_DELIVERY_ENABLED, FIELD_DATA_ALERT_WEBHOOK_URL and optionally FIELD_DATA_ALERT_WEBHOOK_SECRET securely before enabling an authorized destination. The external-monitor workflow requires repository variable FIELD_DATA_MONITOR_BASE_URL; authenticated checks additionally require FIELD_DATA_MONITOR_EMAIL and FIELD_DATA_MONITOR_PASSWORD secrets. Monitoring notification configuration is separate; see the workflow. Operator and service targets must be supplied by the organization; configured targets are not measured guarantees.

Complete recovery bundles hold a consistent PostgreSQL snapshot and include durable reference objects and externally stored core attachments, with file hashes and table row fingerprints. Limits are 8 GB and 25,000 objects. Secret values are excluded and require secure escrow. Run tools/verify-recovery-bundle.py against a disposable test Docker database to decrypt, validate files, restore the database, compare row fingerprints, and remove the drill database. Production object-provider restoration, credentials, attachment-link checks, and operator acceptance remain required before a production cutover. No production restore or notification is performed by these tests.

## Background map requests

Explorer and Analysis use browser requests to `https://tile.openstreetmap.org/{z}/{x}/{y}.png` with OpenStreetMap copyright attribution and an explicit `strict-origin` image referrer policy. This identifies the application without sending project paths or query parameters. Requests use normal browser caching; the app does not proxy, prefetch, or automatically retry rejected tiles. A tile failure removes the background layer, preserves submitted/reference geometry, and offers a manual retry. Provider availability remains external to Field Data.

Explorer point maps show only finite WGS84 coordinates supplied with submissions and fit their actual extent. A district name does not supply a GPS coordinate. With no valid locations the point map shows an empty state and requests no tiles; the separate district summary still shows aggregate district counts. Browser tests cover origin-only referrers under the production `same-origin` document policy, denied tiles, retry, retained point overlays, and missing GPS.
