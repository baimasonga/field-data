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

describe('encrypted offline media challenge context', function challengeMedia() {
  this.timeout(30000);
  const challengeRow = () => ({
    ...row(), challengeId: '11111111-1111-4111-8111-111111111111', challengeNonce: 'a'.repeat(64),
    challengeIssuedAt: new Date(now).toISOString(), challengeExpiresAt: new Date(now + 20 * 60000).toISOString(),
    captureLocation: { source: 'browser-geolocation', latitude: 8.48, longitude: -13.23, accuracy: 15, sampledAt: new Date(now).toISOString(), capturedAt: new Date(now + 5000).toISOString() }
  });
  it('preserves challenge and location inside ciphertext without serializing credentials or transport state', async () => {
    const original = { ...challengeRow(), token: 'private-access-key', id: 'transport-id' };
    const record = await encryptMedia([original], phrase, now, origin);
    record.schemaVersion.should.equal('offline-media@2');
    const serialized = JSON.stringify(record);
    for (const value of [original.challengeNonce, original.challengeId, original.instanceId, 'sampledAt', 'private-access-key', 'transport-id']) serialized.includes(value).should.be.false;
    const data = await decryptMedia(record, phrase, now, origin); const restored = data.items[0];
    restored.challengeNonce.should.equal(original.challengeNonce); restored.challengeExpiresAt.should.equal(original.challengeExpiresAt);
    restored.captureLocation.should.eql(original.captureLocation); Object.hasOwn(restored, 'token').should.be.false; Object.hasOwn(restored, 'id').should.be.false;
  });
  it('retains expired challenge evidence without inventing a new challenge expiry', async () => {
    const original = challengeRow(); const record = await encryptMedia([original], phrase, now, origin);
    const data = await decryptMedia(record, phrase, now + 21 * 60000, origin);
    data.items[0].challengeExpiresAt.should.equal(original.challengeExpiresAt);
  });
  it('rejects partial, malformed, non-image and expanded location challenge manifests', async () => {
    for (const patch of [{ challengeNonce: undefined }, { challengeId: 'invalid' }, { challengeExpiresAt: new Date(now + 20 * 60000 + 1).toISOString() },
      { challengeIssuedAt: 'invalid' }, { captureLocation: { ...challengeRow().captureLocation, latitude: 91 } }, { file: new File(['test'], 'audio.mp3', { type: 'audio/mpeg' }) }])
      await rejects(() => encryptMedia([{ ...challengeRow(), ...patch }], phrase, now, origin));
  });
  it('decrypts existing version-one archives with their original authenticated header', async () => {
    const bytes = new Uint8Array([7]); const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    const data = {
      schemaVersion: 'offline-media@1', origin, createdAt: now, expiresAt: now + 3600000,
      items: [{ xmlFormId: 'verify', instanceId: 'own-instance', name: 'old.jpg', contentType: 'image/jpeg', priority: 1, size: 1, sha256, bytes: 'Bw==' }]
    };
    const salt = new Uint8Array(16); const iv = new Uint8Array(12); const encoder = new TextEncoder();
    const material = await crypto.subtle.importKey('raw', encoder.encode(phrase), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(`offline-media@1:${origin}`) }, key, encoder.encode(JSON.stringify(data)));
    const encode = value => btoa(String.fromCharCode(...new Uint8Array(value)));
    const record = { schemaVersion: 'offline-media@1', salt: encode(salt), iv: encode(iv), ciphertext: encode(ciphertext) };
    (await decryptMedia(record, phrase, now, origin)).items[0].file.name.should.equal('old.jpg');
    await rejects(() => decryptMedia({ ...record, schemaVersion: 'offline-media@2' }, phrase, now, origin));
  });
});
