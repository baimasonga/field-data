/* eslint-disable no-await-in-loop */
import { decode } from '../../src/util/offline-media';
import { decryptSubmissions, encryptSubmissions, prepareSubmissions, submissionIdentity, validateSubmissions, XML_LIMIT } from '../../src/util/offline-submissions';

const phrase = 'submission-queue-passphrase'; const origin = 'https://field.example'; const now = Date.now();
const xml = '<data id="verify"><answer>Exact bytes</answer><meta><instanceID>uuid:one</instanceID></meta></data>';
const files = () => [new File([xml], 'submission.xml')]; const identity = { actorId: 42, projectId: 7 };
const rejects = async action => { let failed = false; try { await action(); } catch { failed = true; } failed.should.be.true; };
describe('encrypted offline submissions', function submissions() {
  this.timeout(30000);
  it('keeps exact XML, collector binding, priorities and delivery checkpoints encrypted without extending expiry', async () => {
    const data = await prepareSubmissions(files(), identity, now, origin); data.items[0].priority = 1;
    const record = await encryptSubmissions(data, phrase, now, origin);
    for (const secret of ['uuid:one', 'verify', 'actorId', phrase, 'Exact bytes']) JSON.stringify(record).includes(secret).should.be.false;
    const restored = await decryptSubmissions(record, phrase, now, origin);
    restored.actorId.should.equal(42); restored.projectId.should.equal(7); restored.items[0].priority.should.equal(1);
    new TextDecoder().decode(decode(restored.items[0].bytes, XML_LIMIT)).should.equal(xml);
    restored.items[0].delivered = true;
    const checkpoint = await encryptSubmissions(restored, phrase, now + 1000, origin);
    const reopened = await decryptSubmissions(checkpoint, phrase, now + 2000, origin);
    reopened.expiresAt.should.equal(now + 24 * 3600000); reopened.items[0].delivered.should.be.true;
    (checkpoint.iv === record.iv).should.be.false; (checkpoint.salt === record.salt).should.be.false;
  });
  it('rejects wrong passphrases, tampering, other origins, expiry and unrelated package schemas', async () => {
    const data = await prepareSubmissions(files(), identity, now, origin); const record = await encryptSubmissions(data, phrase, now, origin);
    await rejects(() => decryptSubmissions(record, 'incorrect-submission-password', now, origin));
    await rejects(() => decryptSubmissions(record, phrase, now, 'https://other.example'));
    await rejects(() => decryptSubmissions(record, phrase, now + 24 * 3600000, origin));
    await rejects(() => decryptSubmissions({ ...record, ciphertext: `AAAA${record.ciphertext.slice(4)}` }, phrase, now, origin));
    await rejects(() => decryptSubmissions({ ...record, schemaVersion: 'offline-media@2' }, phrase, now, origin));
    await rejects(() => validateSubmissions({ ...data, actorId: '42' }, now, origin));
    await rejects(() => validateSubmissions({ ...data, items: [{ ...data.items[0], sha256: '0'.repeat(64) }] }, now, origin));
  });
  it('refuses ambiguous, edited, malformed or oversized XML and duplicate targets', async () => {
    for (const value of ['<data', '<data id="x"/>', xml.replace('</meta>', '<instanceID>two</instanceID></meta>'), xml.replace('</meta>', '<deprecatedID>old</deprecatedID></meta>'), `<!DOCTYPE data [<!ENTITY x "value">]>${xml}`])
      await rejects(async () => submissionIdentity(new TextEncoder().encode(value)));
    for (const list of [[], [...files(), ...files()], [new File(['x'.repeat(XML_LIMIT + 1)], 'big.xml')], Array.from({ length: 11 }, () => files()[0])])
      await rejects(() => prepareSubmissions(list, identity, now, origin));
    await rejects(() => prepareSubmissions(files(), {}, now, origin));
  });
  it('retains encrypted native envelopes byte for byte and rejects ambiguous or incomplete envelope identities', async () => {
    const envelope = '<data id="verify" version="1"><base64EncryptedKey>a2V5</base64EncryptedKey><encryptedXmlFile>submission.xml.enc</encryptedXmlFile><base64EncryptedElementSignature>c2ln</base64EncryptedElementSignature><meta><instanceID>uuid:sealed</instanceID></meta></data>';
    for (const value of [envelope, envelope.replace('<meta><instanceID>uuid:sealed</instanceID></meta>', '<instanceID>uuid:sealed</instanceID>')]) {
      const data = await prepareSubmissions([new File([value], 'envelope.xml')], identity, now, origin);
      const record = await encryptSubmissions(data, phrase, now, origin);
      const restored = await decryptSubmissions(record, phrase, now, origin);
      new TextDecoder().decode(decode(restored.items[0].bytes, XML_LIMIT)).should.equal(value);
      submissionIdentity(decode(restored.items[0].bytes, XML_LIMIT), true).should.deep.equal({ xmlFormId: 'verify', instanceId: 'uuid:sealed', version: '1' });
    }
    for (const value of [envelope.replace('a2V5', '!'), envelope.replace('<encryptedXmlFile>submission.xml.enc</encryptedXmlFile>', ''), envelope.replace('submission.xml.enc', '../submission.enc'), envelope.replace('</data>', '<instanceID>other</instanceID></data>'), envelope.replace('</data>', '<base64EncryptedKey>a2V5</base64EncryptedKey></data>'), envelope.replace('a2V5', '<nested>a2V5</nested>')]) await rejects(async () => submissionIdentity(new TextEncoder().encode(value)));
  });
});
