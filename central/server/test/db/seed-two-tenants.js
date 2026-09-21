// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Two organizations, each owning a Project with a Form and Submissions, and
// five people holding five different grants. Everything the tenancy claim
// rests on can be asked of this: that a role granted on one organization
// reaches its Projects and nothing else.
//
// Sessions are inserted directly rather than logged into, because password
// hashing is not what is under test and a fixed token makes the HTTP checks
// readable.
const crypto = require('crypto');
const { Client } = require('pg');

// Defaults match the repository's own throwaway cluster; the environment
// overrides let the same seed run against any database a checkout has.
const db = new Client({
  host: process.env.PGHOST ?? '/var/tmp',
  port: Number(process.env.PGPORT ?? 55432),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE ?? 'odktest'
});

const one = async (text, values) => (await db.query(text, values)).rows[0];

const actee = async (species, parent = null) => {
  const id = crypto.randomUUID();
  await db.query('insert into actees (id, species, parent) values ($1,$2,$3)', [id, species, parent]);
  return id;
};

const person = async (displayName, email) => {
  const id = await actee('actor');
  const actor = await one(
    `insert into actors (type, "acteeId", "displayName", "createdAt")
     values ('user', $1, $2, now()) returning id`, [id, displayName]);
  await db.query('insert into users ("actorId", email) values ($1,$2)', [actor.id, email]);
  // Session tokens are validated by shape before the database is consulted:
  // exactly 64 characters of [A-Za-z0-9!$] (lib/util/crypto.js, isValidToken).
  // Anything else is refused as unauthenticated without a query, which looks
  // exactly like a permission failure and is not one.
  const token = `tok${displayName.replace(/[^a-z]/gi, '')}`.padEnd(64, 'x');
  await db.query(
    `insert into sessions ("actorId", token, "expiresAt", "createdAt", csrf)
     values ($1,$2, now() + interval '1 day', now(), $3)`,
    // sessions.csrf is varchar(64), and so is the token: prefixing one with
    // the other overflows the column and the seed dies half-written.
    [actor.id, token, `csrf${displayName.replace(/[^a-z]/gi, '')}`.padEnd(64, 'y')]);
  return { ...actor, acteeId: id, token, displayName };
};

const grant = async (actorId, roleSystem, acteeId) => db.query(
  `insert into assignments ("actorId","roleId","acteeId")
   select $1, r.id, $2 from roles r where r.system = $3`, [actorId, acteeId, roleSystem]);

const organization = async (name, slug) => {
  const id = await actee('organization');
  const org = await one(
    `insert into field_data_organizations (name, slug, "acteeId", "createdAt")
     values ($1,$2,$3, now()) returning *`, [name, slug, id]);
  return org;
};

// A Project owned by an organization: its actee's parent is the organization's,
// which is the entire mechanism. can() walks that parent chain already.
const ownedProject = async (name, org) => {
  const id = await actee('project', org.acteeId);
  const project = await one(
    `insert into projects (name, "acteeId", "createdAt") values ($1,$2, now()) returning *`,
    [name, id]);
  await db.query(
    `insert into field_data_organization_projects ("organizationId","projectId") values ($1,$2)`,
    [org.id, project.id]);
  return project;
};

const formWithSubmissions = async (project, xmlFormId, districts) => {
  const id = await actee('form', project.acteeId);
  const form = await one(
    `insert into forms ("projectId","xmlFormId","acteeId","createdAt")
     values ($1,$2,$3, now()) returning *`, [project.id, xmlFormId, id]);
  const schema = await one('insert into form_schemas default values returning id');
  const def = await one(
    `insert into form_defs ("formId","schemaId",name,version,hash,sha,sha256,xml,"createdAt","publishedAt")
     values ($1,$2,$3,'1',$4,$5,$6,'<x/>', now(), now()) returning id`,
    [form.id, schema.id, `${xmlFormId} form`, 'a'.repeat(32), 'b'.repeat(40), 'c'.repeat(64)]);
  await db.query('update forms set "currentDefId"=$1 where id=$2', [def.id, form.id]);
  const FIELDS = [
    { path: '/district', type: 'string' },
    { path: '/hh_size', type: 'int' }
  ];
  for (const [order, field] of FIELDS.entries()) {
    // eslint-disable-next-line no-await-in-loop
    await db.query(
      `insert into form_fields ("formId","schemaId",path,name,type,"order")
       values ($1,$2,$3,$4,$5,$6)`,
      [form.id, schema.id, field.path, field.path.slice(1), field.type, order]);
  }
  for (let index = 0; index < districts.length; index += 1) {
    const instanceId = `uuid:${xmlFormId}-${index}`;
    // eslint-disable-next-line no-await-in-loop
    const submission = await one(
      `insert into submissions ("formId","instanceId","createdAt",draft)
       values ($1,$2, now(), false) returning id`, [form.id, instanceId]);
    // eslint-disable-next-line no-await-in-loop
    await db.query(
      `insert into submission_defs ("submissionId","formDefId","instanceId",xml,"createdAt",current,root)
       values ($1,$2,$3,$4, now(), true, true)`,
      [submission.id, def.id, instanceId,
        `<data><district>${districts[index]}</district><hh_size>6</hh_size></data>`]);
  }
  return form;
};

const main = async () => {
  await db.connect();

  const orgA = await organization('Agency A', 'agency-a');
  const orgB = await organization('Agency B', 'agency-b');
  const projectA = await ownedProject('A field work', orgA);
  const projectB = await ownedProject('B field work', orgB);
  // Six of one district and one of another, so the shared-dashboard floor has
  // something to suppress and something to publish.
  const formA = await formWithSubmissions(projectA, 'survey-a',
    ['Bombali', 'Bombali', 'Bombali', 'Bombali', 'Bombali', 'Bombali', 'Kono']);
  const formB = await formWithSubmissions(projectB, 'survey-b', ['Kambia', 'Kambia']);

  const admin = await person('Site Admin', 'admin@example.test');
  await grant(admin.id, 'admin', '*');
  const ownerA = await person('Owner A', 'owner-a@example.test');
  await grant(ownerA.id, 'owner', orgA.acteeId);
  const viewerA = await person('Viewer A', 'viewer-a@example.test');
  await grant(viewerA.id, 'viewer', orgA.acteeId);
  const managerB = await person('Manager B', 'manager-b@example.test');
  await grant(managerB.id, 'manager', orgB.acteeId);
  const outsider = await person('Outsider', 'outsider@example.test');

  const out = {
    orgA: { ...orgA }, orgB: { ...orgB },
    projectA: { id: projectA.id, acteeId: projectA.acteeId },
    projectB: { id: projectB.id, acteeId: projectB.acteeId },
    formA: { id: formA.id, xmlFormId: formA.xmlFormId, acteeId: formA.acteeId },
    formB: { id: formB.id, xmlFormId: formB.xmlFormId, acteeId: formB.acteeId },
    people: Object.fromEntries([admin, ownerA, viewerA, managerB, outsider]
      .map(p => [p.displayName.replace(/\s/g, ''), { id: p.id, token: p.token }]))
  };
  require('fs').writeFileSync(process.env.OUT ?? '/tmp/tenants.json', JSON.stringify(out, null, 2));
  console.log('seeded:', JSON.stringify({
    orgA: orgA.id, orgB: orgB.id, projectA: projectA.id, projectB: projectB.id,
    people: Object.keys(out.people)
  }));
  await db.end();
};

main().catch(async (error) => { console.error('FAILED:', error.message); await db.end(); process.exit(1); });
