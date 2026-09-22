require('should');
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
