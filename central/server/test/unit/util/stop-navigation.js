const should = require('should');
const { stopNavigation } = require('../../../lib/util/stop-navigation');
describe('(util) approved-stop navigation', () => {
  it('builds fixed-provider destination-only URLs with a bounded check lifetime', () => {
    const result = stopNavigation({ id: 'plan' }, { id: 'stop', kind: 'backcheck', location: { latitude: 8.4657, longitude: -13.2317, accuracy: 12 }, question: 'private text', token: 'private-key' }, new Date('2026-10-24T10:00:00Z'));
    result.expiresAt.should.equal('2026-10-24T10:01:00.000Z');
    const google = new URL(result.targets[0].url); const osm = new URL(result.targets[1].url);
    google.origin.should.equal('https://www.google.com'); google.searchParams.get('destination').should.equal('8.4657,-13.2317');
    [...google.searchParams.keys()].should.eql(['api', 'destination']);
    osm.origin.should.equal('https://www.openstreetmap.org'); osm.searchParams.get('mlat').should.equal('8.4657'); osm.searchParams.get('mlon').should.equal('-13.2317');
    JSON.stringify(result).should.not.match(/private|question|token/);
  });
  it('withholds invalid destinations and treats absent accuracy as unknown', () => {
    for (const location of [null, {}, { latitude: '8', longitude: 13 }, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: 181 }, { latitude: 0, longitude: 0 }, { latitude: NaN, longitude: 12 }])
      should.equal(stopNavigation({ id: 'plan' }, { id: 'stop', location }), null);
    const result = stopNavigation({ id: 'plan' }, { id: 'stop', location: { latitude: 8, longitude: -13, accuracy: -1 } });
    should.equal(result.location.accuracy, null);
  });
});
