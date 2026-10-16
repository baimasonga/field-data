# Complete regression gates and chunked rendering

Vue's reactive-array fast paths could unwrap the shortened array used for
chunked rendering. That bypassed the length limit in project/submission lists
and array methods. The view now prevents that unwrap and uses native array
methods over its visible prefix, while indexed values remain reactive. Project
sorting preserves the visible card count when the result membership is unchanged;
search and membership changes still reset chunking.

The nine previously skipped client cases now exercise current behavior: array
methods, project sorting, draft version display, inline draft upload, refreshed
attachments, account names and entity activity updates. The obsolete modal
selectors were replaced with the current inline upload path. The pending server
teardown test now observes the database pool's `end()` method; another test checks
cleanup after a nested task rejects.

The shared gradient CSS is exposed as a private workspace package,
`@field-data/design`, without moving or changing the CSS. The two self-hosted
font packages are runtime dependencies. Import order and font versions are
unchanged. Photograph text follows the existing lint convention. Both source-file
lint exclusions are removed, so all Central client source files are checked.

CI now forbids pending server unit tests and requires the client success summary
without skipped cases. Existing strict zero-failure checks remain in place.
This supersedes the maintenance limitations recorded in
[CLIENT-REGRESSIONS-2026-10-16.md](CLIENT-REGRESSIONS-2026-10-16.md).

The full legacy server integration report still contains obsolete Enketo-era
cases outside the current native-form and feature integration gates. Real-device
acceptance remains the separate pilot activity.
