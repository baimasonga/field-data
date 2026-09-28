// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// The explainable part of fieldwork verification: given evidence about
// submissions, say what is worth a person's attention and why.
//
// Three things this deliberately does not do.
//
// It does not decide anything. Every result is a finding for a reviewer, with
// the evidence it rests on and the ordinary explanations that would account
// for it. Nothing here rejects a submission or marks a collector.
//
// It does not fill gaps. Where the evidence needed for a check is missing, the
// result is "inconclusive" with the reason, never a guess and never silence. A
// submission with no device clock is not a submission with a fast enumerator.
//
// It does not score. There is no number that claims to be a probability of
// fraud, because there is no data here from which such a number could be
// calibrated.

// Straight-line distance over a sphere. This is a lower bound on how far
// somebody travelled: real routes bend, and the earth is not quite a sphere.
// Treating it as the distance travelled would overstate every speed, so it is
// only ever used to ask whether even the shortest possible path was too far.
const EARTH_RADIUS_M = 6371008.8;

const haversineMetres = (a, b) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = (Math.sin(dLat / 2) ** 2) +
    (Math.cos(lat1) * Math.cos(lat2) * (Math.sin(dLon / 2) ** 2));
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
};

// ODK writes a geopoint as "latitude longitude altitude accuracy", the last
// two optional. Accuracy is in metres and is the device's own estimate, which
// is a claim rather than a guarantee.
const parseGeopoint = (value) => {
  if (typeof value !== 'string') return null;
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length < 2) return null;
  const [latitude, longitude, altitude, accuracy] = parts;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  // 0,0 is in the Gulf of Guinea. It is almost always a device that had no fix
  // rather than a survey there, and treating it as a location has sent more
  // than one project chasing an enumerator who never left the district.
  if (latitude === 0 && longitude === 0) return null;
  return {
    latitude,
    longitude,
    altitude: Number.isFinite(altitude) ? altitude : null,
    accuracy: Number.isFinite(accuracy) ? accuracy : null
  };
};

const IMPLAUSIBLE_TRAVEL = {
  rule: 'implausible-travel',
  // Raise this whenever the arithmetic or the thresholds below change, so that
  // findings recorded under the old rule stay readable as what they were.
  version: 1,
  // Fast for a vehicle on a rural road, and well beyond walking. Above this,
  // over the shortest possible path, with the uncertainty already given away,
  // something is worth asking about.
  maxSpeedKmh: 120,
  // Below this the pair is too close together in time for any speed to mean
  // much: a minute's clock drift would dominate the answer.
  minSecondsBetween: 120,
  // A device's own accuracy estimate is a claim, but a wild one says the fix
  // was bad. Beyond this the location is not worth comparing.
  maxUsableAccuracyM: 100
};

/*
Look at one collector's submissions in capture order and ask whether getting
from one to the next was possible.

`submissions` is expected to be for a single collector, each item:

  { instanceId, capturedAt: Date|null, location: {...}|null,
    locationSource: string|null, captureTimeSource: string|null }

Returns a finding per consecutive pair. Every pair produces a result, because
"we could not tell" is something a reviewer should be able to see and count.
*/
const checkImplausibleTravel = (submissions, options = {}) => {
  const { maxSpeedKmh, minSecondsBetween, maxUsableAccuracyM } =
    { ...IMPLAUSIBLE_TRAVEL, ...options };

  const ordered = [...submissions]
    .filter((s) => s.capturedAt != null)
    .sort((a, b) => a.capturedAt - b.capturedAt);

  // Anything without a capture time cannot be placed in the order at all. It
  // is reported rather than dropped: a form that records no device clock is a
  // fact about the evidence, not an absence of findings.
  const undateable = submissions.filter((s) => s.capturedAt == null);

  const findings = undateable.map((s) => ({
    rule: IMPLAUSIBLE_TRAVEL.rule,
    ruleVersion: IMPLAUSIBLE_TRAVEL.version,
    instanceId: s.instanceId,
    relatedInstanceId: null,
    outcome: 'inconclusive',
    evidence: {
      reason: 'no-capture-time',
      explanation: 'This submission carries no device capture time, so it cannot be placed in order against the others. Server receipt time is when the upload arrived, which says nothing about when the interview happened.',
      captureTimeSource: s.captureTimeSource ?? null
    }
  }));

  for (let i = 1; i < ordered.length; i += 1) {
    const from = ordered[i - 1];
    const to = ordered[i];
    const seconds = (to.capturedAt - from.capturedAt) / 1000;

    const base = {
      rule: IMPLAUSIBLE_TRAVEL.rule,
      ruleVersion: IMPLAUSIBLE_TRAVEL.version,
      instanceId: to.instanceId,
      relatedInstanceId: from.instanceId
    };

    if (from.location == null || to.location == null) {
      findings.push({
        ...base,
        outcome: 'inconclusive',
        evidence: {
          reason: 'no-location',
          explanation: 'One of the two submissions has no usable location, so the distance between them is unknown.',
          from: { instanceId: from.instanceId, hasLocation: from.location != null },
          to: { instanceId: to.instanceId, hasLocation: to.location != null }
        }
      });
      continue;
    }

    const accuracyFrom = from.location.accuracy;
    const accuracyTo = to.location.accuracy;
    const tooVague = [accuracyFrom, accuracyTo]
      .some((a) => a != null && a > maxUsableAccuracyM);
    if (tooVague) {
      findings.push({
        ...base,
        outcome: 'inconclusive',
        evidence: {
          reason: 'accuracy-too-poor',
          explanation: `At least one reading reports accuracy worse than ${maxUsableAccuracyM} m, which is too vague to compare positions against.`,
          accuracyM: { from: accuracyFrom, to: accuracyTo }
        }
      });
      continue;
    }

    if (seconds < minSecondsBetween) {
      findings.push({
        ...base,
        outcome: 'inconclusive',
        evidence: {
          reason: 'interval-too-short',
          explanation: `The two captures are ${Math.round(seconds)} s apart. Below ${minSecondsBetween} s, ordinary clock drift would decide the answer rather than the travel.`,
          secondsBetween: Math.round(seconds)
        }
      });
      continue;
    }

    // Give the uncertainty away before judging. The shortest distance that is
    // consistent with both readings is the straight line minus both accuracy
    // radii, and that is the one the speed is computed from.
    const straightLineM = haversineMetres(from.location, to.location);
    const slackM = (accuracyFrom ?? 0) + (accuracyTo ?? 0);
    const leastDistanceM = Math.max(0, straightLineM - slackM);
    const speedKmh = (leastDistanceM / 1000) / (seconds / 3600);

    if (speedKmh <= maxSpeedKmh) {
      findings.push({
        ...base,
        outcome: 'plausible',
        evidence: {
          straightLineM: Math.round(straightLineM),
          leastDistanceM: Math.round(leastDistanceM),
          secondsBetween: Math.round(seconds),
          impliedSpeedKmh: Math.round(speedKmh * 10) / 10,
          thresholdKmh: maxSpeedKmh
        }
      });
      continue;
    }

    findings.push({
      ...base,
      outcome: 'concern',
      evidence: {
        straightLineM: Math.round(straightLineM),
        leastDistanceM: Math.round(leastDistanceM),
        accuracyAllowedM: Math.round(slackM),
        secondsBetween: Math.round(seconds),
        impliedSpeedKmh: Math.round(speedKmh * 10) / 10,
        thresholdKmh: maxSpeedKmh,
        locationSource: { from: from.locationSource, to: to.locationSource },
        captureTimeSource: { from: from.captureTimeSource, to: to.captureTimeSource },
        // Shown to the reviewer beside the finding. A check that offers no
        // innocent explanation invites the reviewer to supply a guilty one.
        alternatives: [
          'The device clock was wrong or changed between the two interviews.',
          'Both interviews were conducted by different people sharing one account or device.',
          'A location reading was worse than the accuracy it reported.',
          'An interview was begun in one place and finished in another.'
        ],
        nextStep: 'Compare the two submissions with the collector before drawing any conclusion. This is a lower bound on distance over a straight line, not a measured route.'
      }
    });
  }

  return findings;
};

module.exports = {
  haversineMetres,
  parseGeopoint,
  checkImplausibleTravel,
  IMPLAUSIBLE_TRAVEL
};
