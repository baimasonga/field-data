\set ON_ERROR_STOP on
-- A project as it exists before organizations: actee parent is null, and
-- somebody holds a grant directly on the project.
INSERT INTO actees (id, species, parent) VALUES ('legacy-proj','project',NULL);
INSERT INTO projects (name, "acteeId", "createdAt") VALUES ('Legacy project','legacy-proj',now());
INSERT INTO actees (id, species) VALUES ('actor-legacy','actor');
INSERT INTO actors (type,"acteeId","displayName","createdAt") VALUES ('user','actor-legacy','Direct grantee',now());
INSERT INTO assignments ("actorId","roleId","acteeId")
  SELECT a.id, r.id, 'legacy-proj' FROM actors a, roles r
  WHERE a."displayName"='Direct grantee' AND r.system='viewer';

SELECT 'BEFORE: direct grantee reads project' AS check,
  can('Direct grantee','legacy-proj','form.read') AS got, true AS want;

-- Now the migration's data step, verbatim in shape: adopt it into an org.
INSERT INTO actees (id, species, parent) VALUES ('org-c-actee','organization',NULL);
INSERT INTO field_data_organizations (name, slug, "acteeId") VALUES ('Agency C','agency-c','org-c-actee');
INSERT INTO field_data_organization_projects ("organizationId","projectId")
  SELECT o.id, p.id FROM field_data_organizations o, projects p
  WHERE o.slug='agency-c' AND p."acteeId"='legacy-proj';
UPDATE actees SET parent = org."acteeId"
  FROM field_data_organizations org
  JOIN field_data_organization_projects op ON op."organizationId" = org.id
  JOIN projects p ON p.id = op."projectId"
  WHERE actees.id = p."acteeId" AND actees.parent IS NULL;

SELECT 'AFTER: direct grant survives adoption' AS check,
  can('Direct grantee','legacy-proj','form.read') AS got, true AS want
UNION ALL SELECT 'AFTER: site admin still reaches it',
  can('Site admin','legacy-proj','form.read'), true
UNION ALL SELECT 'AFTER: unrelated tenant still blocked',
  can('Alice at A','legacy-proj','form.read'), false
UNION ALL SELECT 'AFTER: direct grantee gained nothing elsewhere',
  can('Direct grantee','proj-a-actee','form.read'), false;
