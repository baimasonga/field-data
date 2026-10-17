# F10: generated investigation response-form drafts

Managers can generate a starting response form from the selected finding templates
in a linked case's targeted backcheck panel. It opens in the ordinary advanced
builder for review and editing, compiler validation, XLSForm download and draft
creation. Publishing the draft and granting collectors access remain explicit
steps in Central. A published form can then be selected for a normal F9 request.

## Generated schema

Up to 20 supported, active primary-source findings use the same selection and
privacy rules as F9. Duplicate question templates are combined. The generated
advanced definition has a unique new form ID, a neutral editable title and at
most 12 fields: an introduction, required participation consent, refusal note,
optional visit date, optional text answers for the selected checks, and notes for
corrections, uncertainty and legitimate explanations. All verification answers
are relevant only after consent. A refusal remains a valid submission.

A location-related selection also adds a separate optional location-permission
question and a geopoint relevant only when both participation and location
permission are yes. No location, image, audio or device metadata is captured by
default. Non-location selections generate no geopoint. These are editable defaults;
reviewers remain responsible for their final form and local requirements.

No recorded answers, finding IDs, source/peer identities, investigation title,
case references or evidence snapshots are embedded in the distributed schema.
Generation uses fixed F9 templates, independently of the edited visit instructions.
The manager reviews and edits field labels in the builder. Generated forms do
not infer semantic mappings to the original form; comparisons start unmapped.

## API, permissions and state

`POST /projects/:projectId/investigations/:id/cases/:linkId/instrument/form-definition`
accepts exactly `{investigationRevision, caseRevision, templateVersion, findingIds}`.
It returns `{templateVersion, definition}` with private/no-store caching. The
instrument GET adds `canGenerateForm`, separate from reviewer dispatch eligibility.

Generation requires a live project manager with source read and project form-create
grants, an active link, an open/unarchived investigation/project, and a current
open/in-review case. The case need not be assigned to the author. Source and form-
create grants, selected findings, and both revisions are rechecked under locks.
Stale revisions fail 412; withdrawn/resolved/unrelated/out-of-batch findings are
refused. Removed links, deleted sources and revoked read access are unavailable.

Generation is stateless: no form, request, assignment, disposition or history event
is written. A repeated generation makes a new unique starting ID but creates no
server artifact. The ordinary builder subsequently writes the XLSForm, validates
with PyXForm/ODK Validate, uploads it through the standard form endpoint without
`publish=true`, and saves the reviewed builder definition. Creation/publication
and duplicate-ID errors keep the existing Central contracts; there is no automatic
upload retry or overwrite. Native upload/audit records govern created drafts.

The embedded builder receives an explicit initial definition and disables local
draft persistence. It neither reads, overwrites nor deletes the author's existing
project builder draft. Unsaved generated edits stay in the current inspection;
XLSForm download or draft creation preserves work. Refresh or access denial clears
the generated review with its parent inspection. Old responses cannot reopen it.
Once saved, the new form has its own ordinary permissions and lifecycle.

After creation the UI links to the draft for review/publication. Collectors cannot
download it until publication and an explicit App User grant. Refreshing the
instrument then offers the published form and its eligible independent collectors.
No request or collector permission is created automatically.

## Acceptance and limits

Unit and PostgreSQL tests cover schema consent/relevance/optional capture,
deduplication, privacy, actual XLSForm output, selection/revision checks,
form-create/source grants, closed/archive/historical/removed sources and generation
without database mutation. A coordinated concurrent integrity-writer test checks
the finding-before-case lock order and rejects a newly withdrawn selection. Browser coverage exercises editing, native draft upload,
compiler diagnostics, existing local draft preservation, access denial and 320px
layout, alongside normal builder and investigation regressions.

A required real-compiler integration test creates the generated XLSForm as an
unpublished draft, verifies it is absent from the collector list, publishes it,
verifies explicit collector assignment is still required, collects a refusal
response and links/compares it through the native backcheck workflow.

Automatic publication, existing-schema evolution, field equivalence inference,
peer-side targeting, multilingual prompts, calibrated triage and effectiveness or
device acceptance remain separate work. This is a bounded fraud-intelligence
instrument generator, not completion of the adaptive-survey or eight-area programme.
