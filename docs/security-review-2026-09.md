# Security review — the Field Data surface

Reviewed 2026-09-20 against `c69645d`. The subject is everything Field Data
adds on top of ODK Central: `central/server/lib/resources/field-data.js`, the
utilities under `lib/util/` it calls, the `20260707`/`20260919`/`20260920`
migrations, the outbound webhook worker, and the client components that drive
them.

The method was reading, not attacking. Nothing here was demonstrated against a
running deployment; the database work in `central/server/test/db/` is what was
available, and it exercises the permission model rather than these routes.

**All four findings are now fixed** (`4f297e7`, `4f87b73`, `9e33624`, and the
commit carrying this sentence), each with tests and each rendered where it
touched the interface. What that does *not* mean is that any of it has run
against real users, real roles or real submissions. The fixes were verified the
way the findings were found: by reading, by unit and route-level tests against
mocks, and by rendering against canned fixtures. The permission work in
particular — findings 2 and 3 — changes who may read what, and
`central/server/test/db/` is where that should be confirmed against a real
PostgreSQL before anybody relies on it.

## What was found, worst first

### 1. A shared dashboard published individual answers — FIXED

`GET /v1/field-data/shared/:token` is the one route with no account behind it.
The code's own comment said "Only counts go through a share", and that was not
true. `summarizeForm` returns a `fields` block holding, for up to twelve
fields, the **literal text of each answer** with its count, and the shared
dashboard rendered them as bar labels.

The rule deciding which fields got published was written for readability, not
privacy. A field qualified when it had between 2 and 25 distinct answers and
they were not *all* distinct. On a form with six submissions and a respondent
name field where two people shared a name, that is five distinct answers over
six submissions — it qualifies, and four of the five bars are one person's
answer each, published to anyone holding the link. The qualifying types are
`string`, `int`, `decimal`, `date`, `time` and `dateTime`, so dates of birth
and short free-text answers are in scope. Only `geopoint` and binary fields
were structurally excluded.

The fix is a disclosure floor on the anonymous path only: `summarizeForm` now
takes `minValueCount`, the shared route passes 5, and a value shown to an
anonymous reader must have been given by at least five submissions. A field
needs two surviving values or it is dropped entirely, and the "Other" bar is
itself dropped unless it clears the floor — otherwise a single suppressed
value comes back relabelled. Authenticated routes are unchanged: a reader
there already holds `submission.read` and can open the submissions.

The selection rules moved out of the route into `lib/util/summary-fields.js`
so the control could be tested without a database.
`test/unit/util/summary-fields.js` covers it, including the exact case above:
the respondent-name field the old rule published, and the same field dropped
under the floor. Thirteen tests, and they are the first in this codebase that
assert a privacy property rather than a numeric one.

The better design, not built here because it is a product decision: let the
person creating the share choose which fields it publishes, and show them what
the link will contain before they send it. A threshold is a backstop; an
explicit allowlist is a decision someone made.

### 2. A shared source form could not be un-shared by its owner — FIXED

A filtered dataset reads a form in a *source* project and serves its rows to
readers of a *destination* project, who may have no rights on the source at
all. That delegation is the feature, and creating one is properly gated: it
takes `form.update` on the source and `project.update` on the destination.

Revoking it was the problem. The delete required **both** rights, so somebody
who administers the source form but not the destination project could not
delete a dataset exposing their form. They could unpublish or delete the form,
which is not a proportionate response to "stop sharing this".

Worse, they could not find out the share existed. The only listing was the
destination project's own, which needs rights there; a dataset serving a
project you hold nothing in was invisible from the source side. A revocation
you cannot discover is not a revocation.

Both halves are fixed:

- `GET /projects/:projectId/forms/:xmlFormId/filtered-datasets` lists every
  dataset built on a form, wherever it serves, with the destination project
  named. It takes `form.update` — the same right that authorises creating one,
  because anything weaker turns it into a way to learn which projects hold a
  given form's data.
- The delete, and reading the definition, now take **either** side. Deleting
  only ever takes access away, so it cannot be used to reach anything, and
  reading the definition is what makes the revocation decision informed — the
  source form's administrator can already read every value it names, at the
  source. Editing still takes both sides, because an edit can widen a share as
  easily as narrow it, and widening somebody else's dataset is not revocation.
- A caller with a stake in neither side gets 404 rather than 403, so neither
  route can be used to test which dataset ids exist.

The form's Filtered Data tab now carries a "Where this Form's data goes"
section listing the shares that serve elsewhere, each with what it exposes and
a button that ends it. Six tests in `test/field-data/hardening.cjs` cover the
authority rule from both sides and from neither.

**What is still true and was not changed:** the read path does not re-check
the source. If the destination project's membership widens later, the new
members get the source form's rows immediately. That is the feature working as
designed — readers were given the destination project, not the form — but it
means the source side's control is exercised by watching and revoking rather
than by the permission system refusing. The new section is what makes that
watching possible. Compare merged datasets, which re-check every source form
on every read; they can afford to, because they never cross a project boundary.

### 3. Organization owners could not administer their organizations — FIXED

The migration creates an `owner` role carrying the manager verbs plus
`organization.read`, `organization.update` and `organization.member.manage`.
**Those three verbs were checked nowhere.** Every organization route gated on
`config.read` or `config.set`, which in Central belong to the `admin` role
alone, so the tenancy was entirely site-admin-operated while the interface told
each owner they "run the organization: its members, and every project it owns".

The verbs are now the gate. An organization is an actee, so this is an
ordinary `can()` question with the organization row as the target — not a
second permission path: the migration gave the `organization` species a species
of `*`, so a site administrator's grant on `*` still reaches every organization
through the same recursive walk. One query, two kinds of caller.

| Route | Was | Now |
|---|---|---|
| list organizations | `config.read` (all of them) | only those you may read |
| create | `config.set` | `config.set`, unchanged |
| read one, list members | `config.read` | `organization.read` |
| rename, archive | `config.set` | `organization.update` |
| adopt, release a project | `config.set` + `project.update` | `organization.update` + `project.update` |
| add, remove a member | `config.set` | `organization.member.manage` |

Creating a tenant stays site-wide deliberately: there is no organization yet to
be the owner of, and a new top-level container is not something one tenant
should be able to conjure inside another's deployment. The creator is now
granted `owner` on what they created, which is what stops every new
organization arriving with nobody but an administrator able to run it.

Three things worth naming, because each is where this could have gone wrong:

- **Granting is bounded by what you hold.** Member grants go through
  `auth.canAssignRole`, Central's own check that the caller has every verb of
  the role being granted on that actee — the same one `assignments.js` uses.
  Writing a new rule here is how an organization owner becomes a way around the
  site's answer to that question.
- **Adopting a project is not an escalation.** It takes `organization.update`
  on the organization *and* `project.update` on the project. `project.update`
  comes with the manager verbs, `assignment.create` among them, so anyone who
  can adopt a project could already have granted those same people a role on it
  directly. What adopting saves is doing it one by one.
- **The last owner cannot be removed** by an owner, because the person doing it
  is usually removing themselves and the result is an organization only a site
  administrator can run. A site administrator is not stopped — blocking the
  people who would have to fix it is the one way that guard could do harm.

Two consequences of the change that are not defects but will surprise someone:

- The Organizations route and tab lost their `config.read` guard, because an
  owner holds no site-wide verb for it to test. The page is now scoped by the
  server and shows somebody with no organizations an empty list, the same way
  the Field Data dashboard shows them zeros.
- The member form searches for a person by email instead of listing everyone,
  because listing accounts takes `user.list` and an owner does not have it — a
  dropdown would have been empty for exactly the people the form is for. This
  is how Central adds somebody to a project.

One latent trap, left as a comment at the grant: the owner role's verbs were
copied from `manager` when `20260920-05` ran. If a later upstream migration
adds a verb to `manager` without adding it to `owner`, an owner quietly stops
being able to grant the manager role, because they would no longer hold all of
it. That fails closed, which is the right direction, but it will read as a
puzzling refusal until somebody re-syncs the two.

### 4. Health probes ran on every dashboard load — FIXED

`GET /v1/field-data/stats` was available to any user with at least one
readable project, and its `systemStatus` block is the one part of the
dashboard that *does* something rather than counting something: it writes and
deletes an object in the configured storage backend, and makes an outbound
request to each of Enketo and pyxform.

Two problems in one. It handed every project member a map of what this
deployment runs and whether it is reachable, which is not their question. And
it let any of them drive real infrastructure as fast as they could refresh a
page — a write, a delete and two outbound requests per load, with no
rate limit anywhere in this deployment to slow it down.

Now: administrators only, decided by the `user.list` check the route already
computed as `isAdmin`, and cached for thirty seconds. What is cached is the
*promise*, not the value, so requests arriving together share one probe rather
than starting four; a probe that rejects is not remembered for the rest of the
window. The cache is per worker process deliberately — a probe is about this
process's view of the world, and a shared one would report somebody else's.

A non-administrator gets `systemStatus: null` and the client hides the panel.
Null rather than a row of `false`, because never-asked and every-service-down
should not look the same. The same change fixes a smaller untruth: the
zero-projects branch used to return five hardcoded values claiming the
database and storage were up without having asked either.

## What was examined and looks sound

- **Share tokens.** 32 bytes from `crypto.randomBytes`, base64url, shape-checked
  before the database is touched, stored as SHA-256 with an 8-character hint.
  Revoked, expired, never-issued and deleted-form all return the same 404, so
  the link cannot be used to distinguish them. View counting is deliberately
  not awaited into the response path, which is right.
- **The filter compiler** (`lib/util/filtered-datasets.js`). Operators come
  from a fixed set, conditions from a fixed set, column paths must match a
  field present in the *current* form definition, and every value stays a
  slonik parameter. The `::text` casts added for `jsonb_build_object` do not
  widen anything. There is no string concatenation of user input into SQL
  anywhere in this file.
- **XPath construction.** Two places concatenate a path into an XPath
  expression inside SQL (`summarizeForm`, `evidenceFor`). Both take the path
  from `form_fields` filtered by `path ~ '^(/[A-Za-z_][A-Za-z0-9_.-]*)+$'` in
  the same query, so the concatenated value cannot carry an XPath
  metacharacter. `extractObject` passes the path as a parameter instead.
- **SSRF on webhooks.** `resolveWebhookUrl` rejects non-HTTP schemes, embedded
  credentials, `localhost`, and anything resolving into private, loopback,
  link-local, CGNAT, documentation or multicast space, v4 and v6 including
  v4-mapped. The important part is that `deliverOnce` re-resolves at delivery
  time *and pins the resolved address through a custom `lookup`*, so DNS
  rebinding between validation and delivery does not work. Redirects are not
  followed. This is better than most implementations of this control.
- **Webhook secrets.** AES-256-GCM with a random IV and the auth tag stored,
  keyed from the environment. Returned exactly once at creation or rotation;
  `publicWebhook` and `redactConfig` strip them everywhere else. Delivery
  signs the bytes actually sent rather than a re-serialisation of them.
- **The XML target's serialiser.** Escapes the five XML metacharacters, refuses
  element names that are not plain names rather than escaping them, caps depth
  at ten. It does not strip C0 control characters, which XML 1.0 forbids — that
  produces a payload some receivers will reject, but it is an interop bug, not
  an injection.
- **Media library.** Types are allowlisted. `image/svg+xml` is allowed, which
  would be stored XSS if it were served inline, but `contentDisposition`
  defaults to `attachment` and the route does not override it. Storage keys are
  server-generated UUIDs, so the uploaded filename never reaches the object
  store; only the extension does, and it is scrubbed. Adding
  `X-Content-Type-Options: nosniff` on that response would be belt and braces.
- **Widget scoping.** A widget hanging off a filtered dataset may only read
  that dataset's surviving visible columns and only its rows, and an unusable
  dataset makes its widgets unusable rather than turning them into charts of
  everything. A chart is as good a way to leak a hidden field as a table, and
  this is handled.
- **The organizations migration.** Monotonic with respect to permission: a
  project actee's parent was null, null implies no actee, so setting it can
  only add. No existing grant, including a site admin's on `'*'`, is
  disturbed. Verified against a real PostgreSQL in `test/db/`.
- **The client.** No `v-html`, no `innerHTML`, no dynamic code evaluation in
  any of the components added by this work.

## Smaller things, fixed in this change

- Path parameters reaching integer columns unparsed (`:id` on dashboards,
  media, webhooks, webhook deliveries and backups) turned a non-numeric id into
  a 500 from Postgres rather than the 404 the route means. Now parsed through
  an `intParam` helper. Parameterised throughout, so this was never injection.
- The field-selection rules now live in `lib/util/summary-fields.js` rather
  than inline in the route, because a security control that can only be
  exercised by standing up PostgreSQL and a form is a security control nobody
  will re-check.
- `mergedDatasetCoding` passed the xpath expression as an uncast parameter —
  the same trap `extractObject` documents. Its `.catch(() => [])` meant the
  coding-divergence check silently found nothing rather than failing. Cast
  added.

## Fail-quiet, which is a pattern rather than a finding

`summarizeForm`'s answer query, `evidenceFor`, and `mergedDatasetCoding` all
end in `.catch(() => [])`. The reasoning is sound in each case — a malformed
submission should not take a page down — but the effect is that a broken query
and an empty result are indistinguishable to the reader and to us. Finding 2's
sibling above is exactly what that costs. These want logging at minimum.

## What this review did not cover

Authentication, session handling, and everything upstream of Field Data. The
Enketo and pyxform integrations. The backup encryption path beyond noting the
passphrase length check. Rate limiting, which this deployment appears not to
have anywhere — relevant to the shared-dashboard route in particular, though
a 256-bit token is not guessable at any rate.
