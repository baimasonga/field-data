const Should = require('should'); // eslint-disable-line no-unused-vars
const {
  checkImplausibleTravel, parseGeopoint, haversineMetres
} = require('../../../lib/util/fieldwork-integrity');

// Real places, so the distances mean something to anyone reading a failure.
const FREETOWN = { latitude: 8.4657, longitude: -13.2317, accuracy: 5 };
const BO = { latitude: 7.9647, longitude: -11.7383, accuracy: 5 };
const NEXT_DOOR = { latitude: 8.4660, longitude: -13.2320, accuracy: 5 };

const at = (iso) => new Date(iso);
const submission = (instanceId, capturedAt, location) => ({
  instanceId,
  capturedAt: capturedAt == null ? null : at(capturedAt),
  location,
  locationSource: location == null ? null : 'answer',
  captureTimeSource: capturedAt == null ? null : 'audit'
});

const only = (findings) => {
  findings.should.have.length(1);
  return findings[0];
};

describe('(util) fieldwork integrity', () => {
  describe('parseGeopoint', () => {
    it('reads latitude, longitude, altitude and accuracy', () => {
      parseGeopoint('8.46 -13.23 12 4.5').should.eql({
        latitude: 8.46, longitude: -13.23, altitude: 12, accuracy: 4.5
      });
    });

    it('accepts a reading with no altitude or accuracy', () => {
      parseGeopoint('8.46 -13.23').should.eql({
        latitude: 8.46, longitude: -13.23, altitude: null, accuracy: null
      });
    });

    // A device with no fix writes zeroes, and a survey of the Gulf of Guinea
    // is not what anyone meant.
    it('refuses null island rather than treating it as a place', () => {
      Should(parseGeopoint('0 0 0 0')).be.null();
    });

    it('refuses impossible and unreadable values', () => {
      Should(parseGeopoint('91 0')).be.null();
      Should(parseGeopoint('0 181')).be.null();
      Should(parseGeopoint('')).be.null();
      Should(parseGeopoint(null)).be.null();
      Should(parseGeopoint('somewhere near the river')).be.null();
    });
  });

  describe('haversineMetres', () => {
    it('measures a known distance', () => {
      // Freetown to Bo is about 174 km as the crow flies.
      const km = haversineMetres(FREETOWN, BO) / 1000;
      km.should.be.within(170, 180);
    });
  });

  describe('checkImplausibleTravel', () => {
    it('accepts ordinary work in one neighbourhood', () => {
      const finding = only(checkImplausibleTravel([
        submission('a', '2026-09-19T09:00:00Z', FREETOWN),
        submission('b', '2026-09-19T09:40:00Z', NEXT_DOOR)
      ]));
      finding.outcome.should.equal('plausible');
    });

    it('accepts a long journey given a long time to make it', () => {
      const finding = only(checkImplausibleTravel([
        submission('a', '2026-09-19T09:00:00Z', FREETOWN),
        submission('b', '2026-09-20T09:00:00Z', BO)
      ]));
      finding.outcome.should.equal('plausible');
    });

    it('raises a concern when even the shortest path was too fast', () => {
      const finding = only(checkImplausibleTravel([
        submission('a', '2026-09-19T09:00:00Z', FREETOWN),
        submission('b', '2026-09-19T09:30:00Z', BO)
      ]));
      finding.outcome.should.equal('concern');
      finding.evidence.impliedSpeedKmh.should.be.above(300);
      finding.relatedInstanceId.should.equal('a');
    });

    // A finding that offers no innocent reading invites the reviewer to
    // supply a guilty one.
    it('offers alternative explanations and a next step with every concern', () => {
      const finding = only(checkImplausibleTravel([
        submission('a', '2026-09-19T09:00:00Z', FREETOWN),
        submission('b', '2026-09-19T09:30:00Z', BO)
      ]));
      finding.evidence.alternatives.should.not.be.empty();
      finding.evidence.nextStep.should.be.a.String();
    });

    it('gives the reported accuracy away before judging the speed', () => {
      const finding = only(checkImplausibleTravel([
        submission('a', '2026-09-19T09:00:00Z', FREETOWN),
        submission('b', '2026-09-19T09:30:00Z', BO)
      ]));
      finding.evidence.leastDistanceM.should.be.below(finding.evidence.straightLineM);
    });

    it('is inconclusive when a reading is too vague to compare', () => {
      const finding = only(checkImplausibleTravel([
        submission('a', '2026-09-19T09:00:00Z', { ...FREETOWN, accuracy: 900 }),
        submission('b', '2026-09-19T09:30:00Z', BO)
      ]));
      finding.outcome.should.equal('inconclusive');
      finding.evidence.reason.should.equal('accuracy-too-poor');
    });

    it('is inconclusive when either submission has no location', () => {
      const finding = only(checkImplausibleTravel([
        submission('a', '2026-09-19T09:00:00Z', null),
        submission('b', '2026-09-19T09:30:00Z', BO)
      ]));
      finding.outcome.should.equal('inconclusive');
      finding.evidence.reason.should.equal('no-location');
    });

    // Server receipt time is when the upload arrived. Using it here would
    // turn a batch of offline interviews into a morning of impossible travel.
    it('is inconclusive, not silent, when there is no device capture time', () => {
      const finding = only(checkImplausibleTravel([
        submission('a', null, FREETOWN)
      ]));
      finding.outcome.should.equal('inconclusive');
      finding.evidence.reason.should.equal('no-capture-time');
    });

    it('is inconclusive when clock drift would decide the answer', () => {
      const finding = only(checkImplausibleTravel([
        submission('a', '2026-09-19T09:00:00Z', FREETOWN),
        submission('b', '2026-09-19T09:00:30Z', BO)
      ]));
      finding.outcome.should.equal('inconclusive');
      finding.evidence.reason.should.equal('interval-too-short');
    });

    // A whole batch arriving at once is how offline collection works.
    it('does not turn a batch of offline interviews into concerns', () => {
      const findings = checkImplausibleTravel([
        submission('a', '2026-09-19T09:00:00Z', FREETOWN),
        submission('b', '2026-09-19T11:00:00Z', NEXT_DOOR),
        submission('c', '2026-09-19T14:00:00Z', FREETOWN)
      ]);
      findings.every((f) => f.outcome === 'plausible').should.equal(true);
    });

    it('orders by capture time rather than the order it was handed', () => {
      const findings = checkImplausibleTravel([
        submission('later', '2026-09-19T09:40:00Z', NEXT_DOOR),
        submission('earlier', '2026-09-19T09:00:00Z', FREETOWN)
      ]);
      only(findings).relatedInstanceId.should.equal('earlier');
    });

    it('records the rule and its version on every finding', () => {
      const findings = checkImplausibleTravel([
        submission('a', '2026-09-19T09:00:00Z', FREETOWN),
        submission('b', '2026-09-19T09:30:00Z', BO)
      ]);
      findings.forEach((finding) => {
        finding.rule.should.equal('implausible-travel');
        finding.ruleVersion.should.be.a.Number();
      });
    });
  });
});
