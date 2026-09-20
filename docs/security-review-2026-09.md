# Security review — the Field Data surface

Reviewed 2026-09-20 against `c69645d`. The subject is everything Field Data
adds on top of ODK Central: `central/server/lib/resources/field-data.js`, the
utilities under `lib/util/` it calls, the `20260707`/`20260919`/`20260920`
migrations, the outbound webhook worker, and the client components that drive
them.

The method was reading, not attacking. Nothing here was demonstrated against a
running deployment; the database work in `central/server/test/db/` is what was
available, and it exercises the permission model rather than these routes. Two
findings below are marked as reasoned rather than reproduced, and are marked
that way because it matters which is which.

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

### 2. A shared source form cannot be un-shared by its owner — NOT FIXED

A filtered dataset reads a form in a *source* project and serves its rows to
readers of a *destination* project, who may have no rights on the source at
all. That delegation is the feature, and creating one is properly gated: it
takes `form.update` on the source and `project.update` on the destination.

Revoking it is the problem. `DELETE /projects/:projectId/filtered-datasets/:id`
requires **both** `project.update` on the destination and `form.update` on the
source. Someone who administers the source form but not the destination
project cannot delete a dataset that exposes their form. They can unpublish or
delete the form, which is not a proportionate response.

Worse, the read path never re-checks the source. Compare merged datasets:
`readMergedDataset` re-runs `mergedSourceForms` on every read, with the
comment "a grant can be withdrawn after a merge is saved, and the merge must
not outlive it". Filtered datasets deliberately do the opposite, and the
comment at the top of the section says so. The consequence is that if the
destination project's membership later widens — a new viewer is added — they
get the source form's rows immediately, with no one on the source side in the
loop.

Two fixes, either of which closes it, neither of which I made without a
decision from you:

- Let `form.update` on the source alone authorise the delete. Cheap, and it
  gives the source owner a revocation path.
- Re-check the source form's readability for the *dataset's creator* on each
  read, the way merged datasets re-check for the caller. More faithful, and
  it changes behaviour for existing datasets.

### 3. Organization owners cannot administer their organizations — NOT FIXED

The migration creates an `owner` role carrying the manager verbs plus
`organization.read`, `organization.update` and `organization.member.manage`.
**Those three verbs are not checked anywhere.** Every organization route gates
on `config.read` or `config.set`, and in Central those verbs belong to the
`admin` role alone.

This fails safe — an org owner gets no more than a manager — but it means the
tenancy is entirely site-admin-operated, and `organizations.vue` shows each
role beside the sentence "Runs the organization: its members, and every project
it owns", which is not what the role does. Either wire the verbs up or change
the copy; leaving three unchecked verbs in a role is how someone later assumes
they mean something.

Worth stating plainly alongside it: because only site admins can adopt a
project into an organization or grant a role on one, there is no tenant
self-service and therefore no cross-tenant escalation path through these
routes. The isolation property the skill asks for holds, but it holds because
nothing below admin can reach the machinery, not because the machinery checks.

### 4. Health probes run on every dashboard load — NOT FIXED

`GET /v1/field-data/stats` is available to any user with at least one readable
project. Each call writes and deletes an object in the configured storage
backend, makes outbound HTTP requests to the Enketo and pyxform URLs, and
returns their reachability plus whether email is configured. That is internal
infrastructure detail handed to every project member, and a per-request side
effect on shared infrastructure that any of them can drive as fast as they can
refresh.

Suggested: move `systemStatus` behind `user.list` (the check the route already
computes as `isAdmin`), or cache the probe for a minute or two.

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
