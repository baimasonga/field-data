const Should = require('should'); // eslint-disable-line no-unused-vars
const { getTarget, normalizeConfig, redactConfig, describeTargets } =
  require('../../../lib/util/rest-targets');
const xml = require('../../../lib/util/rest-targets/xml');

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
    it('refuses a target this build cannot dispatch', () => {
      (() => normalizeConfig('google-sheets', {}))
        .should.throw(/must be one of/);
    });

    it('defaults to json, which is what every existing row is', () => {
      normalizeConfig(undefined, null).target.name.should.equal('json');
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
  });

  describe('describeTargets', () => {
    // The form and the validator read the same schema, so they cannot drift.
    it('describes each target from the schema the validator uses', () => {
      const described = describeTargets();
      described.map(t => t.name).sort().should.eql(['json', 'xml']);
      const xmlTarget = described.find(t => t.name === 'xml');
      xmlTarget.config.map(c => c.key).should.eql(['rootElement']);
      xmlTarget.config[0].describe.should.be.a.String();
    });
  });
});
