require('should');
const { NEAR_DUPLICATE, comparableFields, normalise, findNearDuplicates } = require('../../../lib/util/near-duplicates');

// Twelve questions q0..q11, plus fields that must never be compared.
const fields = [
  ...Array.from({ length: 12 }, (_, i) => ({ path: `/q${i}`, name: `q${i}`, type: 'string' })),
  { path: '/colours', name: 'colours', type: 'string', selectMultiple: true },
  { path: '/start', name: 'start', type: 'dateTime' },
  { path: '/today', name: 'today', type: 'date' },
  { path: '/photo', name: 'photo', type: 'binary', binary: true },
  { path: '/gps', name: 'gps', type: 'geopoint' },
  { path: '/meta', name: 'meta', type: 'structure' },
  { path: '/meta/instanceID', name: 'instanceID', type: 'string' },
  { path: '/people', name: 'people', type: 'repeat' },
  { path: '/people/name', name: 'name', type: 'string' },
  { path: '/consent', name: 'consent', type: 'string' }
];
// A submission whose answers are `base` with some changed.
let seq = 0;
const submission = (id, answers, extra = {}) => {
  seq += 1;
  return { instanceId: id, receivedAt: new Date(Date.UTC(2026, 0, 1, 0, seq)), submitterId: 1, deviceId: 'd1', answers: new Map(Object.entries(answers)), ...extra };
};
const distinct = (n) => Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`/q${i}`, `answer ${n}-${i}`]));
const changed = (answers, k) => ({ ...answers, ...Object.fromEntries(Array.from({ length: k }, (_, i) => [`/q${i}`, `changed ${i}`])) });

describe('(util) near-duplicate submissions', () => {
  it('compares only questions answered once, leaving out metadata, media, locations, times and repeats', () => {
    comparableFields(fields).should.eql([...Array.from({ length: 12 }, (_, i) => `/q${i}`), '/colours', '/consent']);
    normalise('  Yes  ').should.equal('yes');
    normalise('red  blue', true).should.equal('blue red');
    normalise('red  blue').should.equal('red blue');
    (normalise('   ') === null).should.be.true();
  });

  it('finds a copied submission, and a near copy, and links each to its closest earlier one', () => {
    const base = distinct(0);
    const rows = [
      submission('a', { ...base, '/consent': 'yes' }),
      ...Array.from({ length: 6 }, (_, n) => submission(`other${n}`, { ...distinct(n + 1), '/consent': 'yes' })),
      submission('copy', { ...base, '/consent': 'yes', '/start': 'different', '/photo': 'x.jpg' }),
      submission('near', { ...changed(base, 1), '/consent': 'yes' }, { submitterId: 2, deviceId: 'd2' }),
      submission('far', { ...changed(base, 3), '/consent': 'yes' })
    ];
    const { findings, counts, informative } = findNearDuplicates(rows, fields);
    // consent is the same everywhere, so it says nothing.
    informative.should.not.containEql('/consent');
    counts.comparedQuestions.should.equal(12);
    findings.map((f) => [f.instanceId, f.relatedInstanceId]).should.eql([['copy', 'a'], ['near', 'a']]);
    const copy = findings[0].evidence;
    copy.should.containEql({ similarity: 1, exact: true, compared: 12, identical: 12, sameCollector: true, sameDevice: true, differingCount: 0 });
    copy.explanation.should.match(/Every one of the 12 compared answers/);
    copy.alternatives.length.should.equal(3);
    const near = findings[1].evidence;
    near.should.containEql({ similarity: 0.917, identical: 11, compared: 12, sameCollector: false, exact: false });
    near.differing.should.eql(['/q0']);
    // 'near' is about as close to 'copy' as to 'a': counted, linked to the closer, earlier one.
    near.alsoSimilarTo.should.equal(1);
    findings.every((f) => f.rule === NEAR_DUPLICATE.rule && f.outcome === 'concern').should.be.true();
    // No answers are stored.
    JSON.stringify(findings).should.not.match(/answer 0-/);
  });

  it('needs enough answered questions, and counts a whole cluster once per later submission', () => {
    const base = distinct(0);
    const few = Object.fromEntries(Object.entries(base).slice(0, NEAR_DUPLICATE.minShared - 1));
    const rows = [
      submission('a', base), submission('b', base), submission('c', base),
      ...Array.from({ length: 4 }, (_, n) => submission(`o${n}`, distinct(n + 1))),
      submission('few1', few), submission('few2', few)
    ];
    const { findings, counts } = findNearDuplicates(rows, fields);
    findings.map((f) => [f.instanceId, f.relatedInstanceId, f.evidence.alsoSimilarTo]).should.eql([['b', 'a', 0], ['c', 'a', 1]]);
    counts.tooFewAnswers.should.equal(2);
  });

  it('treats multiple-choice order, case and spacing as the same answer', () => {
    const base = { ...distinct(0), '/colours': 'red blue' };
    const rows = [
      submission('a', base),
      ...Array.from({ length: 4 }, (_, n) => submission(`o${n}`, { ...distinct(n + 1), '/colours': `c${n}` })),
      submission('b', { ...Object.fromEntries(Object.entries(base).map(([k, v]) => [k, `  ${v.toUpperCase()} `])), '/colours': 'BLUE red' })
    ];
    findNearDuplicates(rows, fields).findings.map((f) => f.instanceId).should.eql(['b']);
  });

  it('finds nothing among independent submissions, and is deterministic', () => {
    const rows = Array.from({ length: 200 }, (_, n) => submission(`s${n}`, distinct(n)));
    const first = findNearDuplicates(rows, fields);
    first.findings.should.eql([]);
    first.counts.examined.should.equal(200);
    // Many distinct submissions with one planted copy: found, every time.
    const planted = [...rows, submission('copy', distinct(17))];
    const a = findNearDuplicates(planted, fields).findings;
    a.map((f) => [f.instanceId, f.relatedInstanceId]).should.eql([['copy', 's17']]);
    findNearDuplicates(planted, fields).findings.should.eql(a);
  });

  it('links a large group of exact copies to its first member, and says when it stopped short', () => {
    const rows = [...Array.from({ length: 300 }, (_, n) => submission(`copy${n}`, distinct(0))),
      ...Array.from({ length: 10 }, (_, n) => submission(`o${n}`, distinct(n + 1)))];
    const { findings, counts } = findNearDuplicates(rows, fields);
    findings.length.should.equal(299);
    findings.every((f) => f.relatedInstanceId === 'copy0' && f.evidence.exact).should.be.true();
    findings.at(-1).evidence.alsoSimilarTo.should.equal(298);
    counts.compared.should.be.below(400);
    counts.truncated.should.be.false();
    const max = NEAR_DUPLICATE.maxCandidates;
    NEAR_DUPLICATE.maxCandidates = 10;
    try {
      const near = Array.from({ length: 30 }, (_, n) => submission(`n${n}`, changed(distinct(0), n % 2)));
      findNearDuplicates([...near, ...rows.slice(300)], fields).counts.truncated.should.be.true();
    } finally { NEAR_DUPLICATE.maxCandidates = max; }
  });
});
