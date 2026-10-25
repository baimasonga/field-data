# S5: approved recodes in the analysis workspace

The analysis table, numeric/categorical charts and full-selection map can now
apply the same approved version-bound recodes as analysis exports. Path rules
fill an absent/empty current question from its earlier path; value rules then
map stored codes once, token by token for multiple-choice questions. Present
current answers are preserved. Repeat rows remain separate and retain their
index; moved-question rules remain outside repeats.

The workspace toggle refreshes the displayed result and is stored in a saved
view. New UI selections enable recodes; old API requests and saved definitions
without an explicit preference retain stored-answer behavior. Filters always
select stored answers before recoding, matching the existing export semantics.
The UI states this distinction. Submissions, claim versions and native Central
CSV/OData are not rewritten. Geometry can be recoded even when it is not a
visible table column.

Active rule IDs are fixed at query preparation. Rules are append-only, so a
retirement during the query cannot change the frozen overlay between rows,
charts and maps. Only displayed/map fields enter that overlay. A lookup index
supports frozen IDs without requiring that a rule still be active later in the
request. Metadata describes enabled scoped rules, not a count of answers changed.
Exports continue applying frozen rules once in the export writer.

Delegated filtered datasets retain their current field/record boundary.
Moved-question rules are withheld from both screen queries and exports in this
scope; only visible value rules can be applied. Export manifests exclude rules
for unprojected fields and earlier private paths. The screen states how many
moved rules were skipped. Full source permissions remain necessary for a moved
source question. Recode payload limits remain in effect, including corruption
that bypasses the normal per-form API limits.

XML text extraction now returns actual text, rather than XML entity spellings.
For example stored `a&b` previously appeared as `a&amp;b`, causing a filter or
recode to disagree with the export writer. XMLTable extracts the first text node
without flattening repeated records; fixtures cover this correction. Vue still
escapes displayed answers.

The rule editor keeps the add panel open while its inputs change, rejects stale
scope responses, prevents duplicate busy writes and exposes a reload action
for errors. Browser tests cover multiple rules added in sequence, read-only
permissions, saved recode preference, scope messages and mobile width.

Database tests cover scalar/multiple codes, path/value order, preserving current
answers, stored filter selection, numeric totals, repeat indexes, moved map
points outside visible columns, retirement, opt-out, delegated exports, XML
entities and avoiding duplicate export recoding. Existing import/delegation
regressions run with these changes. Native Central exports/OData, approved
adaptive policies, conversational collection and field acceptance remain pending.

[S6](S6-native-csv-value-recodes.md) subsequently adds opt-in native CSV ZIP value rules; native moved questions and OData remain pending.
