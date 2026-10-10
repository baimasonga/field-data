// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// R1 receipt ledger through the real upload paths and routes:
// docs/field-intelligence/R1-receipt-ledger.md

require('should');
const { generateKeyPairSync, verify, createPublicKey } = require('crypto');
const config = require('config');
const { sql } = require('slonik');
const { knexConnect } = require('../../../lib/model/knex-migrator');
const migration = require('../../../lib/model/migrations/20261010-07-add-receipt-ledger');
const { receiptHash } = require('../../../lib/util/receipts');
const { testService, testServiceFullTrx } = require('../setup');
const testData = require('../../data/xml');

/* eslint-disable no-await-in-loop */

const post = (user, xml) => user.post('/v1/projects/1/forms/simple/submissions').send(xml).set('Content-Type', 'application/xml').expect(200);
const receipts = (all) => all(sql`SELECT * FROM field_data_receipts WHERE "projectId" = 1 ORDER BY seq`);
const withKey = async (fn) => {
  const saved = { key: process.env.FIELD_DATA_OFFLINE_SIGNING_KEY, origin: process.env.FIELD_DATA_OFFLINE_ORIGIN };
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  process.env.FIELD_DATA_OFFLINE_SIGNING_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });
  process.env.FIELD_DATA_OFFLINE_ORIGIN = 'https://field.example.test';
  try { await fn(publicKey); } finally {
    for (const [name, value] of [['FIELD_DATA_OFFLINE_SIGNING_KEY', saved.key], ['FIELD_DATA_OFFLINE_ORIGIN', saved.origin]])
      if (value == null) delete process.env[name]; else process.env[name] = value;
  }
};

describe('api: R1 receipt ledger', () => {
  it('writes a chained receipt for every upload and edit, and verifies chain and content', testService(async (service, { all, run, Submissions }) => {
    const alice = await service.login('alice');
    const collector = (await alice.post('/v1/projects/1/app-users').send({ displayName: 'Collector' }).expect(200)).body;
    await alice.post(`/v1/projects/1/forms/simple/assignments/app-user/${collector.id}`).expect(200);
    await post(alice, testData.instances.simple.one);
    await post(alice, testData.instances.simple.two);
    await service.post(`/v1/key/${collector.token}/projects/1/forms/simple/submissions`)
      .send(testData.instances.simple.three).set('Content-Type', 'application/xml').expect(200);
    await alice.put('/v1/projects/1/forms/simple/submissions/one')
      .send(testData.instances.simple.one.replace('one</instanceID>', 'one2</instanceID><deprecatedID>one</deprecatedID>').replace('<age>30</age>', '<age>31</age>'))
      .set('Content-Type', 'application/xml').expect(200);

    const rows = await receipts(all);
    rows.map((r) => [r.seq, r.instanceId, r.backfilled]).should.eql([[1, 'one', false], [2, 'two', false], [3, 'three', false], [4, 'one2', false]]);
    rows[2].submitterId.should.equal(collector.id);
    rows[0].prevHash.should.equal('0'.repeat(64));
    // The database's hashes are the ones the documented format gives.
    for (const r of rows) receiptHash(r).should.equal(r.entryHash);
    rows.slice(1).forEach((r, i) => r.prevHash.should.equal(rows[i].entryHash));

    const verified = (await alice.get('/v1/projects/1/receipts/verify').expect(200)).body;
    verified.should.containEql({ entries: 4, purged: 0, chain: { verified: true, firstProblem: null }, content: { changed: 0, listed: [] } });
    verified.head.should.eql({ seq: 4, entryHash: rows[3].entryHash });

    // Stored content changed after receipt is reported.
    await run(sql`UPDATE submission_defs SET xml = xml || ' ' WHERE "instanceId" = 'two'`);
    (await alice.get('/v1/projects/1/receipts/verify').expect(200)).body.content
      .should.eql({ changed: 1, listed: [{ seq: 2, xmlFormId: 'simple', instanceId: 'two' }] });

    // Receipts cannot be changed or removed.
    // (Each refused statement inside a savepoint, so the test's transaction goes on.)
    const refused = async (statement) => {
      await run(sql`SAVEPOINT refused`);
      await run(statement).should.be.rejectedWith(/append-only/);
      await run(sql`ROLLBACK TO SAVEPOINT refused`);
    };
    await refused(sql`UPDATE field_data_receipts SET "contentHash" = ${'d'.repeat(64)} WHERE seq = 2`);
    await refused(sql`UPDATE field_data_receipts SET "submissionDefId" = NULL, "instanceId" = 'x' WHERE seq = 2`);
    await refused(sql`UPDATE field_data_receipts SET "submissionDefId" = (SELECT "submissionDefId" FROM field_data_receipts WHERE seq = 1) WHERE seq = 2`);
    await refused(sql`DELETE FROM field_data_receipts WHERE seq = 1`);

    // A purged submission's receipt stays, without the link.
    await alice.delete('/v1/projects/1/forms/simple/submissions/three').expect(200);
    await Submissions.purge(true);
    const after = (await alice.get('/v1/projects/1/receipts/verify').expect(200)).body;
    after.should.containEql({ entries: 4, purged: 1, chain: { verified: true, firstProblem: null } });
    (await receipts(all))[2].should.containEql({ instanceId: 'three', submissionDefId: null });
  }));

  it('signs the head when a key is configured, and shows collectors only their own receipts', testService(async (service) => {
    const alice = await service.login('alice');
    const chelsea = await service.login('chelsea');
    const chelseaId = (await chelsea.get('/v1/users/current').expect(200)).body.id;
    const collectors = [];
    for (const name of ['One', 'Two']) {
      const c = (await alice.post('/v1/projects/1/app-users').send({ displayName: name }).expect(200)).body;
      await alice.post(`/v1/projects/1/forms/simple/assignments/app-user/${c.id}`).expect(200);
      collectors.push(c);
    }
    await service.post(`/v1/key/${collectors[0].token}/projects/1/forms/simple/submissions`)
      .send(testData.instances.simple.one).set('Content-Type', 'application/xml').expect(200);
    await post(alice, testData.instances.simple.two);

    const unsigned = (await alice.get('/v1/projects/1/receipts/head').expect(200)).body;
    unsigned.should.containEql({ projectId: 1, seq: 2, signed: null });
    await withKey(async (publicKey) => {
      const { body } = await alice.get('/v1/projects/1/receipts/head').expect(200);
      body.should.containEql({ seq: 2, entryHash: unsigned.entryHash });
      const payload = Buffer.from(body.signed.payload, 'base64url');
      verify('sha256', payload, { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(body.signed.signature, 'base64url')).should.be.true();
      verify('sha256', payload, { key: createPublicKey({ key: body.signed.publicKey, format: 'jwk' }), dsaEncoding: 'ieee-p1363' },
        Buffer.from(body.signed.signature, 'base64url')).should.be.true();
      JSON.parse(payload.toString()).should.containEql({ schemaVersion: 'receipt-head@1', audience: 'https://field.example.test', projectId: 1, seq: 2, entryHash: unsigned.entryHash });
    });

    const mine = (token) => service.get('/v1/field-data/app-user/receipts').set('Authorization', `Bearer ${token}`);
    const first = (await mine(collectors[0].token).expect(200)).body;
    first.receipts.map((r) => [r.seq, r.instanceId, r.formName]).should.eql([[1, 'one', 'Simple']]);
    first.receipts[0].should.have.properties(['receivedAt', 'contentHash', 'entryHash']);
    first.head.should.containEql({ seq: 2 });
    (await mine(collectors[1].token).expect(200)).body.receipts.should.eql([]);
    await alice.get('/v1/field-data/app-user/receipts').expect(403);

    // Managers verify; project readers see the head; others nothing.
    await chelsea.get('/v1/projects/1/receipts/head').expect(403);
    await alice.post(`/v1/projects/1/assignments/viewer/${chelseaId}`).expect(200);
    await chelsea.get('/v1/projects/1/receipts/head').expect(200);
    await chelsea.get('/v1/projects/1/receipts/verify').expect(403);
    await service.get('/v1/projects/1/receipts/head').set('Authorization', `Bearer ${collectors[0].token}`).expect(403);
    await alice.get('/v1/projects/99/receipts/verify').expect(404);
  }));

  it('keeps receipts on a rollback and backfills what arrived meanwhile', testServiceFullTrx(async (service) => {
    const alice = await service.login('alice');
    await post(alice, testData.instances.simple.one);
    const db = knexConnect(config.get('test.database'));
    try {
      await db.transaction(async (trx) => {
        await migration.down(trx);
        (await trx.raw('SELECT count(*)::integer AS n FROM field_data_receipts')).rows[0].n.should.equal(1);
      });
      await post(alice, testData.instances.simple.two);
      await db.transaction(async (trx) => { await migration.up(trx); });
      const { rows } = await db.raw('SELECT seq, "instanceId", backfilled FROM field_data_receipts WHERE "projectId" = 1 ORDER BY seq');
      rows.should.eql([{ seq: 1, instanceId: 'one', backfilled: false }, { seq: 2, instanceId: 'two', backfilled: true }]);
    } finally { await db.destroy(); }
    (await alice.get('/v1/projects/1/receipts/verify').expect(200)).body.chain.verified.should.be.true();
    await post(alice, testData.instances.simple.three);
    (await alice.get('/v1/projects/1/receipts/verify').expect(200)).body.should.containEql({ entries: 3, backfilled: 1 });
  }));

  it('keeps one unbroken chain when uploads arrive at the same time', testServiceFullTrx(async (service) => {
    const alice = await service.login('alice');
    await Promise.all(Array.from({ length: 8 }, (_, i) =>
      post(alice, testData.instances.simple.one.replace('one</instanceID>', `parallel${i}</instanceID>`))));
    (await alice.get('/v1/projects/1/receipts/verify').expect(200)).body
      .should.containEql({ entries: 8, chain: { verified: true, firstProblem: null } });
  }));
});
