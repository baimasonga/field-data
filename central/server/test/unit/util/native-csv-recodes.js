const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { compile, etag, prepare } = require('../../../lib/util/native-csv-recodes');
describe('native CSV value recode snapshots', () => {
  it('maps scalar and multiple values once in their selected version and skips unsupported rule kinds/fields', () => {
    const fields = [{ path: '/water', type: 'string' }, { path: '/lights', type: 'string', selectMultiple: true }, { path: '/point', type: 'geopoint' }];
    const rules = [{ id: 'water', kind: 'value', path: '/water', versions: ['1'], values: { old: 'middle', middle: 'new' } },
      { id: 'lights', kind: 'value', path: '/lights', versions: ['1'], values: { solar: 'sun' } },
      { id: 'moved', kind: 'path', path: '/water', fromPath: '/old_water', versions: ['1'] },
      { id: 'geometry', kind: 'value', path: '/point', versions: ['1'], values: { old: 'new' } }];
    const plan = compile({ fingerprint: 'snapshot', rules }, fields);
    assert.equal(plan.value(fields[0], '1', 'old'), 'middle');
    assert.equal(plan.value(fields[0], '2', 'old'), 'old');
    assert.equal(plan.value(fields[0], '1', null), null);
    assert.equal(plan.value(fields[1], '1', 'solar torch'), 'sun torch');
    assert.equal(plan.manifest.appliedRules.length, 3); assert.equal(plan.manifest.skippedRules.length, 1);
    assert.equal(plan.moves('1')[0].fromPath, '/old_water'); assert.deepEqual(plan.moves('2'), []);
    assert.equal(compile(null, fields), null);
  });
  it('keeps stored export ETags unchanged while distinguishing snapshots that alter the manifest', () => {
    assert.equal(etag('source', null), 'source');
    assert.notEqual(etag('source', { fingerprint: 'one' }), etag('source', { fingerprint: 'two' }));
    assert.notEqual(etag('source', { fingerprint: 'one' }), etag('other', { fingerprint: 'one' }));
  });
  it('rejects unsupported export modes before opening row streams', async () => {
    const form = { id: 1, xmlFormId: 'example', def: { id: 2, version: '2', keyId: null } };
    const auth = { canOrReject: async () => {} }; const db = { any: async () => [] };
    assert.equal(await prepare(db, auth, form, false, {}), null);
    await Promise.all([[true, { valueRecodes: 'true' }, false], [false, { valueRecodes: 'true' }, true], [false, { valueRecodes: 'true', splitSelectMultiples: 'TRUE' }, false], [false, { valueRecodes: 'bad' }, false]].map(([draft, query, root]) => assert.rejects(prepare(db, auth, form, draft, query, root))));
    await assert.rejects(prepare(db, auth, { ...form, def: { ...form.def, keyId: 1 } }, false, { valueRecodes: 'true' }));
  });
  it('rejects corrupt or ambiguous rules and fingerprints definition and download settings', async () => {
    const form = { id: 1, xmlFormId: 'example', def: { id: 2, version: '2', keyId: null } };
    const auth = { canOrReject: async () => {} }; const rule = { id: 'one', kind: 'value', path: '/water', versions: ['1'], values: { old: 'new' } };
    await Promise.all([[{ ...rule, values: null }], [rule, { ...rule, id: 'two' }], [{ id: 'move1', kind: 'path', path: '/water', fromPath: '/old', versions: ['1'] }, { id: 'move2', kind: 'path', path: '/water', fromPath: '/other', versions: ['1'] }], Array.from({ length: 201 }, () => rule)].map(rules => assert.rejects(prepare({ any: async () => rules }, auth, form, false, { valueRecodes: 'true' }))));
    const db = { any: async () => [rule] }; const query = { valueRecodes: 'true' };
    const original = await prepare(db, auth, form, false, query);
    const grouped = await prepare(db, auth, form, false, { ...query, groupPaths: 'false' });
    const published = await prepare(db, auth, { ...form, def: { ...form.def, id: 3 } }, false, query);
    const legacy = createHash('sha256').update(JSON.stringify({ source: original.source, filter: null, rules: [rule] })).digest('hex');
    assert.notEqual(original.fingerprint, legacy);
    assert.notEqual(original.fingerprint, grouped.fingerprint); assert.notEqual(original.fingerprint, published.fingerprint);
  });

});
