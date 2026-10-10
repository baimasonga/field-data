const Should = require('should'); // eslint-disable-line no-unused-vars
const { normalizeRule, usability, parseInstance, evaluateRule } = require('../../../lib/util/contradiction-rules');

// Shaped like the housing survey test form: groups, a roster repeat, select-multiples.
const fields = [
  { path: '/survey', type: 'structure' },
  { path: '/survey/electricity', name: 'electricity', type: 'string' },
  { path: '/survey/assets', name: 'assets', type: 'string', selectMultiple: true },
  { path: '/survey/condition', name: 'condition', type: 'string' },
  { path: '/survey/hazards', name: 'hazards', type: 'string', selectMultiple: true },
  { path: '/survey/hh_size', name: 'hh_size', type: 'int' },
  { path: '/survey/adult_count', name: 'adult_count', type: 'int' },
  { path: '/survey/rooms', name: 'rooms', type: 'int' },
  { path: '/survey/remarks', name: 'remarks', type: 'string' },
  { path: '/survey/photo', name: 'photo', type: 'binary', binary: true },
  { path: '/survey/member', type: 'repeat' },
  { path: '/survey/member/age', name: 'age', type: 'int' },
  { path: '/survey/member/relation', name: 'relation', type: 'string' },
  { path: '/survey/member/kids', type: 'repeat' },
  { path: '/survey/member/kids/kid_age', name: 'kid_age', type: 'int' }
];

const rule = (conditions, extra = {}) => normalizeRule({
  title: 'Test rule', explanation: 'These answers conflict.', benignExplanations: ['An ordinary reason.'],
  nextStep: 'Ask the collector.', conditions, ...extra
}, fields);

const household = ({ electricity = 'none', assets = 'tv fridge', condition = 'good', hazards = 'unstable', hh = '4', adults = '2', members = [['40', 'head'], ['38', 'spouse'], ['10', 'child'], ['6', 'child']], remarks = '' } = {}) => parseInstance(
  `<data id="housing" xmlns:orx="http://openrosa.org/xforms"><orx:meta><orx:instanceID>uuid:1</orx:instanceID></orx:meta><survey>`
  + `<electricity>${electricity}</electricity><assets>${assets}</assets><condition>${condition}</condition><hazards>${hazards}</hazards>`
  + `<hh_size>${hh}</hh_size><adult_count>${adults}</adult_count><rooms>2</rooms><remarks>${remarks}</remarks>`
  + members.map(([age, relation]) => `<member><age>${age}</age><relation>${relation}</relation></member>`).join('')
  + '</survey></data>'
);
const outcome = (r, instance) => evaluateRule(r.conditions, instance, fields).outcome;

describe('(util) contradiction rules', () => {
  describe('validation', () => {
    it('accepts a rule and fingerprints only its conditions', () => {
      const a = rule([{ field: '/survey/electricity', op: '=', value: 'none' }]);
      const b = rule([{ field: '/survey/electricity', op: '=', value: 'none' }], { title: 'Renamed' });
      a.conditionsHash.should.equal(b.conditionsHash);
      rule([{ field: '/survey/electricity', op: '=', value: 'grid' }]).conditionsHash.should.not.equal(a.conditionsHash);
      a.active.should.be.true();
    });

    it('requires a title, texts and at least one benign explanation', () => {
      (() => rule([{ field: '/survey/electricity', op: '=', value: 'none' }], { benignExplanations: [] })).should.throw(/ordinary reasons/);
      (() => rule([{ field: '/survey/electricity', op: '=', value: 'none' }], { title: ' ' })).should.throw(/1–120/);
      (() => rule([])).should.throw(/1–10 conditions/);
    });

    const refuses = (condition, pattern) => (() => rule([condition])).should.throw(pattern);
    it('refuses questions not in the form, binary questions and unsafe paths', () => {
      refuses({ field: '/survey/nope', op: '=', value: 'x' }, /current form/);
      refuses({ field: '/survey/photo', op: 'notEmpty' }, /current form/);
      refuses({ field: "/survey/electricity')]/text()", op: '=', value: 'x' }, /current form/);
    });

    it('checks each operator against the kind of question', () => {
      refuses({ field: '/survey/electricity', op: '>', value: '1' }, /number questions/);
      refuses({ field: '/survey/rooms', op: '=', value: 'two' }, /must be a number/);
      refuses({ field: '/survey/electricity', op: 'selected', value: 'none' }, /select-multiple/);
      refuses({ field: '/survey/assets', op: '=', value: 'tv' }, /selected or notSelected/);
      refuses({ field: '/survey/assets', op: 'selected', value: 'tv fridge' }, /single choice/);
      refuses({ field: '/survey/rooms', op: 'empty', value: '1' }, /takes no value/);
      refuses({ field: '/survey/rooms', op: '=', value: '1', otherField: '/survey/hh_size' }, /either a value or another/);
      refuses({ field: '/survey/rooms', op: '=', otherField: '/survey/remarks' }, /same kind/);
      refuses({ field: '/survey/rooms', op: 'like', value: '1' }, /must be one of/);
    });

    it('keeps repeat questions inside counts, and counts only top-level repeats', () => {
      refuses({ field: '/survey/member/age', op: '>', value: '1' }, /count it with a repeat condition/);
      refuses({ count: { repeat: '/survey/member', where: [{ field: '/survey/electricity', op: '=', value: 'x' }] }, op: '=', value: '1' }, /directly inside the counted repeat/);
      refuses({ count: { repeat: '/survey/member', where: [{ field: '/survey/member/kids/kid_age', op: '>', value: '1' }] }, op: '=', value: '1' }, /directly inside/);
      refuses({ count: { repeat: '/survey/member/kids' }, op: '=', value: '1' }, /inside other repeats/);
      refuses({ count: { repeat: '/survey/member' }, op: 'selected', value: '1' }, /a count is compared/);
    });
  });

  describe('evaluation', () => {
    it('matches only when every condition holds', () => {
      const r = rule([{ field: '/survey/electricity', op: '=', value: 'none' }, { field: '/survey/assets', op: 'selected', value: 'fridge' }]);
      outcome(r, household()).should.equal('match');
      outcome(r, household({ electricity: 'grid' })).should.equal('no-match');
      outcome(r, household({ assets: 'tv radio' })).should.equal('no-match');
    });

    it('shows the answers each condition rests on', () => {
      const r = rule([{ field: '/survey/electricity', op: '=', value: 'none' }, { field: '/survey/assets', op: 'selected', value: 'fridge' }]);
      evaluateRule(r.conditions, household(), fields).conditions.map((c) => c.answer).should.eql(['none', 'tv fridge']);
    });

    it('cannot evaluate a missing answer, but a false condition still settles it', () => {
      const r = rule([{ field: '/survey/remarks', op: '=', value: 'x' }, { field: '/survey/electricity', op: '=', value: 'none' }]);
      outcome(r, household()).should.equal('not-evaluated');
      outcome(r, household({ electricity: 'grid' })).should.equal('no-match');
      outcome(rule([{ field: '/survey/remarks', op: 'empty' }]), household()).should.equal('match');
      outcome(rule([{ field: '/survey/rooms', op: '>', value: '1' }]), household()).should.equal('match');
    });

    it('compares numbers as numbers and text as text', () => {
      outcome(rule([{ field: '/survey/hh_size', op: '>', otherField: '/survey/rooms' }]), household({ hh: '10' })).should.equal('match');
      outcome(rule([{ field: '/survey/hh_size', op: '=', value: '4.0' }]), household()).should.equal('match');
      outcome(rule([{ field: '/survey/electricity', op: '<>', value: 'None' }]), household()).should.equal('match');
      outcome(rule([{ field: '/survey/hh_size', op: '>', value: '1' }]), household({ hh: 'four' })).should.equal('not-evaluated');
    });

    it('counts roster entries, with and without a filter, against a value or a question', () => {
      const adults = rule([{ count: { repeat: '/survey/member', where: [{ field: '/survey/member/age', op: '>=', value: '18' }] }, op: '<>', otherField: '/survey/adult_count' }]);
      outcome(adults, household()).should.equal('no-match');
      outcome(adults, household({ adults: '3' })).should.equal('match');
      evaluateRule(adults.conditions, household({ adults: '3' }), fields).conditions[0].should.containEql({ counted: 2, compareAnswer: '3', count: { repeat: '/survey/member', where: [{ field: '/survey/member/age', op: '>=', value: '18' }] } });
      const heads = rule([{ count: { repeat: '/survey/member', where: [{ field: '/survey/member/relation', op: '=', value: 'head' }] }, op: '<>', value: '1' }]);
      outcome(heads, household()).should.equal('no-match');
      outcome(heads, household({ members: [['40', 'spouse'], ['10', 'child']] })).should.equal('match');
      const all = rule([{ count: { repeat: '/survey/member' }, op: '<>', otherField: '/survey/hh_size' }]);
      outcome(all, household()).should.equal('no-match');
      outcome(all, household({ hh: '5' })).should.equal('match');
      // An entry whose answer is missing makes the count uncertain.
      outcome(adults, household({ members: [['40', 'head'], ['', 'spouse']], adults: '2' })).should.equal('not-evaluated');
    });
  });

  it('reports a stored rule as unusable when the form no longer has its questions', () => {
    const r = rule([{ field: '/survey/electricity', op: '=', value: 'none' }, { count: { repeat: '/survey/member' }, op: '=', value: '0' }]);
    usability(r.conditions, fields).should.eql({ usable: true });
    const later = fields.filter((f) => !['/survey/electricity', '/survey/member', '/survey/member/age', '/survey/member/relation'].includes(f.path));
    const result = usability(r.conditions, later);
    result.usable.should.be.false();
    result.missing.should.containDeep(['/survey/electricity', '/survey/member']);
    // A question that changed kind is also unusable, never silently reinterpreted.
    usability(rule([{ field: '/survey/rooms', op: '>', value: '1' }]).conditions,
      fields.map((f) => (f.path === '/survey/rooms' ? { ...f, type: 'string' } : f))).usable.should.be.false();
  });
});
