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

So an organization should be an **actee that owns projects**, and a team
should be an **actor that contains actors**. Then:

- Granting a role on the organization grants it on every project the
  organization owns, through the existing assignment lookup.
- Granting a role to a team grants it to the team's members, through the
  existing actor resolution.

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
rest should resolve to project roles that already exist.

## Schema

```
field_data_organizations
  id, name, slug (unique), "actorId" (the group actor), "acteeId",
  "createdAt", "archivedAt"

field_data_organization_projects
  "organizationId", "projectId"   -- unique on projectId: a project has one owner
```

Teams are actors with membership, which Central can already express — check
before adding a table.

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
