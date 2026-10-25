const assert = require('node:assert/strict');
const { checkedDefinition, graphDiagnostics, decide, causal, geography, ASSUMPTIONS } = require('../../../lib/util/knowledge-models');
const fact = (value, patch = {}) => ({ id: `fact-${value}`, value, state: 'known', integrityStatus: 'verified', freshness: { status: 'fresh' }, validFrom: '2026-10-01T00:00:00Z', source: { claimVersionId: 'claim' }, ...patch });
const contract = patch => checkedDefinition({ kind: 'causal', nodes: ['T', 'Y', 'C'], edges: [['C', 'T'], ['C', 'Y'], ['T', 'Y']], treatment: 'T', outcome: 'Y', adjustments: ['C'], assumptions: Object.fromEntries(ASSUMPTIONS.map(key => [key, true])), rationale: 'Declare measured baseline confounding and review timing, consistency and selection limitations.', ...patch });
const sample = () => ({ truncated: false, assets: Array.from({ length: 8 }, (_, i) => ({ id: `asset-${i}`, name: `Asset ${i}`, facts: { T: fact(i % 2 ? '1' : '0', { validFrom: '2026-10-02T00:00:00Z' }), Y: fact(String(10 + (i % 2 ? 4 : 0) + Math.floor(i / 4)), { validFrom: '2026-10-03T00:00:00Z' }), C: fact(i < 4 ? 'north' : 'south') } })) });
describe('complete Knowledge models', () => {
  it('checks backdoor paths, collider conditioning, descendants and graph cycles', () => {
    assert.equal(graphDiagnostics(contract()).identified, true);
    assert.equal(graphDiagnostics(contract({ adjustments: [] })).identified, false);
    const collider = contract({ nodes: ['T', 'Y', 'A', 'B', 'K'], edges: [['A', 'T'], ['A', 'K'], ['B', 'K'], ['B', 'Y'], ['T', 'Y']], adjustments: [] });
    assert.equal(graphDiagnostics(collider).identified, true);
    assert.equal(graphDiagnostics({ ...collider, adjustments: ['K'] }).identified, false);
    const descendant = contract({ nodes: ['T', 'Y', 'M'], edges: [['T', 'Y'], ['T', 'M']], adjustments: ['M'] });
    assert.equal(graphDiagnostics(descendant).identified, false);
    assert.throws(() => contract({ edges: [['T', 'Y'], ['Y', 'T']] }), /acyclic/);
    assert.throws(() => contract({ adjustments: ['Y'] }));
  });
  it('computes a reproducible conditional stratum-weighted effect and explicit provenance', () => {
    const result = causal(sample(), contract());
    assert.equal(result.estimate.effect, 4); assert.equal(result.eligible, 8); assert.equal(result.strata.length, 2);
    assert.equal(result.included[0].observationIds.length, 3); assert.equal(result.withheldReasons.length, 0);
    assert.ok(Number.isFinite(result.estimate.standardError));
    const variable = sample(); variable.assets = variable.assets.slice(0, 4); [1, 5, 3, 7].forEach((value, i) => { variable.assets[i].facts.Y.value = String(value); });
    const unadjusted = causal(variable, contract({ nodes: ['T', 'Y'], edges: [['T', 'Y']], adjustments: [] }));
    assert.equal(unadjusted.estimate.effect, 4); assert.ok(Math.abs(unadjusted.estimate.standardError - Math.sqrt(2)) < 1e-10);
    assert.match(result.limitations, /unverified assumptions/);
  });
  it('withholds for incomplete frames, timing, missingness, overlap and undeclared assumptions', () => {
    assert.equal(causal({ ...sample(), truncated: true }, contract()).estimate, null);
    assert.equal(causal({ ...sample(), at: '2026-10-25T00:00:00Z', knownAt: '2026-10-24T00:00:00Z' }, contract()).estimate, null);
    const noControls = sample(); noControls.assets = noControls.assets.filter(asset => asset.facts.T.value === '1');
    assert.match(causal(noControls, contract()).withheldReasons.join(' '), /overlap/);
    const invalidTime = sample(); for (const asset of invalidTime.assets) asset.facts.Y.validFrom = '2026-09-01T00:00:00Z';
    assert.equal(causal(invalidTime, contract()).excluded.timing, 8);
    const missing = sample(); missing.assets[0].facts.C.integrityStatus = 'unverified';
    assert.equal(causal(missing, contract()).excluded.unavailable, 1);
    assert.equal(causal(sample(), contract({ assumptions: { ...contract().assumptions, exchangeability: false } })).estimate, null);
    const bad = sample(); bad.assets[0].facts.Y.value = '0x10'; assert.equal(causal(bad, contract()).excluded.invalidValue, 1);
    const overflow = sample(); for (const asset of overflow.assets) asset.facts.Y.value = '1e308';
    assert.match(causal(overflow, contract()).withheldReasons.join(' '), /finite estimate/);
  });
  it('evaluates action rules from fresh evidence without turning unknown or invalid numbers into matches', () => {
    const definition = checkedDefinition({ kind: 'decision', rules: [{ predicate: 'condition', operator: 'eq', value: 'broken', priority: 1, action: 'Review repair.' }, { predicate: 'age', operator: 'gte', value: '5', priority: 2, action: 'Inspect age.' }] });
    const result = decide({ assets: [{ id: 'a', name: 'Pump', facts: { condition: fact('broken'), age: fact('unknown') } }, { id: 'b', name: 'Other', facts: {} }] }, definition);
    assert.equal(result.rows[0].priority, 1); assert.equal(result.rows[0].matched[0].source.claimVersionId, 'claim'); assert.equal(result.rows[1].status, 'insufficient-evidence');
    assert.throws(() => checkedDefinition({ kind: 'decision', rules: [{ ...definition.rules[0], priority: 0 }] }));
    assert.throws(() => checkedDefinition({ kind: 'decision', rules: [{ ...definition.rules[1], value: 'Infinity' }] }));
  });
  it('classifies polygon overlap, outside, accuracy-boundary uncertainty and unavailable points', () => {
    const geometry = { type: 'Polygon', coordinates: [[[0, 1], [2, 1], [2, 3], [0, 3], [0, 1]]] };
    const assets = [{ id: 'a', name: 'Boundary', facts: { location: fact('1.00001 1 0 10') } }, { id: 'b', name: 'Outside', facts: { location: fact('5 5') } }, { id: 'c', name: 'Unknown', facts: {} }];
    const result = geography({ assets }, 'location', [{ value: 'A', geometry }, { value: 'B', geometry }]);
    assert.equal(result.features[0].properties.area, 'Overlapping areas'); assert.equal(result.features[0].properties.boundaryUncertain, true);
    assert.equal(result.features[1].properties.area, 'Outside areas'); assert.equal(result.unavailable.length, 1);
    assert.deepEqual(result.features[0].geometry.coordinates, [1, 1.00001]);
    assert.throws(() => checkedDefinition({ kind: 'geography', locationPredicate: 'location', areas: [{ value: 'Invalid', geometry: { type: 'Point', coordinates: [0, 0] } }] }));
  });
});
