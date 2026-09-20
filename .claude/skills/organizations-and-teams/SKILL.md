---
name: organizations-and-teams
description: Add a tenant above the project to the Field Data repo — organizations that own projects, teams that group people, and org-level roles — the way Ona structures accounts. Use this whenever someone wants to host more than one organisation on one deployment, asks about multi-tenancy, wants partners or sub-offices kept separate, wants to grant access to a group of people at once instead of person by person, or asks for "organizations", "teams", "tenants", "agencies" or "org roles". Read it before touching the permission model, because ODK Central's actee/role system already does most of this and fighting it is the main way this goes wrong.
---

# Organizations and teams

ODK Central's top-level container is the project. A person is granted a role
on a project, or on a form within it. There is nothing above that, so a
deployment hosting three partner organisations has one flat list of projects
and no way to say "everyone at this agency, on all of their projects".

This is the largest of the parity gaps, and the one most likely to go wrong,
because the permission system it extends is subtle and already works.

Read `.claude/skills/ona-parity/references/house-style.md` for wiring and the Organizations
section of `.claude/skills/ona-parity/references/feature-inventory.md` for Ona's five roles.

## Decide whether you need this

Be honest before starting. Organizations are worth it when a single
deployment genuinely serves multiple bodies who must not see each other's
data, and when people move between projects often enough that per-project
grants have become the bottleneck.

They are *not* the answer to "we have a lot of projects". That is a naming
and filtering problem, and solving it with a tenancy model means reworking
every authorization check to gain a folder.

If in doubt, build project grouping and a better project list first. It is a
fraction of the work and it is reversible.

## Work with Central's model, not around it

Central already has the machinery: `actors` (people, app users, and groups),
`roles` (named sets of verbs), `assignments` (actor + role + actee), and
`actees` (the thing being granted on). An actor is already allowed to be a
group, and a role is already grantable on a container.

An organization should be an **actee that owns projects**. That half works
exactly as hoped, and better than described: `_impliedActees` in
`lib/model/query/auth.js` is a recursive CTE over `actees.parent` and
`actees.species`, so setting an owned project's `actees.parent` to the
organization's acteeId makes a grant on the organization reach it with no new
permission code at all.

It is also **monotonic**, which is the property that makes the migration safe:
a project actee's parent is null today, null matches no actee id, so setting
it can only ever add implied actees. No existing grant, including a site
admin's grant on `'*'`, can be taken away. Verified against a real PostgreSQL
with the real query — see `central/server/test/db/`.

**Teams do not work this way, and an earlier version of this skill was wrong
to say they did.** It claimed a role granted to a team reaches its members
"through the existing actor resolution". There is no such resolution:
`can()` filters on `"actorId"` alone, `actors.type` has a `'group'` value that
nothing uses, and there is no membership table anywhere. Teams would require
changing `can()` itself — the single query deciding who may read what — which
is not something to add alongside a schema change, and not something to write
blind against a database you cannot test.

Do not build a parallel permission table. A second source of truth about who
can see what is how a deployment ends up showing one organisation another's
submissions, and it will not be caught by any test written against the first
system.

Read `lib/model/query/assignments.js` and the `actees` handling before
designing anything. If the existing model cannot express what you need,
understand exactly why before adding to it.

## Roles

Ona uses owner, manager, editor, data entry, read only. Central's existing
verbs already cover the distinctions; map rather than invent:

| Org role | Roughly |
|---|---|
| owner | manage the organization itself, including members and billing |
| manager | create and administer projects within it |
| editor | change data and forms in its projects |
| data entry | submit only |
| read only | view and download |

Only `owner` is genuinely new — the ability to administer the tenant. The
rest should resolve to project roles that already exist: manager, `formfill`
for data entry, `viewer` for read only.

**`editor` has no Central equivalent and should be left out.** There is no
role between manager and viewer, and both ways to supply one are worse than
its absence: mapping it onto manager grants more than the name promises, and
inventing a verb set means guessing at a security boundary. An organization
that needs it can still grant a project role directly.

One trap: `roles.system` is `varchar(8)`, so the owner role's system name is
`'owner'` and not `'org_owner'`. There is no unique constraint on that column
either, so guard the insert with `NOT EXISTS` rather than `ON CONFLICT`,
which without a conflict target silently does nothing.

### A verb nothing checks is a promise nothing keeps

The owner role shipped carrying `organization.read`, `organization.update` and
`organization.member.manage` while every route still demanded the site-wide
`config.set`. The role looked right in the database and in the interface, and
did nothing: only administrators could administer anything. Creating the verbs
and checking them are two jobs, and the second one is easy to believe you have
already done.

Check them the ordinary way. An organization is an actee and the row carries
`acteeId`, so `auth.canOrReject('organization.update', org)` is the whole of
it — `can()` reads `actee.acteeId || actee`. This is not a second path beside
the site-wide one: because the `organization` species actee has species `'*'`,
an administrator's grant on `'*'` reaches every organization through the same
recursive walk. One query answers for both.

Three rules that keep it from becoming an escalation:

- **Grants go through `auth.canAssignRole(role, actee)`.** That is Central's
  own check that the caller holds every verb of the role they are handing out,
  on that actee, and `assignments.js` already uses it. Write your own rule here
  and an org owner becomes a way around the site's answer.
- **Anything that changes who can read a project takes authority over both
  sides.** Adopting a project needs `organization.update` on the organization
  and `project.update` on the project. That is not a new power: `project.update`
  brings `assignment.create`, so somebody who can adopt could already have
  granted those people a role directly, one at a time.
- **Refuse to remove the last owner**, but never to a site administrator. The
  person removing the last owner is usually removing themselves, and the result
  is an organization only an administrator can run — so blocking the
  administrator is the one way the guard could do harm.

Grant the creator the owner role at creation, or every organization arrives
with nobody but an administrator able to run it, which is the state the role
exists to end.

Two things the client needs that are easy to miss, and both of which make the
feature useless if missed:

- **An owner holds no site-wide verb**, so a route or tab guarded on
  `currentUser.can('config.read')` hides the page from exactly the people it is
  for. Scope the listing on the server instead and let it return only what the
  caller may read; somebody with no organizations then sees an empty page
  rather than a missing tab. Send the per-organization rights down with each
  row (`verbsOn` answers in one query) so the interface stops guessing from a
  site-wide permission that no longer governs.
- **Listing accounts takes `user.list`, which an owner does not have.** A
  dropdown of everybody is empty for them. Search by email, which is how
  Central adds somebody to a project: an exact email match comes back to
  anybody, a name match needs the verb.

One latent trap worth a comment at the grant: the owner role's verbs are copied
from `manager` when the migration runs. If a later upstream migration adds a
verb to `manager` and not to `owner`, an owner quietly stops being able to
grant the manager role, because they no longer hold all of it. It fails closed,
which is the right direction, and it will read as a puzzling refusal.

## Schema

```
field_data_organizations
  id, name, slug (unique), "actorId" (the group actor), "acteeId",
  "createdAt", "archivedAt"

field_data_organization_projects
  "organizationId", "projectId"   -- unique on projectId: a project has one owner
```

Teams are **not** expressible today — see above. Anything claiming otherwise
is describing a codebase this is not.

Make `projectId` unique. A project belonging to two organizations has no
answer to "who may administer it", and every later feature will have to
invent one.

## The migration is the risky part

Existing projects belong to nobody. Decide deliberately:

- Create one organization, put every existing project in it, and make the
  current administrators its owners. Existing access is unchanged, which is
  the property that matters.
- Or allow a null owner meaning "unowned", and handle it everywhere.

The first is almost always right, and the migration must be written so that
**no existing grant is lost**. Before/after counts of effective permissions
per actor are the assertion worth writing — not "the table was created".

## Endpoints

```
POST   /field-data/organizations
GET    /field-data/organizations
GET    /field-data/organizations/:slug
PATCH  /field-data/organizations/:slug
GET    /field-data/organizations/:slug/members
POST   /field-data/organizations/:slug/members
PATCH  /field-data/organizations/:slug/members/:actorId
DELETE /field-data/organizations/:slug/members/:actorId
```

Archive rather than delete. Deleting an organization that owns projects that
hold submissions is not an operation anybody should be offered casually.

## Verifying

This is the one feature where tests matter more than rendering:

- Assert cross-tenant isolation directly: a member of A, with no grant in B,
  cannot list, read, or export anything of B's — through every endpoint,
  including the Field Data ones and the shared-dashboard route.
- Assert the migration preserves every existing effective permission.
- Assert removing somebody from a team removes the access they had through it
  and nothing else.

Then say plainly what has not been exercised against real data. For a
permission model, an untested path is not a gap in coverage; it is an unknown
answer to "who can read this".
