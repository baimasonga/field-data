const Should = require('should'); // eslint-disable-line no-unused-vars
const ExcelJS = require('exceljs');
const {
  normalizeFormDefinition, buildWorkbook, RESERVED_NAMES
} = require('../../../lib/util/xlsform-builder');

const question = (over = {}) => ({ type: 'text', name: 'q1', label: 'Question one', ...over });
const definition = (over = {}) => ({
  title: 'Housing Survey', formId: 'housing_survey', questions: [question()], ...over
});

const sheets = async (def) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildWorkbook(def));
  const read = (name) => {
    const rows = [];
    workbook.getWorksheet(name).eachRow(row => rows.push(
      row.values.slice(1).map(cell => (cell == null ? '' : String(cell)))
    ));
    return rows;
  };
  return { survey: read('survey'), choices: read('choices'), settings: read('settings') };
};

describe('(util) XLSForm builder', () => {
  describe('what it refuses, and why somebody can act on it', () => {
    it('needs a title and at least one question', () => {
      (() => normalizeFormDefinition({ questions: [question()] })).should.throw(/give the Form a title/);
      (() => normalizeFormDefinition(definition({ questions: [] }))).should.throw(/at least one question/);
    });

    // Names become XML node names, so they take the shape every path in this
    // codebase takes.
    it('refuses a name that could not be an XML node', () => {
      for (const name of ['2nd', 'has space', 'has/slash', '', 'a b']) {
        (() => normalizeFormDefinition(definition({ questions: [question({ name })] })))
          .should.throw(/give it a name|must start with a letter/);
      }
    });

    // A question called instanceID does not fail loudly. It produces a Form
    // that behaves strangely once Submissions arrive.
    it('refuses the names ODK reserves', () => {
      for (const name of ['instanceID', 'meta', 'today', 'deviceid']) {
        RESERVED_NAMES.has(name.toLowerCase()).should.equal(true);
        (() => normalizeFormDefinition(definition({ questions: [question({ name })] })))
          .should.throw(/reserves/);
      }
    });

    it('refuses the same name twice', () => {
      (() => normalizeFormDefinition(definition({
        questions: [question({ name: 'age' }), question({ name: 'age' })]
      }))).should.throw(/used twice/);
    });

    it('refuses a question with no label, which is what somebody reads', () => {
      (() => normalizeFormDefinition(definition({ questions: [question({ label: '  ' })] })))
        .should.throw(/give the question a label/);
    });

    it('refuses a choice question with no choices', () => {
      (() => normalizeFormDefinition(definition({
        questions: [question({ type: 'select_one', choices: [] })]
      }))).should.throw(/at least one choice/);
    });

    it('refuses a type it does not know rather than passing it through', () => {
      (() => normalizeFormDefinition(definition({ questions: [question({ type: 'barcode' })] })))
        .should.throw(/must be one of/);
      (() => normalizeFormDefinition(definition({ questions: [question({ type: 'calculate' })] })))
        .should.throw(/must be one of/);
    });

    // The upload endpoint refuses these too, but its message is about a
    // filename, which is not what the builder shows anybody.
    it('refuses a form id that looks like a filename', () => {
      (() => normalizeFormDefinition(definition({ formId: 'survey.xlsx' })))
        .should.throw(/cannot end in/);
    });

    it('derives a usable form id from the title when none is given', () => {
      // Trimmed at both ends: this id appears in URLs, in the OpenRosa form
      // list and on the QR code a phone is configured from.
      normalizeFormDefinition({ title: '  Housing Survey 2026! ', questions: [question()] })
        .formId.should.equal('housing_survey_2026');
    });
  });

  describe('the workbook it writes', () => {
    it('writes the three sheets XLSForm defines', async () => {
      const result = await sheets(normalizeFormDefinition(definition()));
      result.survey[0].should.containEql('type');
      result.survey[0].should.containEql('name');
      result.survey[0].should.containEql('label');
      result.choices[0].should.eql(['list_name', 'name', 'label']);
      result.settings[0].should.eql(['form_title', 'form_id', 'version']);
      result.settings[1].slice(0, 2).should.eql(['Housing Survey', 'housing_survey']);
    });

    it('names a choice list after its own question', async () => {
      const result = await sheets(normalizeFormDefinition(definition({
        questions: [question({
          type: 'select_one', name: 'district', label: 'District',
          choices: [{ name: 'bombali', label: 'Bombali' }, { name: 'kono', label: 'Kono' }]
        })]
      })));
      // The type column carries the list name, which is the question's own.
      result.survey[1][0].should.equal('select_one district');
      result.choices.slice(1).should.eql([
        ['district', 'bombali', 'Bombali'],
        ['district', 'kono', 'Kono']
      ]);
    });

    it('carries required, relevance and constraints into their columns', async () => {
      const result = await sheets(normalizeFormDefinition(definition({
        questions: [question({
          name: 'rooms', type: 'integer', label: 'Rooms', required: true,
          relevant: '${q1} != \'\'', constraint: '. > 0', constraintMessage: 'More than zero'
        })]
      })));
      const header = result.survey[0];
      const row = result.survey[1];
      row[header.indexOf('required')].should.equal('yes');
      row[header.indexOf('relevant')].should.equal('${q1} != \'\'');
      row[header.indexOf('constraint')].should.equal('. > 0');
      row[header.indexOf('constraint_message')].should.equal('More than zero');
    });

    // A note asks nothing, so a required note is a Form nobody can submit.
    it('never marks a note required', async () => {
      const result = await sheets(normalizeFormDefinition(definition({
        questions: [question({ type: 'note', name: 'intro', label: 'Hello', required: true })]
      })));
      result.survey[1][result.survey[0].indexOf('required')].should.equal('');
    });

    it('gives a version when none was chosen, so the Form has a history', async () => {
      const built = normalizeFormDefinition(definition());
      built.version.should.match(/^\d{14}$/);
    });
  });
});
