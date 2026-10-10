const Should = require('should'); // eslint-disable-line no-unused-vars
const { readLocation, accuracyBand, reportedCoordinates, projectAreaFrom, insidePolygon, distanceToBoundaryM,
  checkLocationAccuracy, checkOutsideProjectArea, checkRepeatedLocation, locationComponents } = require('../../../lib/util/location-evidence');

// A rough box around Freetown with a hole (an excluded block) in its middle.
// Corners are longitude, latitude, as GeoJSON writes them.
const SHELL = [[-13.30, 8.40], [-13.15, 8.40], [-13.15, 8.52], [-13.30, 8.52], [-13.30, 8.40]];
const HOLE = [[-13.24, 8.45], [-13.22, 8.45], [-13.22, 8.47], [-13.24, 8.47], [-13.24, 8.45]];
const BO_BOX = [[-11.80, 7.90], [-11.70, 7.90], [-11.70, 8.00], [-11.80, 8.00], [-11.80, 7.90]];
const layer = (...geometries) => ({ type: 'FeatureCollection', features: geometries.map((geometry) => ({ type: 'Feature', geometry, properties: {} })) });
const area = (fc) => ({ ...projectAreaFrom(fc), layerId: 'layer-1', layerRevision: 3 });

const row = (instanceId, geopoint, extra = {}) => ({
  instanceId, geopoint, geopointField: '/data/location', submitterId: 1, deviceId: 'dev-1',
  receivedAt: '2026-10-01T10:00:00Z', ...extra
});

describe('(util) location evidence', () => {
  describe('readLocation', () => {
    it('names each kind of missing location separately', () => {
      readLocation(null).present.should.equal('no');
      readLocation('  ').present.should.equal('no');
      readLocation('0 0 0 0').present.should.equal('null-island');
      readLocation('north of the river').present.should.equal('unparseable');
      readLocation('91 10').present.should.equal('unparseable');
      const ok = readLocation('8.4657 -13.2317 12 4.5');
      ok.present.should.equal('yes');
      ok.location.accuracy.should.equal(4.5);
    });
  });

  it('bands accuracy and keeps "not reported" apart from good accuracy', () => {
    accuracyBand(null).should.equal('unknown');
    accuracyBand(10).should.equal('≤10');
    accuracyBand(30).should.equal('≤30');
    accuracyBand(100).should.equal('≤100');
    accuracyBand(100.1).should.equal('>100');
  });

  it('compares coordinates as the device wrote them', () => {
    reportedCoordinates('8.465700 -13.231700 0 5').should.eql({ key: '8.465700 -13.231700', decimals: 6 });
    reportedCoordinates('8.4657 -13.23170 0 5').decimals.should.equal(4);
    reportedCoordinates('8 -13').decimals.should.equal(0);
  });

  describe('projectAreaFrom', () => {
    it('accepts polygons and multipolygons and fingerprints the geometry', () => {
      const a = projectAreaFrom(layer({ type: 'Polygon', coordinates: [SHELL] }));
      a.usable.should.be.true();
      a.hash.should.match(/^[0-9a-f]{64}$/);
      projectAreaFrom(layer({ type: 'MultiPolygon', coordinates: [[SHELL], [BO_BOX]] })).polygons.should.have.length(2);
    });

    it('ignores points and lines, and refuses a layer with no polygon', () => {
      projectAreaFrom(layer({ type: 'Point', coordinates: [-13.2, 8.4] })).should.eql({ usable: false, reason: 'no-polygon' });
      projectAreaFrom(layer({ type: 'Point', coordinates: [-13.2, 8.4] }, { type: 'Polygon', coordinates: [SHELL] })).usable.should.be.true();
    });

    it('refuses a ring that crosses the antimeridian', () => {
      projectAreaFrom(layer({ type: 'Polygon', coordinates: [[[179, 0], [-179, 0], [-179, 1], [179, 1], [179, 0]]] }))
        .should.eql({ usable: false, reason: 'antimeridian' });
    });

    it('refuses a self-intersecting ring (a bow tie)', () => {
      projectAreaFrom(layer({ type: 'Polygon', coordinates: [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]] }))
        .should.eql({ usable: false, reason: 'self-intersecting' });
    });
  });

  it('honours holes when testing containment', () => {
    insidePolygon([-13.20, 8.42], [SHELL, HOLE]).should.be.true();
    insidePolygon([-13.23, 8.46], [SHELL, HOLE]).should.be.false(); // in the hole
    insidePolygon([-13.40, 8.46], [SHELL, HOLE]).should.be.false();
  });

  it('measures distance to the nearest edge in metres', () => {
    // 0.01° of longitude at 8.46° N is about 1.1 km.
    const d = distanceToBoundaryM([-13.31, 8.46], [[SHELL]]);
    d.should.be.within(1090, 1110);
  });

  describe('location-accuracy', () => {
    it('raises a concern only above 100 m and counts everything else', () => {
      const { findings, counts } = checkLocationAccuracy([
        row('good', '8.4657 -13.2317 0 5'),
        row('edge', '8.4657 -13.2317 0 100'),
        row('poor', '8.4657 -13.2317 0 100.5'),
        row('unreported', '8.4657 -13.2317'),
        row('none', '')
      ]);
      findings.map((f) => f.instanceId).should.eql(['poor']);
      findings[0].should.containEql({ rule: 'location-accuracy', ruleVersion: 1, outcome: 'concern' });
      findings[0].evidence.should.containEql({ reportedAccuracyM: 100.5, thresholdM: 100, field: '/data/location' });
      counts.should.eql({ examined: 5, concern: 1, withinLimit: 2, accuracyNotReported: 1, noLocation: 1 });
    });
  });

  describe('outside-project-area', () => {
    const freetown = area(layer({ type: 'Polygon', coordinates: [SHELL, HOLE] }));

    it('separates inside, near the edge and well outside, giving the accuracy away first', () => {
      const { findings, counts } = checkOutsideProjectArea([
        row('inside', '8.42 -13.20 0 5'),
        // About 1.1 km west of the boundary.
        row('far', '8.46 -13.31 0 5'),
        // About 55 m west, reported accuracy 80 m: could be inside.
        row('near', '8.46 -13.3005 0 80'),
        // About 55 m west, no accuracy: default tolerance of 100 m applies.
        row('near-unreported', '8.46 -13.3005'),
        row('hole', '8.46 -13.23 0 5'),
        row('none', '0 0')
      ], freetown);
      const by = Object.fromEntries(findings.map((f) => [f.instanceId, f]));
      Object.keys(by).sort().should.eql(['far', 'hole', 'near', 'near-unreported']);
      by.far.outcome.should.equal('concern');
      by.far.evidence.distanceOutsideM.should.be.within(1090, 1110);
      by.far.evidence.area.should.eql({ layerId: 'layer-1', layerRevision: 3, geometrySha256: freetown.hash });
      by.near.outcome.should.equal('inconclusive');
      by.near.evidence.should.containEql({ reason: 'near-edge', toleranceM: 80, toleranceSource: 'reported-accuracy' });
      by['near-unreported'].evidence.should.containEql({ toleranceM: 100, toleranceSource: 'default-no-accuracy-reported' });
      by.hole.outcome.should.equal('concern');
      counts.should.eql({ examined: 6, concern: 2, nearEdge: 2, inside: 1, noLocation: 1 });
    });

    it('treats a reading exactly on the boundary as inside', () => {
      const { findings, counts } = checkOutsideProjectArea([row('on-edge', '8.46 -13.3 0 5')], freetown);
      findings.should.have.length(0);
      counts.inside.should.equal(1);
    });

    it('counts a reading inside any part of a multipolygon as inside', () => {
      const both = area(layer({ type: 'MultiPolygon', coordinates: [[SHELL], [BO_BOX]] }));
      checkOutsideProjectArea([row('bo', '7.95 -11.75 0 5')], both).counts.inside.should.equal(1);
    });
  });

  describe('repeated-location', () => {
    it('relates each later repeat to the earliest, and records who and which device', () => {
      const { findings, counts } = checkRepeatedLocation([
        row('b', '8.465712 -13.231755 0 5', { receivedAt: '2026-10-01T11:00:00Z', submitterId: 2, deviceId: 'dev-2' }),
        row('a', '8.465712 -13.231755 0 4', { receivedAt: '2026-10-01T10:00:00Z' }),
        row('c', '8.465712 -13.231755 0 3', { receivedAt: '2026-10-01T12:00:00Z' }),
        row('other', '8.465713 -13.231755 0 5'),
        row('coarse-1', '8.4657 -13.2317 0 5'),
        row('coarse-2', '8.4657 -13.2317 0 5'),
        row('none', null)
      ]);
      findings.map((f) => [f.instanceId, f.relatedInstanceId]).should.eql([['b', 'a'], ['c', 'a']]);
      findings[0].evidence.should.containEql({ coordinates: '8.465712 -13.231755', groupSize: 3, sameSubmitter: false, sameDevice: false });
      findings[1].evidence.should.containEql({ sameSubmitter: true, sameDevice: true });
      counts.should.eql({ examined: 7, concern: 2, tooCoarse: 2, noLocation: 1 });
    });

    it('does not treat the same place written with different precision as a repeat', () => {
      checkRepeatedLocation([row('a', '8.465700 -13.231700'), row('b', '8.46570 -13.23170')]).findings.should.have.length(0);
    });
  });

  it('describes a submission location as named parts, with no score', () => {
    locationComponents(row('x', '8.4657 -13.2317 0 25', { capturedAt: '2026-10-01T09:00:00Z' }), { areaStatus: 'inside', repeats: 2 })
      .should.eql({
        present: 'yes', field: '/data/location', reportedAccuracyM: 25, accuracyBand: '≤30',
        withinProjectArea: 'inside', repeatedExactly: 2, captureTime: 'device-audit-log'
      });
    locationComponents(row('y', '0 0'), { areaStatus: 'inside' })
      .should.containEql({ present: 'null-island', accuracyBand: null, withinProjectArea: 'not-checked', captureTime: 'unavailable' });
  });
});
