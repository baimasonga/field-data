require('should');
const { testService } = require('../setup');

// The DHIS2 target derives its own delivery URL from the configured server and
// refuses a field mapping that names a question the Form does not have. Both
// happen at write time, so a misconfigured integration is rejected when it is
// saved rather than discovered when a Submission fails to deliver.

const withKey = (proc) => {
  const previous = process.env.FIELD_DATA_WEBHOOK_ENCRYPTION_KEY;
  process.env.FIELD_DATA_WEBHOOK_ENCRYPTION_KEY = '33'.repeat(32);
  const restore = () => {
    if (previous == null) delete process.env.FIELD_DATA_WEBHOOK_ENCRYPTION_KEY;
    else process.env.FIELD_DATA_WEBHOOK_ENCRYPTION_KEY = previous;
  };
  return proc().then(
    (result) => { restore(); return result; },
    (error) => { restore(); throw error; }
  );
};

// example.com resolves, which is all validWebhookUrl checks; nothing is sent.
const webhook = (mapping) => ({
  name: 'DHIS2', target: 'dhis2', projectId: 1, xmlFormId: 'simple',
  config: {
    serverUrl: 'https://example.com', username: 'svc', password: 'secret-pw',
    dataSet: 'aBcDeFgHiJk', orgUnit: 'lMnOpQrStUv', period: '202609',
    mapping: JSON.stringify(mapping)
  }
});

describe('api: DHIS2 integration', () => {
  it('stores a mapped integration, derives its URL and hides the password',
    testService((service) => withKey(() =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/field-data/webhooks')
          .send(webhook({ '/age': 'wXyZaBcDeFg' }))
          .expect(200)
          .then(({ body }) => {
            body.target.should.equal('dhis2');
            body.url.should.equal('https://example.com/api/dataValueSets');
            // A managed target signs nothing; it authenticates to DHIS2 with
            // its own credentials instead.
            body.hasSecret.should.equal(false);
            body.config.password.set.should.equal(true);
            body.config.password.should.not.have.property('value');
            JSON.stringify(body).should.not.match(/secret-pw/);
            // Both events, so an edited Submission reaches DHIS2 too.
            body.events.should.eql(['submission.create', 'submission.update.version']);
          })))));

  it('refuses a mapping naming a question the Form does not have',
    testService((service) => withKey(() =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/field-data/webhooks')
          .send(webhook({ '/nonesuch': 'wXyZaBcDeFg' }))
          .expect(400)
          .then(({ body }) => {
            body.details.reason.should.match(/\/nonesuch/);
            // The mapping can carry question paths, so it is not echoed back.
            body.details.value.should.equal('[redacted]');
          })))));

  it('refuses a data element that is not a DHIS2 UID', testService((service) =>
    withKey(() => service.login('alice', (asAlice) =>
      asAlice.post('/v1/field-data/webhooks')
        .send(webhook({ '/age': 'not-a-uid' }))
        .expect(400)))));

  it('refuses a server URL that is not HTTPS', testService((service) =>
    withKey(() => service.login('alice', (asAlice) => {
      const insecure = webhook({ '/age': 'wXyZaBcDeFg' });
      insecure.config.serverUrl = 'http://example.com';
      return asAlice.post('/v1/field-data/webhooks').send(insecure).expect(400);
    }))));

  it('rejects a user who cannot set configuration', testService((service) =>
    withKey(() => service.login('chelsea', (asChelsea) =>
      asChelsea.post('/v1/field-data/webhooks')
        .send(webhook({ '/age': 'wXyZaBcDeFg' }))
        .expect(403)))));
});
