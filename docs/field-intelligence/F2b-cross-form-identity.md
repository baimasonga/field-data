# F2b: identity keys across forms

Status: contract decided 2026-10-10 under the project owner's delegated
authority (the owner was away and asked for the work to continue). The
decisions follow F2's agreed rules and can be revisited.

F2 finds a household code or phone number used more often than allowed within
one form. Surveys are often split across forms: round 1 and round 2, one form
per district, a main survey and a follow-up. F2b lets an identity key also look
at other forms of the same project, so that the same household interviewed in
two forms, or the same code appearing with a different district in another
form, is found.

## What changes

An identity key gains an optional `alsoIn` list: up to 5 other forms of the
same project, each with a mapping from this key's questions to that form's
questions:

    "alsoIn": [{ "xmlFormId": "round1",
                 "fields": { "/household/code": "/hh_code" },
                 "sameFields": { "/household/area": "/district" } }]

(Paths are as the form's field list gives them, without the root element.)

- Every key question must be mapped; "should stay the same" questions may be
  mapped or left out (left out = not compared for that form). Mapped questions
  must exist in the other form's current version, be top-level, and be of a
  kind the key allows (as in F2). A mapping that no longer fits is reported
  unusable for that form, and the key runs without that form rather than
  guessing; the run report says so.
- Matching uses the key's own normalising, placeholders and minimum length.

## Findings

- Findings stay on the key's own form: a submission of this form is flagged
  when it shares its key with an earlier submission of this form **or of an
  included form**. Submissions of other forms are evidence, not flagged here.
  (Decision 1: flags belong to the form whose key it is; the other form can
  have its own key pointing back if its reviewers want flags there.)
- `maxUses` and `windowDays` count uses across all included forms, ordered by
  time received. A panel with one form per round sets `maxUses` to the number
  of rounds.
- Evidence names the other submission's form; the Verification page links to
  it and shows its answers read live, as F2 does. No answers are stored.

## Permissions

- Writing a key that includes another form needs `project.update` (as F2) and
  `submission.read` on each included form.
- A run, and the live answers, need `submission.read` on the included forms.
  When the person running the checks cannot read an included form, the key
  runs without it and the report says "not run against <form>: no access"
  (decision 2: never use data the person running could not read).
- The findings inbox and Verification page show the other form's name and a
  link; opening it applies that form's own permissions.

## Not in this slice

Matching across projects; near matches; keys inside repeats.

## Acceptance

- Round 1 and round 2 forms with different question paths: a household in both
  is found on round 2 (with `maxUses` 1) and not when `maxUses` is 2; a changed
  district across forms is found with both answers shown live.
- An included form whose question was renamed: reported unusable for that form,
  the key still runs on its own form.
- A reviewer without access to the included form: the key runs without it and
  says so; no answers from it are shown.
- Validation: unknown form, unmapped key question, wrong kind, the key's own
  form listed, more than 5 forms, another project's form: 400.56.
- Withdrawal and versioning as F2: changing `alsoIn` is a new version. A key
  without `alsoIn` keeps its F2 fingerprint, so existing keys do not change
  version.

## Validation evidence

Locally, against real PostgreSQL 16:

- Unit: 4 new tests in `test/unit/util/identity-keys.js` (18 in all): F2
  fingerprints unchanged without other forms; every refused mapping; a mapping
  the other form no longer fits; uses counted across forms with only this
  form's submissions flagged, the other form named in the evidence, and a
  panel allowing one use per form.
- Integration: 4 tests (`test/integration/api/field-data-identity-keys-cross.js`):
  a household from round 1 found again in round 2 (with different question
  paths), flagged only on round 2, both answers shown live through the
  mapping; `maxUses` 2 for a two-round panel; refused mappings including the
  key's own form, an unknown form and another project's form; a removed
  mapped question leaves that form out of the run with the reason reported;
  a deleted round 1 hides its answers and withdraws the findings that
  depended on it. The F2 and F3 tests still pass; the findings inbox now
  returns the related submission's form (`relatedXmlFormId`).
- Browser: 1 new test: mapping a key to another form in the editor (the key's
  own form and unsuitable questions not offered) and the exact request; a
  cross-form finding showing the other form's row and linking to that form's
  submission.
- Deliberate breakages: 7 in the server; 6 made a test fail. The one that did
  not is the check that a manager can read submissions of the other form when
  saving a key: ODK project roles give a manager read access to every form of
  the project, so no current role can exercise it. It stays as defence in
  depth.
