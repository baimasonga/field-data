// A Form with a geopoint field and Submissions that carry real coordinates,
// so the cross-project map can be checked against geometry rather than an
// empty collection.
const crypto = require('crypto');
const { Client } = require('pg');
// Defaults match the throwaway cluster the README sets up; the environment
// overrides let the same seed run against any database a checkout has.
const db = new Client({
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'odk',
  password: process.env.PGPASSWORD ?? 'odk',
  database: process.env.PGDATABASE ?? 'odk'
});
const one = async (t, v) => (await db.query(t, v)).rows[0];

// Roughly the centre of each district, so the points land on the country.
const DISTRICTS = [
  ['Western Area Urban', 8.484, -13.229], ['Bo', 7.964, -11.739],
  ['Kenema', 7.876, -11.190], ['Kono', 8.650, -10.970],
  ['Bombali', 9.220, -12.190], ['Port Loko', 8.767, -12.787],
  ['Moyamba', 8.160, -12.433], ['Kailahun', 8.277, -10.573],
  ['Pujehun', 7.348, -11.719], ['Koinadugu', 9.780, -11.380]
];

const actee = async (species, parent = null) => {
  const id = crypto.randomUUID();
  await db.query('insert into actees (id, species, parent) values ($1,$2,$3)', [id, species, parent]);
  return id;
};

const main = async () => {
  await db.connect();
  const projectActee = await actee('project');
  const project = await one(
    `insert into projects (name, "acteeId", "createdAt")
     values ('Water Point Mapping', $1, now() - interval '60 days') returning *`, [projectActee]);

  const formActee = await actee('form', project.acteeId);
  const form = await one(
    `insert into forms ("projectId","xmlFormId","acteeId","createdAt",state)
     values ($1,'water-points',$2, now() - interval '55 days', 'open') returning *`,
    [project.id, formActee]);
  const schema = await one('insert into form_schemas default values returning id');
  const def = await one(
    `insert into form_defs ("formId","schemaId",name,version,hash,sha,sha256,xml,"createdAt","publishedAt")
     values ($1,$2,'Water Point Inventory','1',$3,$4,$5,'<x/>', now(), now()) returning id`,
    [form.id, schema.id, crypto.randomBytes(16).toString('hex'),
      crypto.randomBytes(20).toString('hex'), crypto.randomBytes(32).toString('hex')]);
  await db.query('update forms set "currentDefId"=$1 where id=$2', [def.id, form.id]);

  const FIELDS = [
    { path: '/district', name: 'district', type: 'string' },
    { path: '/location', name: 'location', type: 'geopoint' },
    { path: '/working', name: 'working', type: 'string' }
  ];
  for (const [order, field] of FIELDS.entries()) {
    // eslint-disable-next-line no-await-in-loop
    await db.query(
      `insert into form_fields ("formId","schemaId",path,name,type,"order")
       values ($1,$2,$3,$4,$5,$6)`,
      [form.id, schema.id, field.path, field.name, field.type, order]);
  }

  const COUNT = 240;
  for (let i = 0; i < COUNT; i += 1) {
    const [district, lat, lon] = DISTRICTS[i % DISTRICTS.length];
    // Scatter within roughly 30km of the district centre.
    const dLat = (Math.random() - 0.5) * 0.5;
    const dLon = (Math.random() - 0.5) * 0.5;
    const instanceId = `uuid:water-points-${i}`;
    // eslint-disable-next-line no-await-in-loop
    const submission = await one(
      `insert into submissions ("formId","instanceId","createdAt",draft,"reviewState")
       values ($1,$2, now() - ($3 || ' hours')::interval, false, $4) returning id`,
      [form.id, instanceId, Math.floor(Math.random() * 480),
        i % 20 === 0 ? 'hasIssues' : 'approved']);
    // eslint-disable-next-line no-await-in-loop
    await db.query(
      `insert into submission_defs ("submissionId","formDefId","instanceId",xml,"createdAt",current,root)
       values ($1,$2,$3,$4, now(), true, true)`,
      [submission.id, def.id, instanceId,
        `<data><district>${district}</district>` +
        `<location>${(lat + dLat).toFixed(6)} ${(lon + dLon).toFixed(6)} 0 8</location>` +
        `<working>${i % 7 === 0 ? 'no' : 'yes'}</working></data>`]);
  }
  const geo = await one(
    `select count(*)::int c from form_field_geo where formschema_id = $1 and is_default`, [schema.id]);
  console.log(JSON.stringify({ project: project.name, projectId: project.id,
    form: 'water-points', submissions: COUNT, defaultGeoFields: geo.c }));
  await db.end();
};
main().catch(e => { console.error(e.message); process.exit(1); });
