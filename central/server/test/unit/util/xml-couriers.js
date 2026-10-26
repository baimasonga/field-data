/* eslint-disable no-await-in-loop */
const assert = require('node:assert/strict');
const xml = require('../../../lib/util/xml-couriers');
describe('(util) XML courier manifests', () => {
  const valid = '<data id="check" version="1"><answer>original</answer><meta><instanceID>uuid:one</instanceID></meta></data>';
  it('binds exact UTF-8 bytes and native form/version/instance while refusing ambiguous, edited or malformed XML', async () => {
    const result = await xml.parse(Buffer.from(valid));
    assert.equal(result.manifest.xmlFormId, 'check'); assert.equal(result.manifest.version, '1'); assert.equal(result.manifest.instanceId, 'uuid:one'); assert.equal(result.manifest.sha256, xml.digest(Buffer.from(valid)));
    for (const value of ['', '<data', '<data id="check"/>', valid.replace('</meta>', '<instanceID>two</instanceID></meta>'), valid.replace('</meta>', '<deprecatedID>old</deprecatedID></meta>'), `<!DOCTYPE data [<!ENTITY x "value">]>${valid}`, valid.replace('uuid:one', '<nested/>'), valid.replace('</meta>', '</meta><meta/>')]) await assert.rejects(xml.parse(Buffer.from(value)));
    await assert.rejects(xml.parse(Buffer.from([0xff, 0xfe])));
    await assert.rejects(xml.parse(Buffer.alloc(xml.LIMIT + 1)));
  });
});
