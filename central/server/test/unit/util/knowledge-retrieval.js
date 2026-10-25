const assert = require('node:assert/strict');
const { scoreCorpus, tokens } = require('../../../lib/util/knowledge-retrieval');
describe('request-local cited semantic retrieval', () => {
  const corpus = ['pump water maintenance repair broken source', 'well water drinking clean household', 'pump well repair water', 'school class lesson student', 'school teacher class lesson', 'health clinic medicine patient'].map((text, i) => ({ id: String(i), text, source: { claimVersionId: `claim-${i}` } }));
  it('fits actual corpus-derived latent directions and retrieves related content without a literal query phrase', () => {
    const result = scoreCorpus(corpus, 'pump', 'semantic');
    assert.equal(result.method, 'request-local-latent-semantic@1');
    assert.ok(result.results.some(row => row.id === '1' && !row.literalMatch));
    assert.equal(result.results[0].source.claimVersionId, 'claim-0');
    assert.ok(result.retainedCorpusEnergy > 0 && result.retainedCorpusEnergy <= 1.000001);
    assert.deepEqual(result, scoreCorpus(corpus, 'pump', 'semantic'));
  });
  it('keeps literal mode literal, handles unseen terms and learns only the supplied permission scope', () => {
    assert.deepEqual(scoreCorpus(corpus, 'pump', 'literal').results.map(row => row.id), ['0', '2']);
    assert.equal(scoreCorpus(corpus, 'unseenword', 'semantic').results.length, 0);
    const scoped = scoreCorpus(corpus.slice(3), 'pump', 'semantic'); assert.equal(scoped.results.length, 0); assert.ok(scoped.queryTermsOutsideCorpus.includes('pump'));
    assert.equal(scoreCorpus([], 'pump').corpusDocuments, 0);
    assert.deepEqual(tokens('ÉCOLE water and PUMP'), ['ecole', 'water', 'pump']);
  });
});
