// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
//
// Near-duplicate submissions (F4): a later submission whose answers almost all
// match an earlier one's. Copied or invented interviews often look like this;
// so can two members of one household, or a test submitted twice. A finding is
// a reason to compare the two, not a conclusion. Findings hold submission IDs,
// counts and question paths, never answers.
//
// Contract: docs/field-intelligence/F4-near-duplicates.md

const NEAR_DUPLICATE = {
  rule: 'near-duplicate',
  version: 1,
  // Share of compared answers that must be identical.
  threshold: 0.9,
  // Questions both submissions answered, at least; fewer says too little.
  minShared: 8,
  // A question where one answer covers more than this share of submissions
  // makes everyone look alike, so it is not compared.
  maxCommonShare: 0.8,
  maxSubmissions: 5000,
  // Pairs compared in one run, at most; beyond this the run says it stopped short.
  maxCandidates: 500000,
  maxDiffering: 20
};

// Questions that differ between any two interviews whatever happened, or say
// nothing about the respondent.
const METADATA = new Set(['start', 'end', 'today', 'deviceid', 'username', 'phonenumber', 'simserial', 'subscriberid', 'audit', 'instanceID', 'instanceName', 'deprecatedID', 'email']);
const SKIPPED_TYPES = new Set(['structure', 'repeat', 'binary', 'geopoint', 'geotrace', 'geoshape', 'dateTime', 'time']);

// The questions compared: answered once per submission, not metadata, media,
// locations or times. Repeats are left out (their entries have no order to
// compare by).
const comparableFields = (fields) => {
  const repeats = fields.filter((f) => f.type === 'repeat').map((f) => `${f.path}/`);
  return fields.filter((f) => !SKIPPED_TYPES.has(f.type) && !f.binary
    && !METADATA.has(f.name) && !f.path.startsWith('/meta/') && !f.path.includes('/meta/')
    && !repeats.some((r) => f.path.startsWith(r)))
    .map((f) => f.path);
};

// Case and spacing do not make answers different; nor does the order of a
// multiple choice.
const normalise = (value, multiple = false) => {
  if (value == null) return null;
  const words = String(value).trim().toLowerCase().split(/\s+/)
    .filter((w) => w !== '');
  if (words.length === 0) return null;
  return (multiple ? [...words].sort() : words).join(' ');
};

// FNV-1a with a seed, for MinHash: fast, deterministic, good enough to spread tokens.
const hash32 = (text, seed) => {
  /* eslint-disable no-bitwise */
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
  return h >>> 0;
  /* eslint-enable no-bitwise */
};
const HASHES = 32; const BANDS = 8; const ROWS = HASHES / BANDS;

// `submissions`: [{ instanceId, receivedAt, submitterId, deviceId, answers: Map(path -> value) }]
// oldest first. Returns { findings, counts, informative }.
const findNearDuplicates = (submissions, fields) => {
  const spec = NEAR_DUPLICATE;
  const paths = comparableFields(fields);
  const multiple = new Set(fields.filter((f) => f.selectMultiple === true).map((f) => f.path));
  const counts = { examined: submissions.length, compared: 0, concern: 0, tooFewAnswers: 0, comparedQuestions: 0, truncated: false };

  // Informative questions: answered by at least two submissions, with no one
  // answer covering most of them. Counted over distinct submissions, so that
  // many copies of one interview do not make their own answers look common.
  const distinctSubmissions = [...new Map(submissions.map((sub) => [
    JSON.stringify(paths.map((path) => normalise(sub.answers.get(path), multiple.has(path)))), sub
  ])).values()];
  const informative = paths.filter((path) => {
    const tally = new Map(); let answered = 0;
    for (const s of distinctSubmissions) {
      const v = normalise(s.answers.get(path), multiple.has(path));
      if (v != null) { answered += 1; tally.set(v, (tally.get(v) ?? 0) + 1); }
    }
    if (answered < 2) return false;
    return Math.max(...tally.values()) / answered <= spec.maxCommonShare;
  });
  counts.comparedQuestions = informative.length;

  const rows = submissions.map((s, index) => {
    const values = new Map();
    for (const path of informative) { const v = normalise(s.answers.get(path), multiple.has(path)); if (v != null) values.set(path, v); }
    return { ...s, index, values };
  });
  const usable = rows.filter((r) => r.values.size >= spec.minShared);
  counts.tooFewAnswers = rows.length - usable.length;

  // Exact copies first: each later copy is compared with the earliest of its
  // group only, so a large group costs one comparison per member, not one
  // per pair.
  const exactGroups = new Map();
  for (const r of usable) {
    const key = JSON.stringify([...r.values].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
    if (!exactGroups.has(key)) exactGroups.set(key, []);
    exactGroups.get(key).push(r);
  }
  const representatives = [...exactGroups.values()].map((group) => group[0]);
  const groupOf = new Map([...exactGroups.values()].map((group) => [group[0].index, group]));
  const pairs = new Set();
  const candidates = [];
  for (const group of exactGroups.values())
    for (const r of group.slice(1)) { pairs.add(`${group[0].index}:${r.index}`); candidates.push([group[0], r]); }

  // Candidate pairs among the rest: MinHash over (question, answer) tokens, banded.
  const buckets = new Map();
  for (const r of representatives) {
    const tokens = [...r.values].map(([p, v]) => `${p}\u0000${v}`);
    for (let b = 0; b < BANDS; b += 1) {
      const sig = [];
      for (let k = 0; k < ROWS; k += 1) {
        const seed = b * ROWS + k;
        let min = 0xffffffff;
        for (const t of tokens) { const h = hash32(t, seed); if (h < min) min = h; }
        sig.push(min);
      }
      const key = `${b}:${sig.join(',')}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(r);
    }
  }
  for (const members of buckets.values()) {
    if (members.length < 2) continue; // eslint-disable-line no-continue
    for (let i = 0; i < members.length && candidates.length < spec.maxCandidates; i += 1)
      for (let j = i + 1; j < members.length && candidates.length < spec.maxCandidates; j += 1) {
        const [a, b] = members[i].index < members[j].index ? [members[i], members[j]] : [members[j], members[i]];
        const key = `${a.index}:${b.index}`;
        if (!pairs.has(key)) { pairs.add(key); candidates.push([a, b]); }
      }
  }
  counts.truncated = candidates.length >= spec.maxCandidates;

  // Exact comparison of each candidate: identical answers among the questions
  // either answered.
  const best = new Map(); // later index -> { earlier, similarity, ... }
  const matches = new Map(); // later index -> earlier group representatives it matches
  for (const [earlier, later] of candidates) {
    counts.compared += 1;
    const union = new Set([...earlier.values.keys(), ...later.values.keys()]);
    let identical = 0; const differing = [];
    for (const path of union) {
      const a = earlier.values.get(path);
      if (a != null && a === later.values.get(path)) identical += 1; else differing.push(path);
    }
    // Both answered at least minShared questions, so a match this close
    // shares at least that many.
    const similarity = identical / union.size;
    if (similarity < spec.threshold) continue; // eslint-disable-line no-continue
    if (!matches.has(later.index)) matches.set(later.index, new Set());
    matches.get(later.index).add(earlier.index);
    const current = best.get(later.index);
    if (current == null || similarity > current.similarity
      || (similarity === current.similarity && earlier.index < current.earlier.index))
      best.set(later.index, { earlier, similarity, compared: union.size, identical, differing });
  }

  // Every earlier submission this one matches, counting the earlier members of
  // each exact-copy group it matches, apart from the one it is linked to. A
  // later copy in its own group matches through the group's first member.
  const alsoSimilar = (laterIndex) => {
    let n = 0;
    for (const repIndex of matches.get(laterIndex) ?? [])
      n += (groupOf.get(repIndex) ?? []).filter((m) => m.index < laterIndex).length;
    return Math.max(0, n - 1);
  };

  const findings = [];
  for (const [laterIndex, m] of [...best].sort((a, b) => a[0] - b[0])) {
    const later = rows[laterIndex];
    counts.concern += 1;
    const percent = Math.round(m.similarity * 1000) / 10;
    findings.push({
      rule: spec.rule, ruleVersion: spec.version, instanceId: later.instanceId, relatedInstanceId: m.earlier.instanceId, outcome: 'concern',
      evidence: {
        similarity: Math.round(m.similarity * 1000) / 1000,
        threshold: spec.threshold,
        compared: m.compared,
        identical: m.identical,
        differing: m.differing.slice(0, spec.maxDiffering),
        differingCount: m.differing.length,
        exact: m.identical === m.compared,
        alsoSimilarTo: alsoSimilar(laterIndex),
        sameCollector: later.submitterId != null && later.submitterId === m.earlier.submitterId,
        sameDevice: later.deviceId != null && later.deviceId === m.earlier.deviceId,
        informativeQuestions: informative.length,
        explanation: m.identical === m.compared
          ? `Every one of the ${m.compared} compared answers is identical to an earlier submission's. Independent interviews almost never match this closely.`
          : `${m.identical} of ${m.compared} compared answers (${percent}%) are identical to an earlier submission's. Independent interviews rarely match this closely.`,
        alternatives: [
          'Two members of one household, or a respondent interviewed twice, answering the same way.',
          'The same interview submitted twice, for example a test or a resend.',
          'A form whose questions leave little room for answers to differ.'
        ],
        nextStep: 'Open both submissions and compare them; ask the collector, or the collectors, how each interview was done.'
      }
    });
  }
  return { findings, counts, informative };
};

module.exports = { NEAR_DUPLICATE, comparableFields, normalise, findNearDuplicates };
