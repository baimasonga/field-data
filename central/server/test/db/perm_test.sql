\set ON_ERROR_STOP on

-- Two tenants, each with a project, plus one actor per tenant and a sitewide admin.
INSERT INTO actees (id, species, parent) VALUES ('org-a-actee','organization',NULL),('org-b-actee','organization',NULL);
INSERT INTO field_data_organizations (name, slug, "acteeId") VALUES ('Agency A','agency-a','org-a-actee'),('Agency B','agency-b','org-b-actee');

INSERT INTO actees (id, species, parent) VALUES ('proj-a-actee','project','org-a-actee'),('proj-b-actee','project','org-b-actee');
INSERT INTO projects (name, "acteeId", "createdAt") VALUES ('A project','proj-a-actee',now()),('B project','proj-b-actee',now());
INSERT INTO field_data_organization_projects ("organizationId","projectId")
  SELECT o.id, p.id FROM field_data_organizations o JOIN projects p ON p."acteeId" = 'proj-' || substring(o.slug from 8) || '-actee';

INSERT INTO actees (id, species) VALUES ('actor-a','actor'),('actor-b','actor'),('actor-admin','actor');
INSERT INTO actors (type, "acteeId", "displayName", "createdAt")
  VALUES ('user','actor-a','Alice at A',now()),('user','actor-b','Bob at B',now()),('user','actor-admin','Site admin',now());

-- Alice gets manager ON THE ORGANIZATION, not on the project.
INSERT INTO assignments ("actorId","roleId","acteeId")
  SELECT a.id, r.id, 'org-a-actee' FROM actors a, roles r
  WHERE a."displayName"='Alice at A' AND r.system='manager';
INSERT INTO assignments ("actorId","roleId","acteeId")
  SELECT a.id, r.id, 'org-b-actee' FROM actors a, roles r
  WHERE a."displayName"='Bob at B' AND r.system='manager';
-- The sitewide admin holds '*', exactly as before organizations existed.
INSERT INTO assignments ("actorId","roleId","acteeId")
  SELECT a.id, r.id, '*' FROM actors a, roles r
  WHERE a."displayName"='Site admin' AND r.system='admin';
