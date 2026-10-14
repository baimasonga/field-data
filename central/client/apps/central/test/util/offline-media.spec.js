/* eslint-disable no-await-in-loop */
import { decryptMedia, encryptMedia, MEDIA_LIMIT, validateMedia } from '../../src/util/offline-media';

const phrase = 'independent-media-passphrase';
const origin = 'https://field.example';
const now = Date.now();
const row = (size = 23) => ({
  xmlFormId: 'verify', instanceId: 'own-instance', priority: 1,
  file: new File([new Uint8Array(size).fill(7)], 'evidence.jpg', { type: 'image/jpeg' })
});
const rejects = async operation => {
  let rejected = false;
  try { await operation(); } catch { rejected = true; }
  rejected.should.be.true;
};
describe('encrypted offline media', function testMedia() {
  this.timeout(30000);
  it('round trips exact bytes and priority while keeping metadata encrypted', async () => {
    const original = row(); const record = await encryptMedia([original], phrase, now, origin);
    Object.keys(record).sort().should.eql(['ciphertext', 'iv', 'salt', 'schemaVersion']);
    const serialized = JSON.stringify(record);
    for (const secret of [original.xmlFormId, original.instanceId, original.file.name, phrase]) serialized.includes(secret).should.be.false;
    const opened = await decryptMedia(record, phrase, now, origin);
    opened.items[0].priority.should.equal(1); opened.items[0].file.name.should.equal('evidence.jpg');
    Array.from(new Uint8Array(await opened.items[0].file.arrayBuffer())).should.eql(Array.from(new Uint8Array(await original.file.arrayBuffer())));
  });
  it('rejects wrong passwords, modified ciphertext, different origins and expired packages', async () => {
    const record = await encryptMedia([row()], phrase, now, origin);
    await rejects(() => decryptMedia(record, 'incorrect-media-passphrase', now, origin));
    await rejects(() => decryptMedia({ ...record, ciphertext: `${record.ciphertext[0] === 'A' ? 'B' : 'A'}${record.ciphertext.slice(1)}` }, phrase, now, origin));
    await rejects(() => decryptMedia(record, phrase, now, 'https://another.example'));
    await rejects(() => decryptMedia(record, phrase, now + 24 * 3600000, origin));
    await rejects(() => decryptMedia({ ...record, token: 'unexpected' }, phrase, now, origin));
  });
  it('uses fresh salts and nonces for repeated saves', async () => {
    const a = await encryptMedia([row()], phrase, now, origin); const b = await encryptMedia([row()], phrase, now, origin);
    (a.salt === b.salt).should.be.false; (a.iv === b.iv).should.be.false; (a.ciphertext === b.ciphertext).should.be.false;
  });
  it('supports the complete 20 MB boundary without unbounded encoding operations', async () => {
    const record = await encryptMedia([row(MEDIA_LIMIT)], phrase, now, origin);
    const data = await decryptMedia(record, phrase, now, origin);
    data.items[0].file.size.should.equal(MEDIA_LIMIT);
    await rejects(() => encryptMedia([row(MEDIA_LIMIT + 1)], phrase, now, origin));
  });
  it('rejects empty, duplicate, invalid-type and excessive selections', async () => {
    for (const rows of [[], [row(0)], [row(), row()], Array.from({ length: 11 }, () => row()),
      [{ ...row(), file: new File(['content'], '../evidence.jpg', { type: 'image/jpeg' }) }],
      [{ ...row(), file: new File(['content'], 'evidence.html', { type: 'text/html' }) }]])
      await rejects(() => encryptMedia(rows, phrase, now, origin));
  });
  it('rejects malformed manifests even if encrypted with the shared passphrase', async () => {
    const bytes = new Uint8Array([7]);
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    const data = {
      schemaVersion: 'offline-media@1', origin, createdAt: now, expiresAt: now + 3600000,
      items: [{ xmlFormId: 'verify', instanceId: 'own-instance', name: 'evidence.jpg', contentType: 'image/jpeg', priority: 1, size: 1, sha256, bytes: 'Bw==' }]
    };
    await validateMedia(data, now, origin);
    for (const patch of [{ bytes: 'CA==' }, { size: 2 }, { priority: 0 }, { name: 'bad\u0000name' }, { credential: 'unexpected' }])
      await rejects(() => validateMedia({ ...data, items: [{ ...data.items[0], ...patch }] }, now, origin));
    await rejects(() => validateMedia({ ...data, createdAt: now + 3600000 }, now, origin));
    await rejects(() => validateMedia({ ...data, expiresAt: now + 25 * 3600000 }, now, origin));
  });
});
