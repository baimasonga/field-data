const Should = require('should'); // eslint-disable-line no-unused-vars
const { getTarget, normalizeConfig, redactConfig, sealConfig, openConfig, describeTargets } =
  require('../../../lib/util/rest-targets');
const xml = require('../../../lib/util/rest-targets/xml');
const dhis2 = require('../../../lib/util/rest-targets/dhis2');

// A recorded event, the shape the worker actually builds.
const event = {
  event: 'submission.create',
  actorId: 7,
  acteeId: 'a1b2',
  loggedAt: '2026-09-20T09:00:00.000Z',
  details: { instanceId: 'uuid:abc', submitterId: 11 }
};

describe('(util) rest targets', () => {
  describe('json', () => {
    it('sends the event unchanged, which existing receivers already parse', () => {
      const built = getTarget('json').buildRequest(event);
      built.method.should.equal('POST');
      built.headers['Content-Type'].should.equal('application/json');
      JSON.parse(built.body.toString()).should.eql(event);
    });

    it('sets a Content-Length matching the bytes, not the characters', () => {
      const built = getTarget('json').buildRequest({ note: 'café' });
      built.headers['Content-Length'].should.equal(built.body.length);
      built.headers['Content-Length'].should.be.above(JSON.stringify({ note: 'café' }).length - 1);
    });
  });

  describe('xml', () => {
    it('serializes the event with a declaration and a root', () => {
      const body = getTarget('xml').buildRequest(event).body.toString();
      body.should.startWith('<?xml version="1.0" encoding="UTF-8"?><event>');
      body.should.containEql('<instanceId>uuid:abc</instanceId>');
    });

    // The whole risk of emitting XML: a value that closes its own element.
    it('escapes text so a value cannot become markup', () => {
      const body = getTarget('xml')
        .buildRequest({ note: '</note><injected>x</injected>' }).body.toString();
      body.should.not.containEql('<injected>');
      body.should.containEql('&lt;/note&gt;');
    });

    it('escapes every character that needs it', () => {
      xml._serialize('a & b < c > d " e \' f', 'x')
        .should.equal('<x>a &amp; b &lt; c &gt; d &quot; e &apos; f</x>');
    });

    // Keys become element names, so a key that is not a legal name would be a
    // way to inject markup through a field label.
    it('drops keys that are not legal element names', () => {
      const body = xml._serialize({ ok: 1, '<bad>': 2, 'also bad': 3 }, 'root');
      body.should.equal('<root><ok>1</ok></root>');
    });

    it('takes a root element name, and refuses an unsafe one', () => {
      getTarget('xml').buildRequest({ a: 1 }, { rootElement: 'submission' })
        .body.toString().should.containEql('<submission>');
      getTarget('xml').buildRequest({ a: 1 }, { rootElement: '<script>' })
        .body.toString().should.containEql('<event>');
    });

    it('renders null as an empty element and arrays as repeats', () => {
      xml._serialize(null, 'x').should.equal('<x/>');
      xml._serialize([1, 2], 'x').should.equal('<x>1</x><x>2</x>');
    });

    it('stops rather than recursing forever on a cyclic payload', () => {
      const cycle = { name: 'a' };
      cycle.self = cycle;
      (() => xml._serialize(cycle, 'root')).should.not.throw();
    });
  });

  describe('normalizeConfig', () => {
    it('requires every credential needed by Google Sheets', () => {
      (() => normalizeConfig('google-sheets', { spreadsheetId: 'sheet' }))
        .should.throw(/Worksheet tab name/);
    });

    it('refuses a target this build cannot dispatch', () => {
      (() => normalizeConfig('unknown', {}))
        .should.throw(/must be one of/);
    });

    it('normalizes the two Google synchronization choices as booleans', () => {
      const normalized = normalizeConfig('google-sheets', {
        spreadsheetId: 'sheet', sheetName: 'Data', clientId: 'client',
        clientSecret: 'secret', refreshToken: 'refresh',
        syncUpdates: 'true', sendExisting: true
      });
      normalized.config.syncUpdates.should.equal(true);
      normalized.config.sendExisting.should.equal(true);
    });

    it('defaults to json, which is what every existing row is', () => {
      normalizeConfig(undefined, null).target.name.should.equal('json');
    });

    it('validates DHIS2 identifiers and field mappings before storing them', () => {
      const config = {
        serverUrl: 'https://dhis.example.org', username: 'field-data', password: 'secret',
        dataSet: 'Abcdef12345', orgUnit: 'Orgunit1234', period: '202609',
        mapping: JSON.stringify({ '/data/cases': 'Element1234' })
      };
      normalizeConfig('dhis2', config).config.should.eql(config);
      (() => normalizeConfig('dhis2', { ...config, mapping: '{bad' }))
        .should.throw(/valid JSON/);
      (() => normalizeConfig('dhis2', { ...config, serverUrl: 'http://dhis.example.org' }))
        .should.throw(/HTTPS/);
    });

    // A typo sitting in the database looking like it configures something is
    // worse than a rejected request.
    it('drops keys the target does not declare', () => {
      normalizeConfig('xml', { rootElement: 'ok', rootElemnt: 'typo' })
        .config.should.eql({ rootElement: 'ok' });
    });
  });

  describe('redactConfig', () => {
    // Stand in for a target that holds a credential, so the redaction is
    // tested rather than assumed for whenever one is added.
    const withSecret = {
      apiKey: { type: 'string', required: true, secret: true, describe: 'key' },
      url: { type: 'string', required: true, secret: false, describe: 'url' }
    };

    it('returns a hint for a secret and the value for everything else', () => {
      const target = getTarget('xml');
      const original = target.configSchema;
      try {
        target.configSchema = withSecret;
        const safe = redactConfig('xml', { apiKey: 'sk-live-abcd1234', url: 'https://x.test' });
        safe.apiKey.should.eql({ set: true, hint: '…1234' });
        safe.url.should.equal('https://x.test');
        JSON.stringify(safe).should.not.containEql('sk-live-abcd1234');
      } finally {
        target.configSchema = original;
      }
    });

    it('says nothing at all about a key that is not set', () => {
      redactConfig('xml', {}).should.eql({});
    });

    it('encrypts Google credentials at rest and only returns a hint', () => {
      const previous = process.env.FIELD_DATA_WEBHOOK_ENCRYPTION_KEY;
      process.env.FIELD_DATA_WEBHOOK_ENCRYPTION_KEY = '11'.repeat(32);
      try {
        const sealed = sealConfig('google-sheets', {
          clientSecret: 'client-secret-abcd', refreshToken: 'refresh-token-1234'
        });
        JSON.stringify(sealed).should.not.containEql('client-secret-abcd');
        openConfig('google-sheets', sealed).should.eql({
          clientSecret: 'client-secret-abcd', refreshToken: 'refresh-token-1234'
        });
        redactConfig('google-sheets', sealed).should.eql({
          clientSecret: { set: true, hint: '…abcd' },
          refreshToken: { set: true, hint: '…1234' }
        });
      } finally {
        if (previous == null) delete process.env.FIELD_DATA_WEBHOOK_ENCRYPTION_KEY;
        else process.env.FIELD_DATA_WEBHOOK_ENCRYPTION_KEY = previous;
      }
    });

    it('encrypts and redacts the DHIS2 password', () => {
      const previous = process.env.FIELD_DATA_WEBHOOK_ENCRYPTION_KEY;
      process.env.FIELD_DATA_WEBHOOK_ENCRYPTION_KEY = '22'.repeat(32);
      try {
        const sealed = sealConfig('dhis2', { username: 'sync', password: 'password-1234' });
        JSON.stringify(sealed).should.not.containEql('password-1234');
        openConfig('dhis2', sealed).should.eql({ username: 'sync', password: 'password-1234' });
        redactConfig('dhis2', sealed).password.should.eql({ set: true, hint: '…1234' });
      } finally {
        if (previous == null) delete process.env.FIELD_DATA_WEBHOOK_ENCRYPTION_KEY;
        else process.env.FIELD_DATA_WEBHOOK_ENCRYPTION_KEY = previous;
      }
    });
  });

  describe('dhis2', () => {
    const config = {
      serverUrl: 'https://dhis.example.org/', username: 'sync', password: 'secret',
      dataSet: 'Abcdef12345', orgUnit: 'Orgunit1234', period: '202609',
      mapping: JSON.stringify({
        '/data/cases': 'Element1234',
        '/data/blank': 'Element5678'
      })
    };

    it('builds a bounded Data Value Set containing only mapped nonblank answers', () => {
      const built = dhis2.buildRequest({
        submittedAt: '2026-09-21T12:00:00.000Z',
        answers: { '/data/cases': '17', '/data/blank': '', '/data/name': 'not sent' }
      }, config);
      built.url.should.equal('https://dhis.example.org/api/dataValueSets');
      built.headers.Authorization.should.equal(`Basic ${Buffer.from('sync:secret').toString('base64')}`);
      built.headers['Content-Length'].should.equal(built.body.length);
      JSON.parse(built.body.toString()).should.eql({
        dataSet: 'Abcdef12345', completeDate: '2026-09-21', period: '202609',
        orgUnit: 'Orgunit1234', dataValues: [{ dataElement: 'Element1234', value: '17' }]
      });
    });

    it('builds the endpoint from the parsed URL, not by concatenation', () => {
      const { deliveryUrl } = getTarget('dhis2');
      deliveryUrl({ serverUrl: 'https://dhis.example.org' })
        .should.equal('https://dhis.example.org/api/dataValueSets');
      deliveryUrl({ serverUrl: 'https://dhis.example.org/' })
        .should.equal('https://dhis.example.org/api/dataValueSets');
      // A server behind a path prefix keeps it.
      deliveryUrl({ serverUrl: 'https://example.org/dhis' })
        .should.equal('https://example.org/dhis/api/dataValueSets');
    });

    it('refuses a server URL carrying a query string or a fragment', () => {
      // Appended to the raw string these land after the query or fragment, so
      // the request never reaches the endpoint.
      const config = (serverUrl) => ({
        serverUrl, username: 'u', password: 'p',
        dataSet: 'aBcDeFgHiJk', orgUnit: 'lMnOpQrStUv', period: '202609',
        mapping: JSON.stringify({ '/age': 'wXyZaBcDeFg' })
      });
      (() => normalizeConfig('dhis2', config('https://dhis.example.org/?x=1')))
        .should.throw(/query string or fragment/);
      (() => normalizeConfig('dhis2', config('https://dhis.example.org/#frag')))
        .should.throw(/query string or fragment/);
    });

    it('refuses to send a Submission with no mapped values', () => {
      (() => dhis2.buildRequest({
        submittedAt: '2026-09-21T12:00:00.000Z', answers: {}
      }, config)).should.throw(/no values/);
    });
  });

  describe('describeTargets', () => {
    // The form and the validator read the same schema, so they cannot drift.
    it('describes each target from the schema the validator uses', () => {
      const described = describeTargets();
      described.map(t => t.name).sort().should.eql(['dhis2', 'google-sheets', 'json', 'xml']);
      const xmlTarget = described.find(t => t.name === 'xml');
      xmlTarget.config.map(c => c.key).should.eql(['rootElement']);
      xmlTarget.config[0].describe.should.be.a.String();
      const google = described.find(t => t.name === 'google-sheets');
      google.requiresForm.should.equal(true);
      google.managesUrl.should.equal(true);
      const dhis = described.find(t => t.name === 'dhis2');
      dhis.requiresForm.should.equal(true);
      dhis.config.find(c => c.key === 'password').secret.should.equal(true);
    });
  });
});
