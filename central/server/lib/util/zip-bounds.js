// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// How much a ZIP package is allowed to become.
//
// An .xlsx is a ZIP, and a size limit on the upload is a limit on the
// compressed bytes, which is not the quantity that costs anything. A valid
// workbook of 0.32 MB -- three per cent of the ten megabytes the report
// templates allow -- expands to 92.7 MB of XML and 735 MB of resident memory
// in ExcelJS. Uploading one takes project.update, so a project manager could
// exhaust the server at will, and nothing here rate-limits anything.
//
// So the archive is measured before a parser is allowed near it. Twice, because
// the two measurements answer different questions:
//
//   The central directory declares an uncompressed size per entry. Reading it
//   costs nothing and rejects everything an ordinary zip tool can produce.
//
//   Those declarations are written by whoever made the file, so they can lie.
//   Each entry is then inflated against a shared budget and thrown away. The
//   inflater is stopped the moment the budget is gone, so a liar costs the
//   budget and not a byte more.

const zlib = require('node:zlib');

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
// The end-of-central-directory record is last, but a trailing comment of up to
// 65535 bytes may follow it.
const EOCD_MAX_TRAILER = 0xffff + 22;

const invalid = (reason) => Object.assign(new Error(reason), { reason });

const findEndOfCentralDirectory = (buffer) => {
  const from = Math.max(0, buffer.length - EOCD_MAX_TRAILER);
  for (let at = buffer.length - 22; at >= from; at -= 1) {
    if (buffer.readUInt32LE(at) === EOCD_SIGNATURE) return at;
  }
  throw invalid('The uploaded file is not a readable .xlsx workbook.');
};

/*
The entries a ZIP says it contains, read from the central directory alone.

Zip64 is refused rather than parsed: a template that needs it is far past any
size this accepts, so the extra format would only ever be carrying something
unwelcome.
*/
const readEntries = (buffer) => {
  const eocd = findEndOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  let at = buffer.readUInt32LE(eocd + 16);
  if (count === 0xffff || at === 0xffffffff)
    throw invalid('Zip64 workbooks are not accepted.');

  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== CENTRAL_SIGNATURE)
      throw invalid('The uploaded file is not a readable .xlsx workbook.');
    const compressedSize = buffer.readUInt32LE(at + 20);
    const uncompressedSize = buffer.readUInt32LE(at + 24);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff)
      throw invalid('Zip64 workbooks are not accepted.');
    const nameLength = buffer.readUInt16LE(at + 28);
    entries.push({
      method: buffer.readUInt16LE(at + 10),
      compressedSize,
      uncompressedSize,
      localHeaderOffset: buffer.readUInt32LE(at + 42),
      name: buffer.toString('utf8', at + 46, at + 46 + nameLength)
    });
    at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
  }
  return entries;
};

// Where an entry's compressed bytes actually start. The local header repeats
// the name and extra fields, and its lengths are the ones that count.
const compressedSlice = (buffer, entry) => {
  const at = entry.localHeaderOffset;
  if (at + 30 > buffer.length || buffer.readUInt32LE(at) !== LOCAL_SIGNATURE)
    throw invalid('The uploaded file is not a readable .xlsx workbook.');
  const from = at + 30 + buffer.readUInt16LE(at + 26) + buffer.readUInt16LE(at + 28);
  const to = from + entry.compressedSize;
  if (to > buffer.length) throw invalid('The uploaded file is not a readable .xlsx workbook.');
  return buffer.subarray(from, to);
};

// Inflate one entry, counting and discarding. Resolves with the byte count, or
// rejects as soon as the budget is gone -- the inflater is destroyed there, so
// nothing beyond the budget is ever allocated.
const inflatedSize = (slice, budget) => new Promise((resolve, reject) => {
  let seen = 0;
  const inflate = zlib.createInflateRaw();
  inflate.on('data', (chunk) => {
    seen += chunk.length;
    if (seen > budget) {
      inflate.destroy();
      reject(invalid('The workbook expands to more than the allowed size when opened.'));
    }
  });
  inflate.on('end', () => resolve(seen));
  inflate.on('error', () => reject(invalid('The uploaded .xlsx workbook could not be read.')));
  inflate.end(slice);
});

/*
Refuse an archive that would cost more than `maxTotalBytes` to open.

`maxEntries` is here for the other shape of the same attack: a few bytes each,
several hundred thousand of them.
*/
const assertBoundedArchive = async (buffer, { maxTotalBytes, maxEntries }) => {
  const entries = readEntries(buffer);
  if (entries.length > maxEntries)
    throw invalid(`The workbook contains more than ${maxEntries} parts.`);

  const declared = entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  if (declared > maxTotalBytes)
    throw invalid('The workbook expands to more than the allowed size when opened.');

  let budget = maxTotalBytes;
  for (const entry of entries) {
    if (entry.compressedSize === 0) continue;
    // Stored, not deflated: it cannot expand, and the declared total above
    // already accounted for it.
    if (entry.method === 0) { budget -= entry.compressedSize; continue; }
    if (entry.method !== 8)
      throw invalid('The uploaded .xlsx workbook could not be read.');
    // eslint-disable-next-line no-await-in-loop
    budget -= await inflatedSize(compressedSlice(buffer, entry), budget);
    if (budget < 0)
      throw invalid('The workbook expands to more than the allowed size when opened.');
  }
  return { entries: entries.length, inflatedBytes: maxTotalBytes - budget };
};

module.exports = { assertBoundedArchive, _readEntries: readEntries };
