const should = require('should');
const { validateAreas, polygonGroup, AREA_LIMITS } = require('../../../lib/util/sampling-areas');
const { validateSettings, draw } = require('../../../lib/util/backcheck-sample');
const box = (x, y, size = 2) => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]];
const area = (value, coordinates) => ({ value, geometry: { type: 'Polygon', coordinates } });
describe('(util) polygon sampling areas', () => {
  it('normalizes names/order and validates geometry, holes and bounded input', () => {
    const north = area(' North ', [box(10, 10), box(10.5, 10.5, 0.5)]);
    validateAreas([north, area('South', [box(20, 20)])]).areas.map(a => a.value).should.eql(['North', 'South']);
    for (const input of [null, {}, [area('', [box(10, 10)])], [area('Outside areas', [box(10, 10)])], [area('Missing answer', [box(10, 10)])], [north, { ...north, value: 'North' }],
      [area('bad', [[[10, 10], [11, 10], [12, 10], [10, 10]]])], [area('bad', [[[10, 10], [12, 12], [10, 12], [12, 10], [10, 10]]])],
      [area('bad', [box(179, 10, 2)])], [area('bad', [[[179, 10], [-179, 10], [-179, 12], [179, 12], [179, 10]]])], [area('bad', [box(10, 10), box(20, 20)])],
      [area('bad', [box(10, 10), box(10.5, 10.5), box(10.6, 10.6, 0.2)])],
      [area('bad', [box(10, 10), box(10, 10, 1)])], [area('bad', [box(10, 10).map(p => [...p, 1])])],
      [{ value: 'bad', geometry: { type: 'Point', coordinates: [10, 10] } }],
      Array.from({ length: 21 }, (_, i) => area(String(i), [box(10, 10)]))])
      validateAreas(input).should.have.property('error');
    const tooMany = Array.from({ length: AREA_LIMITS.vertices + 1 }, () => [10, 10]);
    validateAreas([area('large', [tooMany])]).should.have.property('error');
  });

  it('honors holes, multipolygons, edges, missing, outside and overlap without a priority rule', () => {
    const { areas } = validateAreas([area('North', [box(10, 10), box(10.5, 10.5, 0.5)]), area('South', [box(11.5, 10)]),
      { value: 'Islands', geometry: { type: 'MultiPolygon', coordinates: [[box(20, 20)], [box(30, 30)]] } }]);
    const expected = [[null, null], ['10.2 10.2', 'North'], ['10.7 10.7', 'Outside areas'], ['10.5 10.7', 'North'],
      ['10 10', 'North'], ['10.2 11.7', 'Overlapping areas'], ['10.2 11.5', 'Overlapping areas'],
      ['20.5 20.5', 'Islands'], ['30.5 30.5', 'Islands'], ['40 40', 'Outside areas']];
    for (const [raw, value] of expected) {
      should.equal(polygonGroup(raw, areas).value, value);
      should.equal(polygonGroup(raw, [...areas].reverse()).value, value);
    }
    for (const raw of ['0 0', '91 10', '1 181', 'north', '1 2 3 -1', '1 2 3 NaN', '1 2 3 4 5', '0x10 12'])
      polygonGroup(raw, areas).should.have.property('error');
  });

  it('validates sampling settings and replays grouped selection with named rates', () => {
    const groupAreas = [area('North', [box(10, 10)])];
    const { settings } = validateSettings({ rate: 10, groupField: '/location', groupAreas, groupRates: [{ value: 'North', rate: 100 }] });
    settings.groupAreas.should.eql(groupAreas);
    for (const body of [{ rate: 10, groupAreas }, { rate: 10, groupField: '/location', groupAreas, groupBreaks: ['18'] },
      { rate: 10, groupField: '/location', groupAreas, groupRates: [{ value: 'Typo', rate: 10 }] }])
      validateSettings(body).should.have.property('error');
    validateSettings({ rate: 10, groupAreas: [] }).settings.should.not.have.property('groupAreas');
    const rows = ['10.1 10.1', '10.2 10.2', '40 40', null].map((raw, i) => ({ instanceId: String(i), submitterId: 1, groupValue: polygonGroup(raw, groupAreas).value }));
    const result = draw(rows, settings, 'a'.repeat(32));
    result.chosen.length.should.equal(4);
    draw([...rows].reverse(), settings, 'a'.repeat(32)).should.eql(result);
  });
});
