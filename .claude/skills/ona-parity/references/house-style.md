# How a feature gets built in this codebase

Field Data is a fork of ODK Central: a Node/slonik server and two Vue 3 SPAs
in a turbo monorepo. New platform features go in dedicated files rather than
threaded through upstream ones, so that merging upstream stays possible.

## Server

Everything Field Data adds lives in
`central/server/lib/resources/field-data.js`, in commented sections. Follow
what is already there:

```js
service.get('/projects/:projectId/forms/:xmlFormId/thing', endpoint(async (container, { params, auth }) => {
  const form = await container.Forms
    .getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.PublishedVersion)
    .then(getOrNotFound);
  await auth.canOrReject('submission.list', form);
  await auth.canOrReject('submission.read', form);
  return container.db.any(sql`select ... where "formId" = ${form.id}`);
}));
```

Things worth knowing because they are not guessable:

- `endpoint` parses a session but does **not** require one. A route is
  public until it calls `auth.canOrReject`. That is how
  `/field-data/shared/:token` serves anonymous readers — deliberate, and
  easy to do by accident, so be explicit about which routes are public.
- Reading takes `submission.list` + `submission.read`; anything that writes
  takes `submission.update`.
- For a `jsonb` column, pass `JSON.stringify(value)` rather than reaching
  for a slonik JSON helper — that is what the existing code does.
- Validate path parameters that reach SQL. `Number.parseInt` an `:id` and
  reject a non-integer with `Problem.user.notFound()`.
- Reject bad input with `Problem.user.unexpectedValue({ field, value, reason })`.
  The `reason` is read by a person; write it as a sentence.

### Migrations

`central/server/lib/model/migrations/YYYYMMDD-NN-name.js`, exporting `up`
and `down`, using `db.raw` with `CREATE TABLE IF NOT EXISTS`. Migrations run
inside the container at boot via `start-odk.sh`, not during the deploy — so
a schema change ships only when a fresh container starts, and nothing in CI
will tell you it worked.

Name what each column is for in comments. `20260919-02-add-integrity-flags.js`
is the model to copy, including its note on why there is deliberately no
score column: explaining an absence stops someone helpfully adding it back.

## Client

Wiring a new tab or page takes six edits. Missing any one of them produces a
feature that half-works:

1. `apps/central/src/util/request.js` — add the path builders to `apiPaths`.
2. `apps/central/src/util/load-async.js` — register the component.
3. `apps/central/src/routes.js` — add the route under the right parent, with
   `validateData` naming the permissions it needs.
4. `apps/central/src/routes.js` again — add the route **name** to
   `formRoutes` or `projectRoutes` in the preservation list near the bottom,
   or the page refetches everything each time a user switches tabs.
5. `apps/central/src/components/form/head.vue` (or the project equivalent) —
   add the tab, guarded with `canRoute(tabPath('...'))`.
6. `apps/central/src/locales/en.json5` — add the tab label with a comment
   saying what the tab is.

`tests/navigation-preservation.test.mjs` evaluates the real route table
without loading Vue, and is the cheapest way to catch step 4.

### Component conventions

Vue 3 `<script setup>`, `useRequest` for calls, `useRequestData` for shared
resources, `<i18n lang="json5">` blocks with an `en` key. Other locales fall
back to English, so a new string can ship in English alone — say so rather
than leaving it looking translated.

Gradient design tokens are written as literals with the token name in a
comment, because the SCSS variables do not cover them:

```scss
border: 1px solid #e9e9f1;   // gradient --gray-150
```

## Gotchas that have already cost time here

- `forms` has no `name` column (dropped in `20210423-02`); the title is on
  `form_defs`. `submissions` has no `currentDefId` either — the current
  version is the `submission_defs` row flagged `current`. `form_fields` keys
  on `schemaId`, not `formDefId`, so join through `form_defs.schemaId`.
  `test/field-data/hardening.cjs` guards all three.
- Icon classes must exist in `apps/central/src/assets/css/icomoon.css`.
  `icon-arrow-up` and `icon-arrow-down` do **not**; `icon-angle-up` and
  `icon-angle-down` do. A missing one renders an empty span, so the control
  is invisible rather than broken — only a render catches it.
- `chart/bars.vue` shows a share column. That reads naturally for counts and
  is nonsense for averages, so pass `:show-share="false"` for anything
  aggregated.

- `[class^="icon-"]` selectors need the icon class **first** in the
  attribute, or you get tofu.
- `app.scss` styles `dl > *` with a bottom rule and block padding. A `<dl>`
  used for a row of figures needs `> * { border-bottom: none; padding-block: 0; }`.
- `tc()` does not exist in the composition API. Use `t(key, count)`.
- Luxon's `DateTime` collides with a component of the same name; alias it.
- `useRequest`'s `patch` option takes an array, not a function.
- `$color-text-muted` had to be added to `_variables.scss`; check a variable
  exists before using it.

## Two traps that only a real database finds

Both of these shipped in three features and were invisible to every fixture
and every mock:

- **`jsonb_build_object` is variadic `"any"`.** Postgres cannot infer the type
  of a bare parameter passed to it and rejects the whole statement with
  "could not determine data type of parameter". Cast every parameter that
  reaches it: `sql`${path}::text``.
- **`container.db.maybeOne` returns a row; `container.maybeOne` returns an
  Option.** `getOrNotFound` needs the Option. Pairing it with the `db` form
  throws on every row that exists. Worse, a mock that returns an Option from
  `db.maybeOne` makes the test pass — so the mock has to be right about which
  one the code calls, or it is testing a codebase that does not exist.

The general lesson, which cost four bugs to learn: **a fixture server proves a
component draws; it cannot prove a query runs.** `central/server/test/db/` has
a recipe for standing up PostgreSQL, seeding a real form with ODK's own
parser, and checking endpoint output against expectations computed
independently in another language.

## Verifying before you commit

The deploy cannot reach a browser and this environment cannot reach the
live site, so render locally against a canned server. There is a working
example in the scratchpad pattern used for the verification tab:

1. A small Python server that serves `central/client/dist` and answers the
   API paths with fixtures.
2. A Playwright script at 1440 and 390 that asserts the component mounted,
   dumps its text, checks `document.documentElement.scrollWidth` against
   `window.innerWidth`, and screenshots it.

Check the screenshot yourself. Rendering has caught real bugs here —
duplicate-looking `<dl>` rules, tofu icons, a chart drawing 393 above 412 —
that no test would have.

Server unit tests are mocha + should under `central/server/test/unit/`. The
repo pins Node 24 and this environment has 22, so install `should` and
`mocha` into the scratchpad and run with `NODE_PATH` pointed at them rather
than fighting `npm install`.

## A readability rule is not a privacy rule

`summarizeForm` picks which fields are worth charting by asking whether their
answers repeat. That is a taste judgement, and for a long time it was also the
only thing standing between a form's answers and the anonymous shared-dashboard
route. It is not up to that job: six submissions with five distinct answers
passes it, and four of the resulting bars are one person's answer each.

Whenever a route has no reader behind it, the question is not "is this a chart
worth drawing" but "how many people does each number stand for". Those need
separate code, and the second one needs a floor -- `minValueCount` in
`lib/util/summary-fields.js`, five on the shared path. Put it somewhere a unit
test can reach: a control that only an integration test can exercise is one
nobody re-checks.

The same instinct applies to the public route itself. `endpoint` does not
require a session, so a route is public until it calls `auth.canOrReject`.
Before adding anything to a response that a public route shares with an
authenticated one, ask what the anonymous version of that response says.

## A guard with a hand-written file list goes stale

`test/field-data/hardening.cjs` scans this project's raw SQL for mistakes the
schema makes easy: `forms.name`, `submissions.currentDefId`,
`form_fields.formDefId`, and an id from one table bound to another table's id
column. Those scans named the files they read. Two more files with raw SQL
arrived, were not added to the list, and one of them shipped a bug from that
very family.

So the scan finds its files instead: everything under `lib/` carrying this
project's copyright header and a `sql\`` template literal. A new file is
covered the day it is written. Upstream ODK files stay out of scope
deliberately -- they alias tables by other conventions, and `f.name` is
correct where `f` is a form_defs.

Discovery brings its own failure mode, and it is the worse one: a walk that
quietly finds nothing makes every scan pass without reading a line. So there
is a test whose only job is to assert the discovery found the files it must,
and it fails if the marker stops matching. Any test that iterates over a
discovered set needs that companion, or it is only pretending.

## A health probe is a side effect, not a read

The Field Data dashboard's system-status block writes and deletes an object in
object storage and makes an outbound request to Enketo and to pyxform. It sat
on a route any project member could call, so every page load did real work
against real infrastructure, and any of them could drive it as fast as they
could refresh. Nothing in this deployment rate-limits anything.

Before putting a reachability check on a route, ask who may call it and how
often. The answer is usually: administrators, and cached. Cache the promise
rather than the value so a burst shares one probe instead of starting one
each, and drop a rejected probe rather than remembering a failure for the
whole window.

When somebody may not see a probe's result, send `null` and let the interface
hide the panel. A row of `false` reads as an outage rather than as a question
that was never asked — and hardcoding `true` so the panel looks healthy, which
is what the zero-projects branch did, is worse than either.

## Honesty about what has been verified

Much of the Field Data surface has never run against real submissions, and
the egress proxy blocks the live host from this environment. When you finish
a feature, say plainly which of these happened: local tests, a local render,
CI, and live use. Do not let "the deploy went green" stand in for "it works".
