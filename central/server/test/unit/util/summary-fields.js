require('should');
const { chartableFields } = require('../../../lib/util/summary-fields');

// One row per (path, value), the shape the summary query returns.
const rows = (path, counts, type = 'string') => Object.entries(counts)
  .sort(([, a], [, b]) => b - a)
  .map(([value, count]) => ({ path, name: path.slice(1), type, value, count }));

describe('(util) summary fields', () => {
  describe('choosing fields', () => {
    it('keeps a field whose answers repeat', () => {
      const { fields } = chartableFields(rows('/district', { Bombali: 30, Kono: 20 }));
      fields.map(f => f.path).should.eql(['/district']);
      fields[0].values.should.eql([
        { value: 'Bombali', count: 30 }, { value: 'Kono', count: 20 }
      ]);
    });

    it('drops a field where every answer is different', () => {
      const { fields } = chartableFields(rows('/name', { a: 1, b: 1, c: 1 }));
      fields.should.eql([]);
    });

    it('drops a field with only one answer', () => {
      chartableFields(rows('/crop', { cocoa: 40 })).fields.should.eql([]);
    });

    it('drops a field with too many distinct answers to be a category', () => {
      const counts = {};
      for (let i = 0; i < 26; i += 1) counts[`v${i}`] = i + 2;
      chartableFields(rows('/gps', counts)).fields.should.eql([]);
    });

    it('folds everything past the eighth bar into one Other bar', () => {
      const counts = {};
      for (let i = 0; i < 12; i += 1) counts[`v${i}`] = 100 - i;
      const [field] = chartableFields(rows('/crop', counts)).fields;
      field.values.should.have.length(9);
      field.values[8].should.eql({ value: null, other: 4, count: 89 + 90 + 91 + 92 });
    });

    it('says when it stopped short of every field', () => {
      const many = [];
      for (let i = 0; i < 14; i += 1) many.push(...rows(`/f${i}`, { a: 10, b: 5 }));
      const { fields, truncated } = chartableFields(many);
      fields.should.have.length(12);
      truncated.should.equal(true);
    });
  });

  /*
  The part that is a security control rather than a preference. These run on
  the shared-dashboard path, which has no reader behind it: a bar of height one
  there publishes one household's answer to anybody holding the link.
  */
  describe('the disclosure floor', () => {
    it('suppresses a value fewer submissions than the floor gave', () => {
      const [field] = chartableFields(
        rows('/district', { Bombali: 30, Kono: 20, Pujehun: 3, Moyamba: 3 }),
        { minValueCount: 5 }
      ).fields;
      field.values.map(v => v.value).should.eql(['Bombali', 'Kono', null]);
      // Folded together rather than dropped, so the counts still describe the
      // form, and the Other bar clears the floor on its own.
      field.values[2].should.eql({ value: null, other: 2, count: 6 });
    });

    it('drops the Other bar when the suppressed tail is itself too small', () => {
      const [field] = chartableFields(
        rows('/district', { Bombali: 30, Kono: 20, Pujehun: 1 }), { minValueCount: 5 }
      ).fields;
      // One suppressed value alone in an Other bar is that value relabelled.
      field.values.should.eql([
        { value: 'Bombali', count: 30 }, { value: 'Kono', count: 20 }
      ]);
    });

    // The case the old readability rule let through: six submissions, five
    // distinct answers, so four bars are one person each.
    it('drops a field the readability rule would have published', () => {
      const answers = rows('/respondent_name',
        { 'Mariama Kamara': 2, 'Alusine Sesay': 1, 'Fatmata Bangura': 1, 'Idrissa Koroma': 1, 'Sia Momoh': 1 });
      chartableFields(answers).fields.should.have.length(1);
      chartableFields(answers, { minValueCount: 5 }).fields.should.eql([]);
    });

    it('drops a field when only one of its values clears the floor', () => {
      chartableFields(
        rows('/crop', { cocoa: 40, coffee: 3, cashew: 2 }), { minValueCount: 5 }
      ).fields.should.eql([]);
    });

    // A date of birth is as identifying as a name and passes every type check.
    it('protects a date field the same way it protects a name', () => {
      const dob = rows('/dob',
        { '1990-01-01': 4, '1991-02-02': 4, '1992-03-03': 1 }, 'date');
      chartableFields(dob, { minValueCount: 5 }).fields.should.eql([]);
    });

    it('leaves the authenticated path exactly as it was', () => {
      const answers = rows('/district', { Bombali: 30, Kono: 20, Pujehun: 1 });
      chartableFields(answers).fields[0].values.should.eql([
        { value: 'Bombali', count: 30 }, { value: 'Kono', count: 20 },
        { value: 'Pujehun', count: 1 }
      ]);
    });

    it('still publishes a genuine aggregate', () => {
      const [field] = chartableFields(
        rows('/district', { Bombali: 300, Kono: 200, Pujehun: 120 }), { minValueCount: 5 }
      ).fields;
      field.values.should.have.length(3);
      field.answered.should.equal(620);
    });
  });
});
