# S2: reproducible interview simulation

Status: contract decided 2026-10-10 under the project owner's delegated
authority (the owner was away and asked for the work to continue). The
decisions below can be revisited.

The survey doctor (S1) proves what it can from a form's definition alone: a
question whose relevance is always false, a constraint no number can meet. Many
problems only show when answers interact: a question reachable only through a
combination nobody would give, a skip pattern that sends every respondent past
a section, an interview that is far longer on one branch than another. S2 runs
the form's own logic over many simulated interviews and reports what happened,
the "reproducible simulations" deliverable of the adaptive-surveys row.

## What it does

- On request, the server simulates a number of interviews (default 200, at
  most 1,000) of a form version: the draft, the published version or an
  earlier one, for whoever may read that definition (as S1).
- Each interview walks the questions in the form's body order. Relevance,
  calculations, constraints, required and read-only are evaluated by an XPath
  1.0 evaluator with the ODK functions forms commonly use. A question that is
  shown gets a simulated answer:
  - select one: a choice at random; select multiple: a random non-empty set;
  - numbers: values inside the ranges the constraint allows (as the survey
    doctor reads it), 0 and 1, and random values from widening ranges, until
    the constraint holds (at most 20 tries);
  - text: varied plausible values, including text the form's own expressions
    use;
  - dates near a fixed simulated "today" (2026-01-01), so runs are
    reproducible; times, locations (with varied accuracy) and media: plausible
    fixed values;
  - any text or number question: half the time, a value an expression
    compares it with (`../month = '4'` makes "4" a likely answer for month),
    and on some retries an earlier answer of the same type (an end date equal
    to the start date);
  - an optional question is left blank in 10% of interviews.
- **Reproducible**: the runs follow a seeded generator. The same form version,
  seed and number of runs always give the same report, which carries a hash of
  itself so two reports can be compared. A seed is chosen when none is given
  and returned with the report.
- Read-only questions, notes and triggers are counted as shown, not answered.

## Report

- Per question: interviews in which it was shown and answered; constraint
  failures (no simulated answer met the constraint).
- **Never shown**: questions no simulated interview reached. This is
  evidence, not proof: a rare combination may still reach them. The survey
  doctor's proofs remain the authority on "can never be shown".
- **Constraint never met**: questions where no simulated answer met the
  constraint in some interview.
- **Interview length**: questions shown per interview (minimum, median,
  maximum), so very different branch lengths are visible.
- **Not simulated**: each expression the evaluator does not understand
  (unknown function, predicates in a path, external data), with the question
  it belongs to. For those, relevance and constraints count as true and
  calculations as blank, and the report says so.

## Bounds and limits

- Repeats are simulated as one entry each; repeat counts are not simulated.
- Choice filters (`choice_filter`) and external or search choice lists are not
  applied: a choice is drawn from the whole list, or a fixed value is used.
- Forms larger than the S1 limits are refused (400.57). A run budget of
  2,000,000 question visits (runs × questions) lowers the number of runs, and
  the report says so.
- Nothing is stored; the report is computed on request.

## API

`GET .../forms/:xmlFormId/simulation`, `.../draft/simulation`,
`.../versions/:version/simulation` with `runs` (1 to 1,000) and `seed`
(1 to 64 letters, digits, `-` or `_`). Invalid values: 400.61.

## UI

On the Draft page, below the Form check: "Simulate interviews" with the
number of runs and an optional seed, then the report: never-shown questions,
constraints never met, interview length, the questions that were not
simulated, and a collapsed table of every question's counts.

## Validation

Swept over the 158 XForms in this repository (ODK Web Forms fixtures and
demos, the WHO verbal autopsy form, the tree-crops survey): none failed;
the slowest (485 questions, 200 interviews) took 0.7 s. Findings examined:
- eIMCI: 77 follow-up questions never shown. Correct: the visit-type question
  is commented out of the body, so the visit is always "first".
- Never-shown questions behind `false()`, a reference to a missing question,
  `position()` in a repeat, or a text question that must be typed exactly:
  correct for the first three, and the reason the report says "evidence, not
  proof" for the last.
- Constraints not met in some interviews because they depend on an earlier
  random answer (a duration no longer than an age that was 0): real
  interviewers would correct the earlier answer. The report says "often
  because it depends on an earlier answer".
- The sweep led to: random text and numeric targets for typed questions,
  multi-select sizes, constraint-guided numbers, earlier answers reused, and
  `format-date` patterns.

## Not in this slice

Answer distributions from real submissions, repeat counts, choice filters,
policies that adapt questions, comparisons between versions, scheduled runs.

## Acceptance

- Unit: the evaluator (operators, types and comparisons by XPath 1.0 rules,
  each supported function, unsupported expressions reported); the simulator on
  planted forms (a question reachable only through a rare combination is
  found when runs suffice; one gated by an impossible combination is never
  shown; constraint never met; lengths per branch; same seed gives the same
  report hash, another seed generally another).
- Integration: the routes on draft, published and earlier versions; permissions
  as S1; invalid parameters; run budget.
- Browser: run a simulation from the Draft page and read the report.
