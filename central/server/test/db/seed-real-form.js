// Build a real form and real submissions in a real database, using ODK's own
// XForm parser so form_fields is exactly what an upload would produce.
const fs = require('fs');
const crypto = require('crypto');
const { Client } = require('pg');
const { getFormFields } = require('/home/user/field-data/central/server/lib/data/schema');

const xml = fs.readFileSync('/home/user/field-data/forms/avdp_tree_crops_survey.xml', 'utf8');

// Deterministic pseudo-random so the expected values can be recomputed.
let seed = 20260920;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (list) => list[Math.floor(rnd() * list.length)];

const DISTRICTS = ['bombali', 'kambia', 'port_loko', 'tonkolili'];
const CROPS = ['cocoa', 'coffee', 'cashew', 'oil_palm'];
const SEXES = ['female', 'male'];

const main = async () => {
  const fields = await getFormFields(xml);
  const db = new Client({ host: '127.0.0.1', port: 55432, user: 'postgres', database: 'realdata' });
  await db.connect();

  const actee = async (species, parent = null) => {
    const id = crypto.randomUUID();
    await db.query('insert into actees (id, species, parent) values ($1,$2,$3)', [id, species, parent]);
    return id;
  };

  const projActee = await actee('project');
  const { rows: [project] } = await db.query(
    'insert into projects (name, "acteeId", "createdAt") values ($1,$2,now()) returning id', ['AVDP', projActee]);

  const formActee = await actee('form', projActee);
  const { rows: [schema] } = await db.query('insert into form_schemas default values returning id');
  const { rows: [form] } = await db.query(
    `insert into forms ("projectId", "xmlFormId", state, "acteeId", "createdAt")
     values ($1,$2,'open',$3,now()) returning id`, [project.id, 'avdp_tree_crops_survey', formActee]);

  const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
  const { rows: [def] } = await db.query(
    `insert into form_defs ("formId", xml, hash, sha, sha256, version, name, "createdAt", "publishedAt", "schemaId")
     values ($1,$2,$3,$4,$5,$6,$7,now(),now(),$8) returning id`,
    [form.id, xml, crypto.createHash('md5').update(xml).digest('hex'), sha(xml),
      crypto.createHash('sha256').update(xml).digest('hex'), '2026091901', 'AVDP Tree Crops Survey', schema.id]);
  await db.query('update forms set "currentDefId"=$1 where id=$2', [def.id, form.id]);

  for (const f of fields) {
    await db.query(
      `insert into form_fields ("formId","schemaId",path,name,type,"binary","order","selectMultiple")
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [form.id, schema.id, f.path, f.name, f.type, f.binary ?? null, f.order, f.selectMultiple ?? null]);
  }
  console.log(`form ${form.id}: ${fields.length} fields parsed by ODK`);

  // Submissions, with values recorded so the expected answers can be computed
  // from the same source rather than from the query under test.
  const N = 400;
  const record = [];
  const { rows: [actor] } = await db.query(
    `insert into actors (type,"acteeId","displayName","createdAt") values ('user',$1,'Enumerator',now()) returning id`,
    [await actee('actor')]);

  for (let i = 0; i < N; i += 1) {
    const row = {
      district: pick(DISTRICTS),
      crop: pick(CROPS),
      sex: pick(SEXES),
      // A quarter leave area blank, so coverage is a real number and not 100%.
      area_ha: rnd() < 0.25 ? '' : (Math.round((0.2 + rnd() * 4) * 100) / 100).toFixed(2),
      trees_total: String(10 + Math.floor(rnd() * 490)),
      age: String(20 + Math.floor(rnd() * 50))
    };
    // One deliberately unparseable number, to exercise the regex-guarded cast.
    if (i === 7) row.area_ha = 'about two';
    record.push(row);

    const instanceId = `uuid:${crypto.randomUUID()}`;
    const body = `<data xmlns="" id="avdp_tree_crops_survey" version="2026091901">` +
      Object.entries(row).map(([k, v]) => `<${k}>${v}</${k}>`).join('') +
      `<meta><instanceID>${instanceId}</instanceID></meta></data>`;

    const { rows: [sub] } = await db.query(
      `insert into submissions ("formId","instanceId","submitterId","createdAt",draft)
       values ($1,$2,$3, now() - ($4 || ' hours')::interval, false) returning id`,
      [form.id, instanceId, actor.id, String(i)]);
    await db.query(
      `insert into submission_defs ("submissionId", xml, "formDefId", "instanceId", "submitterId", "createdAt", root, current)
       values ($1,$2,$3,$4,$5,now(),true,true)`,
      [sub.id, body, def.id, instanceId, actor.id]);
  }

  fs.writeFileSync(process.env.SD + '/expected-source.json',
    JSON.stringify({ formId: form.id, projectId: project.id, rows: record }, null, 1));
  console.log(`${N} submissions inserted; source values written for independent checking`);
  await db.end();
};

main().catch((e) => { console.error(e); process.exit(1); });
