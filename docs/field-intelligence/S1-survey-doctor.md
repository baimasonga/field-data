# S1: survey doctor (static form checks)

Status: draft contract, awaiting decisions (see "Decisions needed").

First slice of the adaptive-surveys area (row 7 of the delivery ledger: "static
survey doctor"). It reads a form definition, before or after publishing, and
reports design problems that would make questions impossible to reach, answers
impossible to give, or logic that cannot work. It changes nothing, runs no
model, and does not claim a form is correct: it reports what it can establish
from the definition alone, and says what it could not check.

## Why

Form problems are cheapest before collection. Today a mistake in skip logic or
a constraint is found when a collector is stuck in the field, or later, when an
analyst notices a question nobody ever answered. The XLSForm converter
(pyxform and ODK Validate) catches syntax errors; it does not catch logic that
is valid but wrong: a question shown only when `district = 'bo'` where the
choice is named `Bo`, a constraint `. > 18 and . < 16`, or a calculation that
depends on itself through another calculation.

## What it reads

The compiled XForm of a form version: the one being drafted, the published
one, or any earlier version. Uploaded XLSForms, XForm XML and builder forms all
end as an XForm, so all are checked the same way. Expressions are XPath as
written in the XForm (pyxform has already replaced `${name}` with paths).

## Checks

Each finding has a code, a severity, the question's path, the attribute it is
about (`relevant`, `constraint`, `calculate`, `required`, `readonly`,
`choices`, `label`), the expression, a plain-words message and, where useful,
the other questions involved.

**Errors**: the form will not behave as its author intends.

| Code | Finds |
| --- | --- |
| `unknown-reference` | An expression names a question the form does not have (often a renamed question). |
| `cycle` | Calculations, relevance, `required` or `readonly` that depend on themselves, directly or through others. The form cannot settle a value. |
| `never-shown` | Relevance that can never be true: a constant false, or a choice question compared with a value that is not one of its choices (`/data/district = 'bo'` when the choices are `Bo`, `Kenema`; `selected(/data/assets, 'tv')` with no `tv`). A group never shown is reported once, not for each question inside. |
| `impossible-constraint` | A number constraint no answer can meet (`. > 18 and . < 16`), or a choice constraint naming a choice that does not exist. |
| `unanswerable-required` | A question that is required and read-only with no calculation or default: when shown, the form cannot be finished. |
| `duplicate-choice` | The same choice name twice in one list: answers cannot be told apart. |

**Warnings**: probably a mistake; sometimes intended.

| Code | Finds |
| --- | --- |
| `forward-reference` | Relevance, a constraint or `required` of a question that depends on a question asked **later**. When the question is reached, that answer does not exist yet. |
| `missing-translation` | A form with several languages where a question or choice has a label in some languages and not others. |
| `duplicate-choice-label` | Two choices in one list with the same label in the same language: the collector cannot tell them apart. |
| `empty-choice-list` | A choice question with no choices and no external or filtered list. |

**Notes**: worth knowing.

| Code | Finds |
| --- | --- |
| `number-without-range` | A number question with no constraint (an age of 999 would be accepted). See decision 2. |

The report also gives a summary: questions, groups, repeats, choice lists,
languages, and how many expressions were checked.

## How expressions are read

A small XPath reader that understands string literals, numbers, location paths
(absolute, `.`, `..`, `current()`), comparisons, `and`/`or`, and function calls.
Paths are resolved against the question they belong to, including inside
repeats.

- **References** are collected from every expression, so `unknown-reference`,
  `cycle` and `forward-reference` cover all of them.
- **Always-false relevance and impossible constraints** are decided only for
  forms the reader fully understands: constants, comparisons of one question
  with a literal, `selected()`, `not()`, `and`, `or`. Anything else (other
  functions, arithmetic between questions) is counted as "not evaluated" and
  produces no finding. The report says how many.
- **Choices** come from the form's own lists. Lists from external files,
  `choice_filter` expressions or `search()` are not checked for missing
  values, and the report says so.

## Not in this slice

- Simulating interviews through the form (synthetic answer paths to find
  rarely reachable questions and long paths). Planned as S2; it builds on this
  reader.
- Wording, bias or reading-level review, and anything using a model.
- Checking entity (dataset) declarations, which ODK already validates.
- Comparing two versions for changes that break comparability (renamed
  variables, changed choice codes). Planned with version evolution.

## API

All `GET`, needing `form.read` (the same people who can download the form
definition), `Cache-Control: private, no-store`:

- `/v1/projects/:projectId/forms/:xmlFormId/doctor`: the published version.
- `/v1/projects/:projectId/forms/:xmlFormId/draft/doctor`: the draft.
- `/v1/projects/:projectId/forms/:xmlFormId/versions/:version/doctor`: an
  earlier version.

Response: `{ doctorVersion, formVersion, hash, summary, findings, notChecked }`.
The same definition always gives the same report (`doctorVersion` names the
rule set), so a report can be reproduced later. Nothing is stored. A form
definition above 5 MB or with more than 5,000 questions is refused with a
clear problem rather than checked partially.

## Where it shows

On the form's **Draft** page, a "Form check" section listing findings by
severity, each with the question path and what to change. On the published
form's page when there is no draft. See decision 1 for publishing.

## Acceptance

- A test form with one deliberate instance of each finding, and the same form
  corrected, which must give no errors or warnings.
- Benign lookalikes: (a) relevance on a later question that is a calculate
  with no dependency on the current one is not a cycle; (b) a choice compared
  case-sensitively with its exact name is not `never-shown`; (c) a constraint
  `. >= 0 and . <= 120` is satisfiable; (d) relevance using functions the
  reader does not model is "not evaluated", not a finding; (e) a forward
  reference inside a repeat to a sibling asked earlier is not reported;
  (f) an external choice list is not `empty-choice-list`.
- Real forms: every form in the repository's test fixtures and XLSForm
  round-trip suite checks without a crash, and any finding on them is
  examined by hand and either confirmed or fixed in the checker.
- Permissions: users who can read the form see the report; others 403/404;
  drafts only for those who can see the draft.
- Browser: the Draft page shows findings grouped by severity and the clean
  state, at narrow width.

## Decisions needed

1. **Publishing with errors**: show the error count in the publish dialog and
   let the person publish anyway (recommended: the checker can be wrong and
   must not block urgent fixes), or block publishing until errors are fixed.
2. **Number questions without a range**: report them as notes (recommended:
   collapsed by default, useful on a first review), or leave them out (they
   are common and often deliberate).
3. **Where else to show it**: Draft page only (recommended for this slice), or
   also inside the form builder while editing.
