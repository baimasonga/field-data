# Review a draft against an earlier published version

On a form's Draft page, **Changes from the published version** initially compares the draft with the current published version. Select **Choose an earlier version** to compare the draft with any available published version, including a version without a version string. The list and report use the existing form-read permission and comparison API. Each comparison checks the returned draft and baseline definition hashes against the versions shown; a changed or unavailable definition clears the displayed result and asks the author to refresh.

The publish dialog's meaning-change warning always comes from the current-published comparison. Selecting a historical baseline does not replace that warning. Results from slower earlier requests cannot replace a newer selection. These reports are advisory; matching paths do not establish semantic equivalence and the comparison does not approve, modify, or publish a form.

## Portable review snapshot

**Download changes JSON** saves the currently displayed comparison as
`survey-draft-changes.json`. The `survey-draft-change-review@1` wrapper records
the project and form, export time, whether the baseline was current or historical,
and the original comparison with both definition hashes, versions, summary,
change details and truncation flag. The export is disabled while comparing,
after a failed comparison, or when there is no published baseline.

This is an advisory snapshot for sharing and review, not a signed approval or
proof that either definition remains current. Truncated comparisons retain that
limitation; export does not fetch omitted changes. It contains schema and logic
details from the authorized comparison, so authors should share it accordingly.
Browser regression coverage downloads current and historical reports, checks
their exact contents and confirms a failed refresh disables export.
