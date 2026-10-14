// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
class ReadinessError extends Error {}
const entryAssets = html => [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+\.(?:js|css))["']/g)].map(match => match[1]).sort();
export const verifyOfflineSigning = async ({ base, workerBase, deploymentId, audience, sessionToken, fetcher = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) => {
  const root = new URL(base); const worker = new URL(workerBase);
  if (root.protocol !== 'https:' || worker.protocol !== 'https:' || root.href !== `${root.origin}/` || worker.href !== `${worker.origin}/`
    || root.username || root.password || worker.username || worker.password || !deploymentId || !sessionToken) throw new ReadinessError('Signing verification requires the deployed site and authenticated session.');
  const get = async (url, options = {}, allowedStatuses = []) => {
    // Only idempotent operations may be retried: a failed creation response
    // can conceal a successful POST and must never create duplicate fixtures.
    const retryable = ['GET', 'DELETE'].includes(options.method ?? 'GET');
    for (let attempt = 0; ; attempt += 1) {
      let response;
      try { response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
      catch {
        if (!retryable || attempt >= 4) throw new ReadinessError('Signing verification could not reach the deployed site.');
      }
      if (response?.ok || allowedStatuses.includes(response?.status)) return response;
      if (response && (!retryable || ![502, 503, 504].includes(response.status) || attempt >= 4))
        throw new ReadinessError(`Signing verification received HTTP ${response.status}.`);
      await response?.body?.cancel();
      await pause(5000 * (attempt + 1));
    }
  };
  // Validate the actual user-facing origin before sending credentials or
  // creating a fixture. A working workers.dev site does not prove this site
  // is serving the release.
  const build = await (await get(new URL(`/field-data-build.json?check=${encodeURIComponent(deploymentId)}`, root))).json();
  if (build.deploymentId !== deploymentId) throw new ReadinessError('The custom-domain site is not serving this deployment.');
  const siteHtml = await (await get(new URL(`/?check=${encodeURIComponent(deploymentId)}`, root))).text();
  const workerHtml = await (await get(new URL(`/?check=${encodeURIComponent(deploymentId)}`, worker))).text();
  const siteAssets = entryAssets(siteHtml); const workerAssets = entryAssets(workerHtml);
  if (siteAssets.length === 0 || JSON.stringify(siteAssets) !== JSON.stringify(workerAssets)) throw new ReadinessError('The custom domain and Worker are serving different frontend assets.');
  const api = async (path, token, method = 'GET', body) => {
    const response = await get(new URL(`/v1${path}`, root), { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return method === 'DELETE' || response.status === 204 ? null : response.json();
  };
  const remove = async path => {
    // Successful DELETE responses can legitimately be empty. Confirm removal
    // through the real read route instead of relying on a JSON success body.
    await get(new URL(`/v1${path}`, root), { method: 'DELETE', headers: { Authorization: `Bearer ${sessionToken}` } }, [404]);
    const response = await get(new URL(`/v1${path}`, root), { headers: { Authorization: `Bearer ${sessionToken}` },
      cache: 'no-store' }, [404]);
    if (response.status !== 404) throw new ReadinessError(`Removed fixture is still readable (HTTP ${response.status}).`);
  };
  let project; let projectId; let appUser; let appUserId; let primaryError; const cleanupErrors = [];
  try {
    const name = `Offline readiness check ${randomUUID()}`;
    project = await api('/projects', sessionToken, 'POST', { name });
    if (!Number.isSafeInteger(project?.id) || project.id < 1 || project.name !== name) throw new ReadinessError('The temporary verification project was not confirmed.');
    projectId = project.id;
    const displayName = `Offline readiness check ${randomUUID()}`;
    appUser = await api(`/projects/${projectId}/app-users`, sessionToken, 'POST', { displayName });
    if (!Number.isSafeInteger(appUser?.id) || appUser.id < 1 || appUser.displayName !== displayName) throw new ReadinessError('The temporary App User was not confirmed.');
    appUserId = appUser.id;
    if (typeof appUser.token !== 'string' || !appUser.token) throw new ReadinessError('The temporary App User access was not confirmed.');
    const issued = await api('/field-data/app-user/offline-assignments', appUser.token);
    if (issued.enabled !== true || issued.bundle?.algorithm !== 'ES256') throw new ReadinessError('Live offline snapshot signing is not enabled.');
    const bundle = issued.bundle;
    if (Object.hasOwn(bundle.publicKey ?? {}, 'd')) throw new ReadinessError('The snapshot returned a private key.');
    const key = createPublicKey({ key: bundle.publicKey, format: 'jwk' });
    const keyId = createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
    const bytes = Buffer.from(bundle.payload, 'base64url');
    if (bytes.length > 262144 || key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails.namedCurve !== 'prime256v1' || keyId !== bundle.keyId
      || !verify('sha256', bytes, { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(bundle.signature, 'base64url'))) throw new ReadinessError('The deployed snapshot signature could not be verified.');
    const data = JSON.parse(bytes.toString('utf8'));
    if (!['offline-assignments@2', 'offline-assignments@3'].includes(data.schemaVersion) || data.audience !== new URL(audience).origin || data.actorId !== appUser.id || data.projectId !== project.id
      || data.complete !== true || !Array.isArray(data.items) || data.items.length !== 0 || !Array.isArray(data.itineraries?.items) || data.itineraries.items.length !== 0
      || (data.schemaVersion === 'offline-assignments@3' && (data.reverification?.complete !== true || data.reverification.omitted !== 0
        || !Array.isArray(data.reverification.items) || data.reverification.items.length !== 0))
      || data.itineraries.complete !== true || data.itineraries.omitted !== 0 || Date.parse(data.issuedAt) > Date.now() + 5 * 60000
      || Date.parse(data.expiresAt) <= Date.now() || Date.parse(data.expiresAt) - Date.parse(data.issuedAt) !== 8 * 3600000)
      throw new ReadinessError('The deployed snapshot audience, identity or expiry is incorrect.');
  } catch (error) { primaryError = error; }
  finally {
    if (appUserId != null && projectId != null) {
      try { await remove(`/projects/${projectId}/app-users/${appUserId}`); } catch (error) { cleanupErrors.push(error instanceof ReadinessError ? error.message : 'Unexpected cleanup response.'); }
    }
    if (projectId != null) {
      try { await remove(`/projects/${projectId}`); } catch (error) { cleanupErrors.push(error instanceof ReadinessError ? error.message : 'Unexpected cleanup response.'); }
    }
  }
  if (cleanupErrors.length > 0) throw new ReadinessError(`Verification fixture cleanup could not be confirmed (project ${projectId}): ${cleanupErrors.join(' ')} ${primaryError instanceof ReadinessError ? primaryError.message : primaryError ? 'Verification also failed.' : ''}`);
  if (primaryError) throw primaryError;
  return { verified: true, customDomain: true, fixtureRemoved: true };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await verifyOfflineSigning({ base: process.env.BASE, workerBase: process.env.WORKER_BASE, deploymentId: process.env.EXPECTED_DEPLOYMENT_ID,
      audience: process.env.FIELD_DATA_OFFLINE_ORIGIN, sessionToken: process.env.FIELD_DATA_SESSION_TOKEN });
    console.log('Custom-domain assets and live offline signatures verified; temporary fixture removed.');
  } catch (error) { console.error(error instanceof ReadinessError ? error.message : 'Offline signing verification failed with an unexpected response; inspect configuration and fixture cleanup.'); process.exitCode = 1; }
}
