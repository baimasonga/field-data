// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const fs = require('node:fs');
const path = require('node:path');
const { Transform } = require('node:stream');
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

const initObjectStore = () => {
  const s3 = config.has('default.external.s3blobStore')
    ? config.get('default.external.s3blobStore')
    : {};
  const { server, accessKey, secretKey, bucketName } = s3;
  if (!(server && accessKey && secretKey && bucketName)) return null;

  const Minio = require('minio');
  const url = new URL(server);
  const client = new Minio.Client({
    endPoint: (url.hostname + url.pathname).replace(/\/$/, ''),
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
const objectStore = initObjectStore();
if (requestedMode === 'object' && objectStore == null) {
  throw new Error('FIELD_DATA_STORAGE_MODE=object requires S3_SERVER, S3_ACCESS_KEY, S3_SECRET_KEY, and S3_BUCKET_NAME.');
}

module.exports = {
  storage: requestedMode === 'filesystem' ? initFileStore() : (objectStore || initFileStore()),
  formatBytes
};
