const assert = require('node:assert/strict');
const { testService, testServiceFullTrx } = require('../../setup');
const xml = require('../../../data/xml');
const root = '/v1/projects/1/forms/simple';
const revision = version => xml.forms.simple.replace('id="simple"', `id="simple" version="${version}"`);
const setup = async service => {
  const alice = await service.login('alice');
  const initial = (await alice.get(root).expect(200)).body;
  const revise = version => alice.post(`${root}/versions`).set('If-Match', `"sha256:${initial.sha256}"`).set('Content-Type', 'application/xml').send(revision(version));
  return { alice, initial, revise };
};
describe('api: atomic form revision', () => {
  it('requires an exact published fingerprint, authorization, and no existing draft', testService(async service => {
    const { alice, initial, revise } = await setup(service);
    await alice.post(`${root}/versions`).set('Content-Type', 'application/xml').send(revision('2')).expect(428);
    await alice.post(`${root}/versions`).set('If-Match', `"sha256:${'0'.repeat(64)}"`).set('Content-Type', 'application/xml').send(revision('2'))
      .expect(412);
    await service.post(`${root}/versions`).send(revision('2')).expect(401);
    const viewer = await service.login('chelsea');
    await viewer.post(`${root}/versions`).set('Content-Type', 'application/xml').send(revision('2')).expect(403);
    await alice.post(`${root}/draft`).set('Content-Type', 'application/xml').send(revision('editor')).expect(200);
    await alice.post(`${root}/draft/submissions`).set('Content-Type', 'application/xml').send(xml.instances.simple.one.replace('id="simple"', 'id="simple" version="editor"')).expect(200);
    await revise('2').expect(412);
    await alice.get(`${root}/draft/submissions/one.xml`).expect(200);
    assert.equal((await alice.get(root).expect(200)).body.sha256, initial.sha256);
    assert.equal((await alice.get(`${root}/draft`).expect(200)).body.version, 'editor');
  }));
  it('publishes in one transaction, retains the previous version and rejects stale retries', testService(async service => {
    const { alice, initial, revise } = await setup(service);
    const result = (await revise('2').expect(200)).body;
    assert.equal(result.version, '2'); assert.ok(result.publishedAt);
    await alice.get(`${root}/draft`).expect(404);
    await revise('3').expect(412);
    const versions = (await alice.get(`${root}/versions`).expect(200)).body;
    assert.deepEqual(versions.map(row => row.sha256), [result.sha256, initial.sha256]);
  }));
  it('rolls back invalid revisions without leaving a draft or changing publication', testService(async service => {
    const { alice, initial } = await setup(service);
    await alice.post(`${root}/versions`).set('If-Match', `"sha256:${initial.sha256}"`).set('Content-Type', 'application/xml').send('<broken')
      .expect(400);
    await alice.get(`${root}/draft`).expect(404);
    assert.equal((await alice.get(root).expect(200)).body.sha256, initial.sha256);
  }));
  it('rolls back the created draft if publication rejects an already-published version', testServiceFullTrx(async service => {
    const { alice, initial } = await setup(service);
    await alice.post(`${root}/versions`).set('If-Match', `"sha256:${initial.sha256}"`).set('Content-Type', 'application/xml').send(xml.forms.simple)
      .expect(409);
    await alice.get(`${root}/draft`).expect(404);
    assert.equal((await alice.get(root).expect(200)).body.sha256, initial.sha256);
    assert.equal((await alice.get(`${root}/versions`).expect(200)).body.length, 1);
  }));
  it('serializes competing conditional revisions so only one can publish', testServiceFullTrx(async service => {
    const { alice, revise } = await setup(service);
    const responses = await Promise.all([revise('2'), revise('3')]);
    assert.deepEqual(responses.map(row => row.status).sort(), [200, 412]);
    assert.equal((await alice.get(root).expect(200)).body.version, responses.find(row => row.status === 200).body.version);
    await alice.get(`${root}/draft`).expect(404);
  }));
  it('never consumes a concurrent normal editor draft', testServiceFullTrx(async service => {
    const { alice, initial, revise } = await setup(service);
    const responses = await Promise.all([revise('2'), alice.post(`${root}/draft`).set('Content-Type', 'application/xml').send(revision('editor'))]);
    assert.ok([200, 412].includes(responses[0].status)); assert.equal(responses[1].status, 200);
    assert.equal((await alice.get(`${root}/draft`).expect(200)).body.version, 'editor');
    assert.equal((await alice.get(root).expect(200)).body.version, responses[0].status === 200 ? '2' : initial.version);
  }));
});
