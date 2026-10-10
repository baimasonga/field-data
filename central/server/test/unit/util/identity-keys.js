const should = require('should');
const { normalizeKey, usability, keyOf, findIdentityIssues, DEFAULT_IGNORE } = require('../../../lib/util/identity-keys');

const fields = [
  { path: '/meta', type: 'structure' },
  { path: '/meta/instanceID', name: 'instanceID', type: 'string' },
  { path: '/survey', type: 'structure' },
  { path: '/survey/hh_code', name: 'hh_code', type: 'string' },
  { path: '/survey/hh_number', name: 'hh_number', type: 'int' },
  { path: '/survey/phone', name: 'phone', type: 'string' },
  { path: '/survey/district', name: 'district', type: 'string' },
  { path: '/survey/head_name', name: 'head_name', type: 'string' },
  { path: '/survey/assets', name: 'assets', type: 'string', selectMultiple: true },
  { path: '/survey/visit_date', name: 'visit_date', type: 'date' },
  { path: '/survey/location', name: 'location', type: 'geopoint' },
  { path: '/survey/photo', name: 'photo', type: 'binary', binary: true },
  { path: '/survey/member', type: 'repeat' },
  { path: '/survey/member/member_id', name: 'member_id', type: 'string' }
];

const write = (extra = {}) => normalizeKey({
  title: 'Household code', explanation: 'Each household is interviewed once.',
  benignExplanations: ['A follow-up visit.'], nextStep: 'Ask the collector which visit is right.',
  fields: [{ field: '/survey/hh_code' }], ...extra
}, fields);
const key = (extra = {}, version = 1) => ({ id: 'k1', version, ...write(extra) });
const failure = (fn) => { try { fn(); } catch (error) { return error; } return null; };

let seq = 0;
const sub = (answers, { day = 0, submitter = 7 } = {}) => {
  seq += 1;
  return {
    instanceId: `uuid:${seq}`, receivedAt: new Date(Date.UTC(2026, 0, 1) + day * 86400000), submitter,
    answer: (path) => { const v = answers[path.split('/').pop()]; return v == null || v === '' ? null : String(v); }
  };
};

describe('(util) identity keys', () => {
  describe('validation', () => {
    it('defaults to one use, the placeholder list and a minimum length of 3', () => {
      const k = write();
      k.definition.should.eql({ fields: [{ field: '/survey/hh_code', match: 'exact' }], sameFields: [], maxUses: 1, windowDays: null, ignoreValues: DEFAULT_IGNORE, minLength: 3 });
      k.definitionHash.should.match(/^[0-9a-f]{64}$/);
    });

    it('changes the fingerprint only when what is matched changes', () => {
      const base = write();
      write({ title: 'Other', explanation: 'Other.', nextStep: 'Other.', benignExplanations: ['Other.'], active: false }).definitionHash.should.equal(base.definitionHash);
      write({ maxUses: 2 }).definitionHash.should.not.equal(base.definitionHash);
      write({ windowDays: 30 }).definitionHash.should.not.equal(base.definitionHash);
      write({ sameFields: ['/survey/district'] }).definitionHash.should.not.equal(base.definitionHash);
      write({ fields: [{ field: '/survey/hh_code', match: 'digits' }] }).definitionHash.should.not.equal(base.definitionHash);
    });

    it('refuses questions that cannot identify anything, and bad settings', () => {
      const cases = [
        [{ fields: [] }, 'fields'],
        [{ fields: [1, 2, 3, 4].map(() => ({ field: '/survey/hh_code' })) }, 'fields'],
        [{ fields: [{ field: '/survey/hh_code' }, { field: '/survey/hh_code' }] }, 'fields'],
        [{ fields: [{ field: '/survey/nope' }] }, 'fields[0].field'],
        [{ fields: [{ field: '/survey/member/member_id' }] }, 'fields[0].field'],
        [{ fields: [{ field: '/survey/location' }] }, 'fields[0].field'],
        [{ fields: [{ field: '/survey/photo' }] }, 'fields[0].field'],
        [{ fields: [{ field: '/survey/assets' }] }, 'fields[0].field'],
        [{ fields: [{ field: '/meta/instanceID' }] }, 'fields[0].field'],
        [{ fields: [{ field: '/survey/hh_code', match: 'fuzzy' }] }, 'fields[0].match'],
        [{ fields: [{ field: "/survey/x');drop table forms;--" }] }, 'fields[0].field'],
        [{ sameFields: ['/survey/hh_code'] }, 'sameFields'],
        [{ sameFields: ['/survey/location'] }, 'sameFields[0]'],
        [{ sameFields: ['/survey/district', '/survey/district'] }, 'sameFields'],
        [{ maxUses: 0 }, 'maxUses'],
        [{ maxUses: 1.5 }, 'maxUses'],
        [{ windowDays: 0 }, 'windowDays'],
        [{ minLength: 0 }, 'minLength'],
        [{ ignoreValues: [''] }, 'ignoreValues[0]'],
        [{ ignoreValues: Array.from({ length: 51 }, (_, i) => `v${i}`) }, 'ignoreValues'],
        [{ benignExplanations: [] }, 'benignExplanations'],
        [{ title: '' }, 'title']
      ];
      for (const [extra, field] of cases) {
        const error = failure(() => write(extra));
        should.exist(error, JSON.stringify(extra));
        error.field.should.equal(field, JSON.stringify(extra));
      }
    });

    it('allows select-multiple and date questions to stay the same, and keys inside groups', () => {
      write({ sameFields: ['/survey/assets', '/survey/visit_date', '/survey/district'] }).definition.sameFields.length.should.equal(3);
    });

    it('reports a key unusable when the form no longer has its questions', () => {
      const k = write({ sameFields: ['/survey/district'] });
      usability(k.definition, fields).should.eql({ usable: true });
      usability(k.definition, fields.filter((f) => f.path !== '/survey/district'))
        .should.eql({ usable: false, reason: 'missing-fields', missing: ['/survey/district'] });
      usability(k.definition, fields.map((f) => (f.path === '/survey/hh_code' ? { ...f, type: 'geopoint' } : f)))
        .should.containEql({ usable: false, reason: 'changed' });
    });
  });

  describe('keys from answers', () => {
    const answer = (values) => (path) => values[path.split('/').pop()] ?? null;

    it('ignores case and spacing for exact keys, and everything but digits for digit keys', () => {
      const exact = write().definition;
      keyOf(exact, answer({ hh_code: ' WA  0123 ' })).should.equal(keyOf(exact, answer({ hh_code: 'wa 0123' })));
      keyOf(exact, answer({ hh_code: 'WA-0123' })).should.not.equal(keyOf(exact, answer({ hh_code: 'WA 0123' })));
      const digits = write({ fields: [{ field: '/survey/phone', match: 'digits' }] }).definition;
      keyOf(digits, answer({ phone: '076 123-456' })).should.equal(keyOf(digits, answer({ phone: '(076)123456' })));
    });

    it('skips blank, placeholder, repeated-character and short values', () => {
      const digits = write({ fields: [{ field: '/survey/phone', match: 'digits' }] }).definition;
      should(keyOf(digits, answer({}))).be.null();
      should(keyOf(digits, answer({ phone: '0000000' }))).be.null();
      should(keyOf(digits, answer({ phone: '999' }))).be.null();
      should(keyOf(digits, answer({ phone: 'none' }))).be.null();
      should(keyOf(digits, answer({ phone: '12' }))).be.null();
      const exact = write().definition;
      should(keyOf(exact, answer({ hh_code: 'N/A' }))).be.null();
      should(keyOf(exact, answer({ hh_code: 'xxxx' }))).be.null();
      keyOf(exact, answer({ hh_code: 'WA1' })).should.be.a.String();
    });

    it('needs every part of a combined key, and keeps the parts apart', () => {
      const k = write({ fields: [{ field: '/survey/district' }, { field: '/survey/hh_number' }] }).definition;
      should(keyOf(k, answer({ district: 'Bo' }))).be.null();
      keyOf(k, answer({ district: 'Bo', hh_number: '12' })).should.not.equal(keyOf(k, answer({ district: 'Bo1', hh_number: '2' })));
    });
  });

  describe('findings', () => {
    it('finds the later use of a key once, related to the earliest, without answers', () => {
      const a = sub({ hh_code: 'WA0123' }); const b = sub({ hh_code: 'wa0123' }, { day: 3, submitter: 9 }); const c = sub({ hh_code: 'WA0999' });
      const { findings, counts } = findIdentityIssues(key(), [a, b, c]);
      counts.should.eql({ examined: 3, noKey: 0, distinct: 2, reused: 1, inconsistent: 0 });
      findings.length.should.equal(1);
      const [f] = findings;
      f.should.containEql({ rule: 'identity-reused:k1', ruleVersion: 1, instanceId: b.instanceId, relatedInstanceId: a.instanceId, outcome: 'concern' });
      f.evidence.should.containEql({ kind: 'reused', sharedBy: 2, earlierInWindow: 1, maxUses: 1 });
      f.evidence.others.should.eql([{ instanceId: a.instanceId, receivedAt: a.receivedAt.toISOString(), submitter: 7 }]);
      JSON.stringify(f).should.not.match(/wa0123/i);
    });

    it('allows a panel its visits and finds the one too many', () => {
      const visits = [0, 30, 60].map((day) => sub({ hh_code: 'WA0123' }, { day }));
      findIdentityIssues(key({ maxUses: 2 }), visits.slice(0, 2)).findings.should.eql([]);
      const { findings } = findIdentityIssues(key({ maxUses: 2 }), visits);
      findings.map((f) => [f.instanceId, f.relatedInstanceId]).should.eql([[visits[2].instanceId, visits[0].instanceId]]);
    });

    it('counts only uses within the window', () => {
      const first = sub({ hh_code: 'WA0123' }, { day: 0 });
      const later = sub({ hh_code: 'WA0123' }, { day: 40 });
      const soon = sub({ hh_code: 'WA0123' }, { day: 50 });
      const { findings } = findIdentityIssues(key({ windowDays: 30 }), [first, later, soon]);
      findings.map((f) => [f.instanceId, f.relatedInstanceId]).should.eql([[soon.instanceId, later.instanceId]]);
      findIdentityIssues(key({ windowDays: 30 }), [first, later]).findings.should.eql([]);
    });

    it('does not group placeholders', () => {
      const subs = Array.from({ length: 10 }, () => sub({ phone: '0000000' }));
      const result = findIdentityIssues(key({ fields: [{ field: '/survey/phone', match: 'digits' }] }), subs);
      result.findings.should.eql([]);
      result.counts.noKey.should.equal(10);
    });

    it('finds a changed answer that should stay the same, ignoring blanks and choice order', () => {
      const k = key({ maxUses: 5, sameFields: ['/survey/district', '/survey/head_name', '/survey/assets'] });
      const a = sub({ hh_code: 'WA0123', district: 'Bo', head_name: 'Fatmata Kamara', assets: 'tv radio' });
      const b = sub({ hh_code: 'WA0123', district: 'bo ', head_name: '', assets: 'radio tv' });
      const c = sub({ hh_code: 'WA0123', district: 'Kenema', head_name: 'Kamara Fatmata', assets: 'tv radio' });
      const { findings, counts } = findIdentityIssues(k, [a, b, c], new Set(['/survey/assets']));
      counts.should.containEql({ reused: 0, inconsistent: 1 });
      findings.length.should.equal(1);
      findings[0].should.containEql({ rule: 'identity-inconsistent:k1', instanceId: c.instanceId, relatedInstanceId: a.instanceId });
      findings[0].evidence.differing.should.eql(['/survey/district', '/survey/head_name']);
      JSON.stringify(findings[0]).should.not.match(/kenema|fatmata/i);
    });

    it('records the key version with each finding', () => {
      const a = sub({ hh_code: 'WA0123' }); const b = sub({ hh_code: 'WA0123' });
      findIdentityIssues(key({}, 3), [a, b]).findings[0].ruleVersion.should.equal(3);
    });
  });
});
