require('should');
const { sql } = require('slonik');
const { testService } = require('../setup');

// The import routes write Submissions, so the guarantees worth proving are the
// ones that stop them writing: the blank-Form gate, the hash that binds a
// commit to the file that passed validation, and the refusal to import a file
// with any error in it.

const csv = (text) => Buffer.from(text, 'utf8');

const dryRun = (as, body) => as.post('/v1/projects/1/forms/simple/submission-import/dry-run')
  .attach('file', body, { filename: 'import.csv', contentType: 'text/csv' });

const commit = (as, body, validationHash) =>
  as.post('/v1/projects/1/forms/simple/submission-import/commit')
    .field('validationHash', validationHash)
    .attach('file', body, { filename: 'import.csv', contentType: 'text/csv' });

describe('api: submission CSV import', () => {
  describe('GET .../submission-import/template.csv', () => {
    it('lists the importable fields and omits the meta group', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.get('/v1/projects/1/forms/simple/submission-import/template.csv')
          .expect(200)
          .then(({ text, headers }) => {
            headers['content-type'].should.startWith('text/csv');
            const header = text.replace(/^\uFEFF/, '').trim();
            header.should.equal('/name,/age');
            header.should.not.match(/instanceID/);
          }))));

    it('rejects a user who cannot create Submissions', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        asChelsea.get('/v1/projects/1/forms/simple/submission-import/template.csv')
          .expect(403))));
  });

  describe('POST .../submission-import/dry-run', () => {
    it('accepts a well formed file and reports no errors', testService((service) =>
      service.login('alice', (asAlice) =>
        dryRun(asAlice, csv('/name,/age\nAmina,42\nBo,17\n'))
          .expect(200)
          .then(({ body }) => {
            body.rows.should.equal(2);
            body.validRows.should.equal(2);
            body.errors.should.eql([]);
            body.hash.should.match(/^[0-9a-f]{64}$/);
          }))));

    it('reports the row and field of every bad value', testService((service) =>
      service.login('alice', (asAlice) =>
        dryRun(asAlice, csv('/name,/age\nAmina,42\nBo,not-a-number\n'))
          .expect(200)
          .then(({ body }) => {
            body.validRows.should.equal(1);
            body.errors.length.should.equal(1);
            body.errors[0].row.should.equal(3);
            body.errors[0].field.should.equal('/age');
          }))));

    it('refuses a header that is not a field of the published Form', testService((service) =>
      service.login('alice', (asAlice) =>
        dryRun(asAlice, csv('/name,/nonesuch\nAmina,x\n'))
          .expect(200)
          .then(({ body }) => {
            body.validRows.should.equal(0);
            body.errors.some(error => error.field === '/nonesuch').should.equal(true);
          }))));
  });

  describe('POST .../submission-import/commit', () => {
    it('creates one Submission per row and they are readable afterwards',
      testService((service) =>
        service.login('alice', (asAlice) =>
          dryRun(asAlice, csv('/name,/age\nAmina,42\nBo,17\n'))
            .expect(200)
            .then(({ body }) => commit(asAlice, csv('/name,/age\nAmina,42\nBo,17\n'), body.hash)
              .expect(200)
              .then(({ body: result }) => { result.created.should.equal(2); }))
            .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions')
              .expect(200)
              .then(({ body }) => { body.length.should.equal(2); })))));

    it('refuses a file whose bytes differ from the validated ones',
      testService((service) =>
        service.login('alice', (asAlice) =>
          dryRun(asAlice, csv('/name,/age\nAmina,42\n'))
            .expect(200)
            // The same shape, a different value: exactly the substitution the
            // hash exists to catch.
            .then(({ body }) => commit(asAlice, csv('/name,/age\nAmina,43\n'), body.hash)
              .expect(400)
              .then(({ body: error }) => {
                error.message.should.match(/validationHash/);
              })))));

    it('refuses a commit carrying no validation hash at all', testService((service) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submission-import/commit')
          .attach('file', csv('/name,/age\nAmina,42\n'),
            { filename: 'import.csv', contentType: 'text/csv' })
          .expect(400))));

    it('refuses a file that still has validation errors', testService((service) =>
      service.login('alice', (asAlice) => {
        const bad = '/name,/age\nAmina,not-a-number\n';
        return dryRun(asAlice, csv(bad))
          .expect(200)
          .then(({ body }) => commit(asAlice, csv(bad), body.hash).expect(400))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions')
            .expect(200)
            .then(({ body }) => { body.length.should.equal(0); }));
      })));

    it('rejects a user who cannot create Submissions', testService((service) =>
      service.login('chelsea', (asChelsea) =>
        dryRun(asChelsea, csv('/name,/age\nAmina,42\n')).expect(403))));
  });

  describe('the blank Form gate', () => {
    // Every route rechecks this, and the commit route rechecks it inside its
    // own transaction, so a Submission arriving between validation and commit
    // cannot slip a second import past the gate.
    const submit = (asAlice) => asAlice.post('/v1/projects/1/forms/simple/submissions')
      .send(`<data id="simple"><meta><instanceID>uuid:one</instanceID></meta>` +
        `<name>Field</name><age>30</age></data>`)
      .set('Content-Type', 'application/xml')
      .expect(200);

    it('closes template, dry-run and commit once a Submission exists',
      testService((service) =>
        service.login('alice', (asAlice) =>
          dryRun(asAlice, csv('/name,/age\nAmina,42\n'))
            .expect(200)
            .then(({ body }) => submit(asAlice).then(() => body.hash))
            .then((hash) => Promise.all([
              asAlice.get('/v1/projects/1/forms/simple/submission-import/template.csv')
                .expect(400),
              dryRun(asAlice, csv('/name,/age\nAmina,42\n')).expect(400),
              commit(asAlice, csv('/name,/age\nAmina,42\n'), hash).expect(400)
            ]))
            .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions')
              .expect(200)
              // The one real Submission, and nothing the refused import wrote.
              .then(({ body }) => { body.length.should.equal(1); })))));

    it('refuses a second import after a first one succeeded', testService((service) =>
      service.login('alice', (asAlice) =>
        dryRun(asAlice, csv('/name,/age\nAmina,42\n'))
          .expect(200)
          .then(({ body }) => commit(asAlice, csv('/name,/age\nAmina,42\n'), body.hash)
            .expect(200))
          .then(() => dryRun(asAlice, csv('/name,/age\nBo,17\n')).expect(400))
          .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions')
            .expect(200)
            .then(({ body }) => { body.length.should.equal(1); })))));
  });
});

// The 100-argument ceiling on jsonb_build_object put a hard limit of 50 fields
// on every path that extracts Submission values. A survey instrument crosses
// that routinely, so this pins the behaviour past it.
describe('api: wide Form extraction', () => {
  it('extracts values from a Form with more than fifty fields', testService((service) =>
    service.login('alice', (asAlice) => {
      const paths = Array.from({ length: 60 }, (unused, i) => `/q${i}`);
      const binds = paths.map(path =>
        `<bind nodeset="/data${path}" type="string"/>`).join('');
      const fields = paths.map(path => `<${path.slice(1)}/>`).join('');
      const xml = `<?xml version="1.0"?>
        <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:jr="http://openrosa.org/javarosa">
          <h:head><h:title>Wide</h:title><model><instance><data id="wide">
            <meta><instanceID/></meta>${fields}
          </data></instance>
          <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
          ${binds}
          </model></h:head><h:body/></h:html>`;
      return asAlice.post('/v1/projects/1/forms?publish=true')
        .send(xml).set('Content-Type', 'application/xml').expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms/wide/submissions')
          .send(`<data id="wide"><meta><instanceID>uuid:wide-1</instanceID></meta>` +
            paths.map((path, i) => `<q${i}>v${i}</q${i}>`).join('') + `</data>`)
          .set('Content-Type', 'application/xml').expect(200))
        // filter-fields and the dataset preview both run the extractor over
        // every field, which is where the ceiling used to be hit.
        .then(() => asAlice.post('/v1/projects/1/forms/wide/filtered-datasets/preview')
          .send({ columns: paths, query: [] })
          .expect(200)
          .then(({ body }) => {
            // Reaching a 200 at all is the point: the preview runs the
            // extractor across all sixty paths, which is the statement that
            // used to be rejected outright.
            body.total.should.equal(1);
            body.matching.should.equal(1);
            body.fields.should.equal(60);
          }));
    })));
});

// P0.1. The import writes Submissions that were, until this package,
// indistinguishable from ones collected on a phone.
describe('api: import provenance', () => {
  it('records where an imported Submission came from', testService((service, container) =>
    service.login('alice', (asAlice) =>
      dryRun(asAlice, csv('/name,/age\nAmina,42\n'))
        .expect(200)
        .then(({ body }) => commit(asAlice, csv('/name,/age\nAmina,42\n'), body.hash)
          .expect(200))
        .then(() => asAlice.get('/v1/projects/1/forms/simple/submissions')
          .expect(200))
        .then(() => container.all(sql`
          select * from field_data_submission_provenance
          order by "submissionDefId" desc limit 1`))
        .then((rows) => {
          rows.length.should.equal(1);
          const row = rows[0];
          row.origin.should.equal('imported');
          row.sourceRef.should.startWith('csv-import:');
          row.transformVersion.should.equal('csv-import@1');
          row.policyVersion.should.equal('p0.1');
          row.integrityHash.should.match(/^[0-9a-f]{64}$/);
          // A CSV says nothing about when the interview happened. Null, and
          // the marker says why, rather than the upload time standing in.
          (row.capturedAt === null).should.equal(true);
          row.degraded.should.eql({ capturedAt: 'unknown' });
        }))));
});
