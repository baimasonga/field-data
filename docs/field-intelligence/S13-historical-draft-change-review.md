# Review a draft against an earlier published version

On a form's Draft page, **Changes from the published version** initially compares the draft with the current published version. Select **Choose an earlier version** to compare the draft with any available published version, including a version without a version string. The list and report use the existing form-read permission and comparison API. Each comparison checks the returned draft and baseline definition hashes against the versions shown; a changed or unavailable definition clears the displayed result and asks the author to refresh.

The publish dialog's meaning-change warning always comes from the current-published comparison. Selecting a historical baseline does not replace that warning. Results from slower earlier requests cannot replace a newer selection. These reports are advisory; matching paths do not establish semantic equivalence and the comparison does not approve, modify, or publish a form.
