// Seeds a programme the size of the reference mockup, so the dashboard can be
// judged at a realistic scale rather than on two projects.
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

const actee = async (species, parent = null) => {
  const id = crypto.randomUUID();
  await db.query('insert into actees (id, species, parent) values ($1,$2,$3)', [id, species, parent]);
  return id;
};

const project = async (name, archived) => {
  const id = await actee('project');
  return one(
    `insert into projects (name, "acteeId", archived, "createdAt")
     values ($1,$2,$3, now() - interval '120 days') returning *`, [name, id, archived]);
};

// Submissions are spread over the last 21 days with a mild upward drift, so the
// trend chart has a shape to test rather than a flat block.
const form = async (proj, xmlFormId, title, published, submissions, states) => {
  const id = await actee('form', proj.acteeId);
  const f = await one(
    `insert into forms ("projectId","xmlFormId","acteeId","createdAt",state)
     values ($1,$2,$3, now() - interval '100 days', 'open') returning *`, [proj.id, xmlFormId, id]);
  const schema = await one('insert into form_schemas default values returning id');
  const def = await one(
    `insert into form_defs ("formId","schemaId",name,version,hash,sha,sha256,xml,"createdAt","publishedAt")
     values ($1,$2,$3,'1',$4,$5,$6,'<x/>', now() - interval '100 days', $7) returning id`,
    [f.id, schema.id, title, crypto.randomBytes(16).toString('hex'),
      crypto.randomBytes(20).toString('hex'), crypto.randomBytes(32).toString('hex'),
      published ? new Date(Date.now() - 100 * 864e5) : null]);
  if (published) await db.query('update forms set "currentDefId"=$1 where id=$2', [def.id, f.id]);
  else await db.query('update forms set "draftDefId"=$1 where id=$2', [def.id, f.id]);
  if (submissions === 0) return f;

  // One bulk insert per form. generate_series gives each row a day offset that
  // rises toward the present, which is what the 21-day chart is meant to show.
  await db.query(
    `insert into submissions ("formId","instanceId","createdAt",draft,"reviewState")
     select $1,
            'uuid:' || $2 || '-' || g,
            now() - (((20 - floor(g::numeric * 21 / $3)) + random() * 0.9) || ' days')::interval,
            false,
            (case when g % 100 < $4 then 'approved'
                  when g % 100 < $4 + $5 then 'hasIssues'
                  when g % 100 < $4 + $5 + $6 then 'rejected'
                  else null end)::text
     from generate_series(0, $3 - 1) g`,
    [f.id, xmlFormId, submissions, states.approved, states.issues, states.rejected]);
  await db.query(
    `insert into submission_defs ("submissionId","formDefId","instanceId",xml,"createdAt",current,root)
     select s.id, $1, s."instanceId", '<data><district>Bo</district></data>', s."createdAt", true, true
     from submissions s where s."formId" = $2`, [def.id, f.id]);
  return f;
};

const PROGRAMME = [
  ['Tree Crops Yield Survey', false, 6, 5, 4230],
  ['Housing Survey 2026', false, 8, 7, 2914],
  ['Farmer Registration', false, 5, 5, 2108],
  ['Market Price Monitoring', false, 4, 4, 1876],
  ['WASH Facility Assessment', false, 3, 2, 742],
  ['Health Centre Audit', false, 4, 3, 616],
  ['Education Infrastructure', false, 3, 2, 0],
  ['Livelihoods Baseline', false, 6, 4, 0]
];

const main = async () => {
  await db.connect();
  let total = 0;
  for (const [name, archived, forms, published, submissions] of PROGRAMME) {
    const p = await project(name, archived);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    for (let i = 0; i < forms; i += 1) {
      const isPublished = i < published;
      // The whole project's submissions land on its first form; the rest carry
      // a share, so form counts and submission counts are not the same number.
      const share = !isPublished || submissions === 0 ? 0
        : (i === 0 ? Math.round(submissions * 0.5) : Math.round(submissions * 0.5 / (published - 1)));
      await form(p, `${slug}-${i + 1}`, `${name} · module ${i + 1}`, isPublished, share,
        { approved: 92, issues: 5, rejected: 3 });
      total += share;
    }
  }
  const counted = await one('select count(*)::int c from submissions');
  console.log('projects:', PROGRAMME.length, 'submissions inserted:', total, 'in db:', counted.c);
  await db.end();
};
main().catch((e) => { console.error(e.message); process.exit(1); });
