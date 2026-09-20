// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// A tenant above the project.
//
// This adds no permission logic. Central's `can()` resolves an actee through
// a recursive walk of `actees.parent` and `actees.species` (see
// lib/model/query/auth.js, `_impliedActees`), so a grant on a container
// already reaches everything beneath it. An organization is therefore just an
// actee that owned projects point at, and a role granted on that actee reaches
// every project it owns through machinery that already exists and is already
// exercised by every request the server serves.
//
// Why that is safe, which is the part worth being sure of before running this
// against somebody's data: `_impliedActees` unnests ARRAY[parent, species].
// A project actee's parent is currently null, and null matches no actee id.
// Setting the parent therefore only ever ADDS implied actees; it cannot remove
// one. The species chain (project -> *) is untouched, so every existing grant,
// including a site-wide admin's grant on '*', keeps working exactly as before.
// The migration is monotonic with respect to permission, which is the property
// that makes it worth doing at all.
//
// Teams are deliberately not here. Central's actors table has a 'group' type
// but nothing uses it, and `can()` filters on "actorId" alone with no group
// resolution anywhere. Granting a role to a team would mean changing that
// query -- the single query that decides who may read what -- so it is not
// something to add blind alongside a schema change.

const up = async (db) => {
  // Species rows are what a grant on "every organization" would hang off, and
  // what keeps a site-wide grant reaching organizations at all.
  await db.raw(`INSERT INTO actees (id, species)
    VALUES ('organization', '*') ON CONFLICT (id) DO NOTHING`);

  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_organizations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    -- Used in URLs, so it is the stable identifier a link is built from.
    slug VARCHAR(64) NOT NULL UNIQUE,
    "acteeId" VARCHAR(36) NOT NULL REFERENCES actees(id),
    "createdBy" INTEGER REFERENCES actors(id),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    -- Archived, never deleted. Deleting a tenant that owns projects holding
    -- submissions is not an operation to offer casually.
    "archivedAt" TIMESTAMPTZ,
    CONSTRAINT field_data_organizations_slug_shape CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$')
  )`);

  await db.raw(`CREATE TABLE IF NOT EXISTS field_data_organization_projects (
    "organizationId" INTEGER NOT NULL
      REFERENCES field_data_organizations(id) ON DELETE CASCADE,
    -- One owner per project. A project belonging to two organizations has no
    -- answer to "who may administer it", and every later feature would have to
    -- invent one.
    "projectId" INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE
  )`);

  await db.raw(`CREATE INDEX IF NOT EXISTS field_data_organization_projects_org
    ON field_data_organization_projects ("organizationId")`);

  // The one genuinely new role. Everything else an organization needs --
  // manager, viewer, data collector -- already exists and is granted on the
  // organization's actee rather than on each project. An owner also
  // administers the organization's own projects, so the role carries the
  // manager verbs as this deployment defines them rather than a guess at what
  // they should be.
  // roles.system is varchar(8), so the name is 'owner' rather than the
  // 'org_owner' it reads as elsewhere. There is no unique constraint on that
  // column either, so this guards with NOT EXISTS rather than ON CONFLICT,
  // which without a conflict target would silently do nothing.
  await db.raw(`
    INSERT INTO roles (name, system, verbs, "createdAt")
    SELECT 'Organization Owner', 'owner',
      verbs || '["organization.read","organization.update","organization.member.manage"]'::jsonb,
      clock_timestamp()
    FROM roles WHERE system = 'manager'
      AND NOT EXISTS (SELECT 1 FROM roles WHERE system = 'owner')`);

  // Every project that exists belongs to nobody. Putting them in one
  // organization changes no access -- see the note above about the migration
  // being monotonic -- and gives every later project somewhere to be.
  const count = await db.raw('SELECT count(*)::integer AS count FROM projects')
    .then(result => result.rows[0].count);
  if (count > 0) {
    await db.raw(`
      WITH actee AS (
        INSERT INTO actees (id, species, parent)
        VALUES (gen_random_uuid()::varchar, 'organization', null)
        RETURNING id
      )
      INSERT INTO field_data_organizations (name, slug, "acteeId")
      SELECT 'Default organization', 'default', actee.id FROM actee
      ON CONFLICT (slug) DO NOTHING`);

    await db.raw(`
      INSERT INTO field_data_organization_projects ("organizationId", "projectId")
      SELECT org.id, p.id
      FROM field_data_organizations org, projects p
      WHERE org.slug = 'default'
      ON CONFLICT ("projectId") DO NOTHING`);

    // The link that makes a grant on the organization reach its projects.
    await db.raw(`
      UPDATE actees SET parent = org."acteeId"
      FROM field_data_organizations org
      JOIN field_data_organization_projects op ON op."organizationId" = org.id
      JOIN projects p ON p.id = op."projectId"
      WHERE actees.id = p."acteeId" AND actees.parent IS NULL`);
  }
};

const down = async (db) => {
  // Give the projects their unowned actees back before the organizations they
  // point at disappear.
  await db.raw(`
    UPDATE actees SET parent = NULL
    FROM field_data_organizations org
    WHERE actees.parent = org."acteeId"`);
  await db.raw('DROP TABLE IF EXISTS field_data_organization_projects');
  await db.raw('DROP TABLE IF EXISTS field_data_organizations');
  await db.raw("DELETE FROM roles WHERE system = 'owner'");
};

module.exports = { up, down };
