# UI consistency and feature discovery

The authenticated shell uses shared type hierarchy, spacing, surfaces, focus
states, controls and mobile navigation. Dedicated refinements cover Projects,
Form workspaces, submission data tables, map inspectors and record detail.

Verification & planning is now a primary Form tab. Project cards link directly
to it only for published forms under the existing read permissions. Drafts
remain editable without offering unavailable verification. The read-only
viewer can enter verification; a collector without submission-list/read
permissions cannot. Existing route and server authorization still apply.

Projects provide case-insensitive, trimmed local search of active project
names, clear results and reset. Archived projects remain in their separate
section. Sorting and form/entity expansion stay available. Mobile cards
expose metric labels and status rather than overflowing a wide table. The
summary is compact, Active projects excludes archived projects, and a failed
team-count request displays Unavailable rather than inventing zero.

The Needs review count is the sum of received, has-issues and edited
submissions. Its link filters all three states, matching the displayed count.

Sampling, allocation and availability keep visible identities while loading
or unavailable, with independent retry. Calendar access no longer depends on
loading the allocation policy, and allocation no longer depends on loading
samples. Failures cannot silently remove those capabilities from the page.

## Page coverage

Responsive and keyboard checks cover Projects, Users, Account, Audits,
Dashboard, Form Builder, Templates, Catalogue, Analysis, Explorer, Media,
Cases, Assignments, Cleaning, Teams, DHIS2, Webhooks, Backups, Operations and
Reports at desktop and 320px. Separate workflows cover Form data navigation,
Verification/planning, sampling, allocation, calendars, submission records,
map inspectors and the companion fieldwork/offline page. These checks verify
layout and interaction using fixtures, not live production-data acceptance.

The reusable visual standard also applies to other authenticated subpages.
A page-specific redesign of every historical settings screen and exhaustive
review of every possible form schema remain distinct from this consistency
pass; new feature interfaces must follow this same standard.
