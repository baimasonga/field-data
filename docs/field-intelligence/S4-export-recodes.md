# S4: recode rules for exports across form versions

Status: next slice chosen under the project owner's delegated authority
("continue with your implementation", 2026-10-11), following S3; details open
to revision.

S3 lists what changed between versions of a form and which changes break
comparability. S4 lets a project manager record how answers from earlier
versions line up with the current one, so that an export spanning several
versions puts comparable answers in one column with one set of codes. Rules
are written by people, kept, and stated in every export that uses them; the
submissions themselves are never changed.

## Rules

A rule belongs to one form and names the **published versions** it applies to
(by version string). Two kinds:

- **Value**: for a question in the current version, a map from old stored
  values to new ones (`{ "borehole": "bh" }`). For a multiple-choice question
  each selected value is mapped on its own. Values not in the map are kept.
- **Path**: for a question in the current version, the path it had in the
  listed versions (`/data/age` → now `/data/member/age`). When a submission
  from one of those versions has no answer at the current path, the answer at
  the old path is used. Only for questions outside repeats, at both paths.

A rule has a reason. Rules are append-only; a rule can be retired (with a
reason), after which it is no longer applied. At most 200 active rules per
form, 200 values per value rule; values up to 200 characters.

A rule is refused (400.64) when: the question is not in the current version
(or is a group or repeat); a listed version is not a published version of the
form, or is the current version itself; a path rule's old path is inside a
repeat or is the same as the new one; a value rule maps a value to itself or
is empty; or an active rule of the same kind already covers the same question
and version (409.42).

## Where rules apply

- **Analysis exports** (CSV, Excel, SPSS, Stata, KML), direct and queued:
  each row is matched to the version of the submission's current definition,
  and that version's active rules are applied, path rules first, then value
  rules. The export's manifest lists every rule applied (ID, kind, question,
  versions, mapping or old path) and how many answers each changed. A request
  can ask for `recodes: false` to export answers exactly as stored; the
  manifest then says so.
- Queued exports freeze the rules with the rows when the job is created, so a
  later rule change does not alter a job in progress.
- Not applied (stated in the UI): Central's own CSV and OData downloads,
  filtered-dataset downloads, the analysis table on screen, charts and maps.
  Repeat-scope exports apply value rules only.

## API

Under `/v1/projects/:projectId/forms/:xmlFormId/recodes`:

- `GET` (`form.read` and `submission.read`): active and retired rules, and the
  form's published versions.
- `POST` (`form.update`): `{ kind, path, fromPath?, versions, values?, reason }`.
- `POST /:recodeId/retire` (`form.update`): `{ reason }`.

## UI

Form **Versions** tab: **Recode rules for exports**: the active rules with
versions, mapping and reason; "Retire"; and a form to add a rule (choose the
question, the versions and either the old path or old → new values).

## Not in this slice

Recodes in Central's own exports and OData, the on-screen analysis, merged and
filtered datasets; recoding labels (only stored values); derived variables;
rules suggested automatically from S3 changes.

## Acceptance

- Unit (Python writer): value and path rules by version, multiple choice,
  values not in the map kept, path used only when the current path is empty,
  manifest counts, `recodes: false`.
- Integration: create, list, retire, every refusal, permissions; a direct and
  a queued export over submissions from two versions with rules applied and
  in the manifest; a rule retired after a job was queued still applies to that
  job; `recodes: false`.
- Browser: rules listed, add and retire.

## Validation evidence

Locally, against real PostgreSQL 16 and the real Python export writer:

- Python writer: 5 tests in `cloudflare/form-compiler/test_data_exports.py`:
  - rules apply only to their form and versions;
  - each selected value of a multiple choice is mapped on its own, and values not in the map are kept;
  - a path rule fills only an empty answer, never replacing one at the current path;
  - repeat tables and repeat-scope exports apply value rules;
  - `recodes: false` exports answers as stored;
  - the manifest records the changed counts.
- Integration: 5 tests in `test/integration/api/field-data-export-recodes.js`:
  - create, list and retire rules;
  - 18 kinds of refusal (400.64), plus a clash with an active rule and retiring twice (409.42);
  - append-only enforced in the database;
  - permissions;
  - a direct CSV export over two versions with recoded values, moved answers, a recoded repeat and the manifest;
  - `recodes: false`;
  - a queued export keeping a rule retired after it was queued, and each row's form version.
- The migration is in the rollback chain test. The existing analysis, export-job and repeat-scope export tests pass with the changed row query.
- Browser: 2 tests:
  - rules listed;
  - a value rule and a moved-question rule added, with the request bodies checked;
  - the question list leaving out groups, metadata and, for moves, repeats;
  - a malformed mapping line explained and not sent;
  - retire;
  - narrow width;
  - read-only for people who cannot change the form.
- Deliberate breakages, each made a test fail:
  - 6 in the writer;
  - 12 in the routes, row query, job freezing, rule loading and database guard;
  - 6 in the client.
