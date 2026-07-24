// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const config = require('config');

const storageRoot = process.env.FIELD_DATA_STORAGE_DIR || '/data';
const objectPrefix = (process.env.FIELD_DATA_OBJECT_PREFIX || 'field-data/').replace(/^\/+/, '');

const cleanKey = (key) => {
  const normalized = path.posix.normalize(String(key)).replace(/^\/+/, '');
  if (normalized === '..' || normalized.startsWith('../')) throw new Error('Invalid storage key.');
  return normalized;
};

const formatBytes = (bytes) => (bytes >= 1024 * 1024
  ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  : `${Math.max(0, bytes / 1024).toFixed(0)} KB`);

const encodePath = (value) => value.split('/').map(encodeURIComponent).join('/');
const hmac = (key, value, encoding) => crypto.createHmac('sha256', key).update(value).digest(encoding);
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

const initSupabaseStore = () => {
  const endpoint = process.env.SUPABASE_S3_ENDPOINT;
  const accessKey = process.env.SUPABASE_S3_ACCESS_KEY_ID;
  const secretKey = process.env.SUPABASE_S3_SECRET_ACCESS_KEY;
  const bucketName = process.env.SUPABASE_STORAGE_BUCKET;
  const region = process.env.SUPABASE_REGION;
  if (!(endpoint && accessKey && secretKey && bucketName && region)) return null;

  const base = new URL(endpoint);
  if (base.protocol !== 'https:') throw new Error('SUPABASE_S3_ENDPOINT must use HTTPS.');
  const endpointPath = base.pathname.replace(/\/+$/, '');
  const objectUrl = (key) => {
    const url = new URL(base);
    url.pathname = `${endpointPath}/${encodeURIComponent(bucketName)}/${encodePath(objectPrefix + cleanKey(key))}`;
    return url;
  };

  const signedRequest = async (method, key, body, metadata = {}) => {
    const url = objectUrl(key);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const shortDate = amzDate.slice(0, 8);
    const payloadHash = 'UNSIGNED-PAYLOAD';
    const canonicalHeaders = [
      `host:${url.host}`,
      `x-amz-content-sha256:${payloadHash}`,
      `x-amz-date:${amzDate}`
    ].join('\n') + '\n';
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = [
      method,
      url.pathname,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash
    ].join('\n');
    const scope = `${shortDate}/${region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      hash(canonicalRequest)
    ].join('\n');
    const dateKey = hmac(`AWS4${secretKey}`, shortDate);
    const regionKey = hmac(dateKey, region);
    const serviceKey = hmac(regionKey, 's3');
    const signingKey = hmac(serviceKey, 'aws4_request');
    const signature = hmac(signingKey, stringToSign, 'hex');
    const headers = {
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate
    };
    if (metadata['Content-Type']) headers['Content-Type'] = metadata['Content-Type'];

    const options = { method, headers };
    if (body != null) {
      options.body = body;
      if (!(Buffer.isBuffer(body) || typeof body === 'string')) options.duplex = 'half';
    }
    const response = await fetch(url, options);
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1000);
      throw new Error(`Supabase Storage ${method} failed (${response.status}): ${detail}`);
    }
    return response;
  };

  return {
    mode: 'supabase',
    putBuffer: (key, buffer, metadata = {}) => signedRequest('PUT', key, buffer, metadata),
    putStream: async (key, input, metadata = {}) => {
      let bytes = 0;
      const counter = new Transform({
        transform(chunk, encoding, callback) {
          bytes += chunk.length;
          callback(null, chunk);
        }
      });
      input.pipe(counter);
      await signedRequest('PUT', key, counter, metadata);
      return bytes;
    },
    getStream: async (key) => {
      const response = await signedRequest('GET', key);
      if (response.body == null) throw new Error('Supabase Storage returned an empty response body.');
      return Readable.fromWeb(response.body);
    },
    delete: (key) => signedRequest('DELETE', key)
  };
};

const initObjectStore = () => {
  const s3 = config.has('default.external.s3blobStore')
    ? config.get('default.external.s3blobStore')
    : {};
  const { server, accessKey, secretKey, bucketName } = s3;
  if (!(server && accessKey && secretKey && bucketName)) return null;

  const Minio = require('minio');
  const url = new URL(server);
  const client = new Minio.Client({
    endPoint: url.hostname,
    port: url.port === '' ? undefined : Number(url.port),
    useSSL: url.protocol === 'https:',
    accessKey,
    secretKey,
    region: process.env.S3_REGION || 'auto'
  });

  const objectName = (key) => objectPrefix + cleanKey(key);
  return {
    mode: 'object',
    putBuffer: (key, buffer, metadata = {}) =>
      client.putObject(bucketName, objectName(key), buffer, buffer.length, metadata),
    putStream: async (key, input, metadata = {}) => {
      let bytes = 0;
      const counter = new Transform({
        transform(chunk, encoding, callback) {
          bytes += chunk.length;
          callback(null, chunk);
        }
      });
      input.pipe(counter);
      await client.putObject(bucketName, objectName(key), counter, undefined, metadata);
      return bytes;
    },
    getStream: (key) => client.getObject(bucketName, objectName(key)),
    delete: (key) => client.removeObject(bucketName, objectName(key))
  };
};

const initFileStore = () => {
  const base = path.resolve(storageRoot, 'field-data');
  fs.mkdirSync(base, { recursive: true });
  const target = (key) => {
    const resolved = path.resolve(base, cleanKey(key));
    if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new Error('Invalid storage key.');
    return resolved;
  };

  return {
    mode: 'filesystem',
    putBuffer: async (key, buffer) => {
      const filename = target(key);
      await fs.promises.mkdir(path.dirname(filename), { recursive: true });
      const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
      await fs.promises.writeFile(temporary, buffer, { flag: 'wx' });
      await fs.promises.rename(temporary, filename);
    },
    putStream: async (key, input) => {
      const filename = target(key);
      await fs.promises.mkdir(path.dirname(filename), { recursive: true });
      const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
      let bytes = 0;
      const counter = new Transform({
        transform(chunk, encoding, callback) {
          bytes += chunk.length;
          callback(null, chunk);
        }
      });
      try {
        await pipeline(input, counter, fs.createWriteStream(temporary, { flags: 'wx' }));
        await fs.promises.rename(temporary, filename);
        return bytes;
      } catch (error) {
        await fs.promises.rm(temporary, { force: true });
        throw error;
      }
    },
    getStream: async (key) => fs.createReadStream(target(key)),
    delete: async (key) => fs.promises.rm(target(key), { force: true })
  };
};

const requestedMode = process.env.FIELD_DATA_STORAGE_MODE || 'auto';
const supabaseStore = initSupabaseStore();
const objectStore = supabaseStore || initObjectStore();
if (requestedMode === 'object' && objectStore == null) {
  throw new Error(
    'FIELD_DATA_STORAGE_MODE=object requires either complete SUPABASE_S3_* settings '
    + 'or S3_SERVER, S3_ACCESS_KEY, S3_SECRET_KEY, and S3_BUCKET_NAME.'
  );
}

module.exports = {
  storage: requestedMode === 'filesystem' ? initFileStore() : (objectStore || initFileStore()),
  formatBytes
};
