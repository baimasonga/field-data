// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const KEY = 'FIELD_DATA_OFFLINE_SIGNING_KEY'; const ORIGIN = 'FIELD_DATA_OFFLINE_ORIGIN';
const siteOrigin = value => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.href !== `${url.origin}/`) throw new Error();
    return url.origin;
  } catch { throw new Error('Offline signing requires a valid HTTPS site origin.'); }
};
export const prepareOfflineSigning = async ({ accountId, scriptName = 'field-data', apiToken, origin = 'https://fielddata.quantixsl.com', providedKey = '', providedOrigin = '', fetcher = fetch }) => {
  const audience = siteOrigin(providedOrigin || origin);
  if (providedKey) {
    try {
      const parsed = createPrivateKey(providedKey);
      if (parsed.asymmetricKeyType !== 'ec' || parsed.asymmetricKeyDetails.namedCurve !== 'prime256v1') throw new Error();
    } catch { throw new Error('The configured offline signing key must be valid P-256.'); }
  }
  if (providedKey && providedOrigin) return { additions: {}, keyCreated: false, originCreated: false, audience };
  if (!/^[a-f0-9]{32}$/i.test(accountId ?? '') || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(scriptName) || !apiToken) throw new Error('Cloudflare deployment credentials are required.');
  let response; let data;
  try {
    response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}/secrets`,
      { headers: { Authorization: `Bearer ${apiToken}` }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    data = await response.json();
  } catch { throw new Error('Cloudflare signing metadata could not be read.'); }
  if (!response.ok || data?.success !== true || !Array.isArray(data.result)
    || data.result.some(item => typeof item?.name !== 'string')) throw new Error('Cloudflare signing metadata is unavailable or invalid.');
  const names = new Set(data.result.map(item => item.name));
  const additions = {};
  if (!providedKey && !names.has(KEY)) additions[KEY] = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  if (!providedOrigin && !names.has(ORIGIN)) additions[ORIGIN] = audience;
  return { additions, keyCreated: Object.hasOwn(additions, KEY), originCreated: Object.hasOwn(additions, ORIGIN), audience };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error('A private output file is required.');
    const result = await prepareOfflineSigning({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID, apiToken: process.env.CLOUDFLARE_API_TOKEN,
      providedKey: process.env.FIELD_DATA_OFFLINE_SIGNING_KEY, providedOrigin: process.env.FIELD_DATA_OFFLINE_ORIGIN });
    writeFileSync(process.argv[2], JSON.stringify(result.additions), { mode: 0o600, flag: 'wx' });
    console.log(`Offline signing settings prepared: new key ${result.keyCreated}, new origin ${result.originCreated}.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
