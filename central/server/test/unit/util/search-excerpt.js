require('should');
const { excerptOf, matchOf, likePattern } = require('../../../lib/util/search-excerpt');

describe('(util) cited search excerpts', () => {
  it('returns short text whole and long text around the match', () => {
    excerptOf('Pump  handle\nbroken', 'HANDLE').should.equal('Pump handle broken');
    (excerptOf('nothing here', 'pump') === null).should.be.true();
    const long = `${'a'.repeat(300)} the pump at Kissy was broken ${'b'.repeat(300)}`;
    const e = excerptOf(long, 'pump at kissy');
    e.should.startWith('…').and.endWith('…').and.containEql('the pump at Kissy was broken');
    e.length.should.be.belowOrEqual(162);
    excerptOf(`pump ${'x'.repeat(400)}`, 'pump').should.startWith('pump').and.endWith('…');
    excerptOf(`${'x'.repeat(400)} pump`, 'pump').should.startWith('…').and.endWith('pump');
  });

  it('names the first field that matched', () => {
    matchOf({ name: 'Water point', externalId: 'WP-01', type: null }, 'wp-0').should.eql({ field: 'externalId', excerpt: 'WP-01' });
    (matchOf({ name: 'x' }, 'y') === null).should.be.true();
  });

  it('takes LIKE characters literally', () => {
    likePattern('50%_a\\b').should.equal('%50\\%\\_a\\\\b%');
  });
});
