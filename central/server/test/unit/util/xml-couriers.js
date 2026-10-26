/* eslint-disable no-await-in-loop */
const assert = require('node:assert/strict');
const xml = require('../../../lib/util/xml-couriers');
describe('(util) XML courier manifests', () => {
  const valid = '<data id="check" version="1"><answer>original</answer><meta><instanceID>uuid:one</instanceID></meta></data>';
  it('binds exact UTF-8 bytes and native form/version/instance while refusing ambiguous or malformed XML', async () => {
    const result = await xml.parse(Buffer.from(valid));
    assert.equal(result.manifest.xmlFormId, 'check'); assert.equal(result.manifest.version, '1'); assert.equal(result.manifest.instanceId, 'uuid:one'); assert.equal(result.manifest.sha256, xml.digest(Buffer.from(valid)));
    for (const value of ['', '<data', '<data id="check"/>', valid.replace('</meta>', '<instanceID>two</instanceID></meta>'), valid.replace('</meta>', '<deprecatedID/><deprecatedID>old</deprecatedID></meta>'), `<!DOCTYPE data [<!ENTITY x "value">]>${valid}`, valid.replace('uuid:one', '<nested/>'), valid.replace('</meta>', '</meta><meta/>')]) await assert.rejects(xml.parse(Buffer.from(value)));
    await assert.rejects(xml.parse(Buffer.from([0xff, 0xfe])));
    await assert.rejects(xml.parse(Buffer.alloc(xml.LIMIT + 1)));
  });
  it('accepts exact encrypted envelopes with either native instance location and rejects incomplete or ambiguous envelopes', async () => {
    const envelope = '<data id="check" version="1"><base64EncryptedKey>a2V5</base64EncryptedKey><encryptedXmlFile>submission.xml.enc</encryptedXmlFile><base64EncryptedElementSignature>c2ln</base64EncryptedElementSignature><meta><instanceID>uuid:sealed</instanceID></meta></data>';
    for (const value of [envelope, envelope.replace('<meta><instanceID>uuid:sealed</instanceID></meta>', '<instanceID>uuid:sealed</instanceID>')]) {
      const bytes = Buffer.from(value); const result = await xml.parse(bytes);
      assert.equal(result.partial.def.localKey, 'a2V5'); assert.equal(result.partial.def.encDataAttachmentName, 'submission.xml.enc');
      assert.equal(result.manifest.instanceId, 'uuid:sealed'); assert.equal(result.manifest.sha256, xml.digest(bytes));
    }
    for (const value of [envelope.replace('a2V5', '!'), envelope.replace('<encryptedXmlFile>submission.xml.enc</encryptedXmlFile>', ''), envelope.replace('submission.xml.enc', '../submission.enc'), envelope.replace('</data>', '<instanceID>other</instanceID></data>'), envelope.replace('</data>', '<base64EncryptedKey>a2V5</base64EncryptedKey></data>'), envelope.replace('a2V5', '<nested>a2V5</nested>'), envelope.replace('</meta>', '<deprecatedID>uuid:sealed</deprecatedID></meta>')]) await assert.rejects(xml.parse(Buffer.from(value)));
  });
  it('extracts exactly one different prior instance without inventing its separately reviewed hash', async () => {
    const bytes = Buffer.from(valid.replace('</meta>', '<deprecatedID>uuid:prior</deprecatedID></meta>'));
    const result = await xml.parse(bytes); assert.equal(result.deprecatedId, 'uuid:prior'); assert.equal(result.partial.deprecatedId.get(), 'uuid:prior');
    assert.equal(Object.hasOwn(result.manifest, 'baseSha256'), false);
    assert.throws(() => xml.manifestFor({ ...result.manifest, deprecatedId: result.deprecatedId }));
    assert.equal(xml.manifestFor({ ...result.manifest, deprecatedId: result.deprecatedId, baseSha256: 'a'.repeat(64) }).deprecatedId, 'uuid:prior');
    for (const value of [valid.replace('</meta>', '<deprecatedID/></meta>'), valid.replace('</meta>', '<deprecatedID>uuid:one</deprecatedID></meta>'), valid.replace('</meta>', '<deprecatedID><nested/></deprecatedID></meta>'), valid.replace('</data>', '<deprecatedID>prior</deprecatedID></data>')]) await assert.rejects(xml.parse(Buffer.from(value)));
  });

});
