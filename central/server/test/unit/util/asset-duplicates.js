require('should');
const { normalize, trigrams, similarity, keyOf, findPairs, MAX_PAIRS, MAX_CANDIDATES } = require('../../../lib/util/asset-duplicates');

const asset = (id, name, assetType = 'water-point', externalId = id.toUpperCase()) => ({ id, name, assetType, externalId });

describe('(util) suggested duplicate assets', () => {
  it('normalises case, accents, spaces and punctuation', () => {
    normalize('Kissy Water-Point').should.equal(normalize('kissy  waterpoint'));
    normalize('WP-01').should.equal('wp01');
    normalize('Ébola Clinic').should.equal('ebolaclinic');
    normalize(null).should.equal('');
  });

  it('measures shared three-letter fragments', () => {
    similarity(trigrams('kissywaterpoint'), trigrams('kissywaterpoint')).should.equal(1);
    similarity(trigrams('kissywaterpoint'), trigrams('kisywaterpoint')).should.be.aboveOrEqual(0.6);
    similarity(trigrams('wellingtonpump'), trigrams('wellingtnpump')).should.be.aboveOrEqual(0.6);
    similarity(trigrams('kissywaterpoint'), trigrams('lumleyschool')).should.equal(0);
    similarity(trigrams('ab'), trigrams('ab')).should.equal(0);
  });

  it('finds each reason, strongest first, and ignores dismissed pairs', () => {
    const assets = [
      asset('a', 'Kissy water point', 'water-point', 'WP-01'), asset('b', 'Kissy well', 'water-point', 'wp 01'),
      asset('c', 'Lumley School', 'school', 'S-1'), asset('d', 'lumley-school', 'school', 'S-2'),
      asset('e', 'Wellington pump', 'pump', 'P-1'), asset('f', 'Wellingtn pump', 'pump', 'P-2'),
      asset('g', 'Lumley School', 'water-point', 'X-1'),
      asset('h', 'Bo clinic', 'clinic', 'C-1'), asset('i', 'Kenema clinic', 'clinic', 'C-2')
    ];
    const { pairs, total } = findPairs(assets, [['i', 'h'], ['h', 'i'], ['h', 'zz']]);
    pairs.map((p) => [p.a.id, p.b.id, p.reasons.join('+')]).should.eql([
      ['a', 'b', 'external-id'],
      ['h', 'i', 'same-source'],
      ['c', 'd', 'same-name'],
      ['f', 'e', 'similar-name']
    ]);
    total.should.equal(4);
    // Same name but different type is not suggested (c and g).
    pairs.some((p) => [p.a.id, p.b.id].includes('g')).should.be.false();
    findPairs(assets, [], new Set([keyOf('d', 'c')])).pairs.map((p) => p.a.id).should.not.containEql('c');
  });

  it('does not take numbered assets for one another', () => {
    findPairs([asset('p', 'Water point 1'), asset('q', 'Water point 2'), asset('r', 'Water points 1')])
      .pairs.map((p) => [p.a.id, p.b.id]).should.eql([['p', 'r']]);
  });

  it('compares numerals of any script', () => {
    findPairs([asset('p', 'Water point ١'), asset('q', 'Water point ٢'), asset('r', 'Water points ١')])
      .pairs.map((p) => [p.a.id, p.b.id]).should.eql([['p', 'r']]);
  });

  it('bounds the work when many assets share a name, keeping the strongest reasons', () => {
    const many = Array.from({ length: 2000 }, (_, i) => asset(`m${String(i).padStart(4, '0')}`, 'Same name', 'pump', `X-${i}`));
    many.push(asset('zz1', 'Other', 'pump', 'DUP'), asset('zz2', 'Another', 'pump', 'dup'));
    const started = Date.now();
    const { pairs, total, capped } = findPairs(many);
    (Date.now() - started).should.be.below(2000);
    capped.should.be.true();
    total.should.equal(MAX_CANDIDATES);
    pairs.length.should.equal(MAX_PAIRS);
    // The external-ID pair, found first, is kept and listed first.
    pairs[0].reasons.should.eql(['external-id']);
  });

  it('lists every reason of a pair and caps the list', () => {
    const [pair] = findPairs([asset('x', 'Pump A', 'pump', 'P-9'), asset('y', 'pump-a', 'pump', 'p9')], [['x', 'y']]).pairs;
    pair.reasons.should.eql(['external-id', 'same-source', 'same-name']);
    const many = Array.from({ length: 30 }, (_, i) => asset(`m${String(i).padStart(2, '0')}`, 'Same name', 'pump'));
    const { pairs, total, capped } = findPairs(many);
    total.should.equal(435);
    capped.should.be.false();
    pairs.length.should.equal(MAX_PAIRS);
  });
});
