// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { sql } = require('slonik');
const { invalid } = require('./analysis-data');
const { extractObject } = require('./filtered-datasets');
const { normalizePublication } = require('./public-release');
const { Writable } = require('node:stream');
const MAX_BYTES = 20 * 1024 * 1024;
const datasetRelease = async (c, source, body) => {
  const config = normalizePublication({ ...body, categories: ['metadata_only_a', 'metadata_only_b'], label: body.label || 'Published dataset' });
  const policy = body.releasePolicy;
  if (!policy || policy.version !== 1 || policy.approvedForPublicRelease !== true || typeof policy.purpose !== 'string' || !policy.purpose.trim() || policy.purpose.length > 2000) throw invalid('releasePolicy', null, 'Supply an explicit public release purpose and approval.');
  if (!Array.isArray(body.fields) || !body.fields.length || body.fields.length > 50) throw invalid('fields', null, 'Explicitly select 1–50 public fields.');
  const form = source.forms[0];
  const fields = await c.db.any(sql`select ff.path, ff.name, ff.type, ff.binary from form_fields ff join form_defs fd on fd.id=${form.currentDefId} and fd."schemaId"=ff."schemaId" where ff."formId"=${form.formId}`);
  const selections = body.fields.map(selection => {
    const field = fields.find(f => f.path === selection.path);
    if (!field || source.repeatPaths.some(p => field.path.startsWith(`${p}/`)) || ['group', 'repeat', 'structure'].includes(field.type) || field.path.startsWith('/meta/')) throw invalid('fields', null, 'Choose readable, nonrepeating answer fields.');
    const label = String(selection.label || '').trim(); if (!label || label.length > 100 || ['__proto__', 'constructor', 'prototype'].includes(label)) throw invalid('fields', null, 'Supply a public label for every field.');
    if (field.binary && policy.allowMedia !== true) throw invalid('releasePolicy', null, 'Explicitly approve media release.');
    if (['geopoint', 'geotrace', 'geoshape'].includes(field.type) && policy.allowLocations !== true) throw invalid('releasePolicy', null, 'Explicitly approve location release.');
    if (field.type === 'string' && policy.allowText !== true) throw invalid('releasePolicy', null, 'Explicitly approve text answer release.');
    return { ...field, publicLabel: label };
  });
  if (new Set(selections.map(f => f.path)).size !== selections.length || new Set(selections.map(f => f.publicLabel)).size !== selections.length) throw invalid('fields', null, 'Public fields and labels must be unique.');
  const paths = selections.map(f => f.path);
  const rows = await c.db.any(sql`with selected as (select s.id, sd.id as "definitionId", ${extractObject(paths)} as extracted from submissions s join submission_defs sd on sd."submissionId"=s.id and sd.current=true where s."formId"=${form.formId} and s."deletedAt" is null and not s.draft and xml_is_well_formed_document(sd.xml) order by s.id limit 5001) select id, "definitionId", sum(octet_length(extracted::text)) over () > ${MAX_BYTES} as "tooLarge", case when sum(octet_length(extracted::text)) over () <= ${MAX_BYTES} then extracted else '{}'::jsonb end as extracted from selected`);
  if (rows.some(row => row.tooLarge)) throw invalid('release', null, 'Public snapshot exceeds 20 MB.');
  if (rows.length > 5000) throw invalid('release', null, 'Public snapshots support at most 5,000 records.');
  const records = []; let size = 0;
  for (const row of rows) {
    const record = {};
    for (const field of selections) {
      const answer = row.extracted[field.path] || null;
      if (field.binary && answer) {
        // Bind the attachment to the selected answer in this exact current definition.
        // eslint-disable-next-line no-await-in-loop
        const attachment = await c.db.maybeOne(sql`select b.id, b.sha, b."contentType", b.s3_status, octet_length(b.content) > ${MAX_BYTES - size} as oversized, case when octet_length(b.content) <= ${MAX_BYTES - size} then b.content else null end as content from submission_attachments a join blobs b on b.id=a."blobId" where a."submissionDefId"=${row.definitionId} and a.name=${answer} and coalesce(a."isClientAudit", false)=false`);
        if (attachment?.oversized) throw invalid('release', null, 'Public snapshot exceeds 20 MB.');
        if (!attachment) throw invalid('media', null, 'An approved media answer has no available attachment.');
        if (!['image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'audio/ogg', 'video/mp4', 'application/pdf'].includes(attachment.contentType)) throw invalid('media', null, 'The selected attachment format is unsupported for public release.');
        const chunks = []; let retained = 0;
        if (attachment.s3_status === 'uploaded') {
          // eslint-disable-next-line no-await-in-loop
          const pipe = await c.s3.pipeContent(attachment); const remaining = MAX_BYTES - size;
          const sink = new Writable({ write(chunk, _, callback) { retained += chunk.length; if (retained > remaining) callback(invalid('release', null, 'Public snapshot exceeds 20 MB.')); else { chunks.push(chunk); callback(); } } });
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve, reject) => { pipe.with(sink).pipelineToPromise(resolve, reject); });
        } else {
          if (!Buffer.isBuffer(attachment.content)) throw invalid('media', null, 'Approved media is unavailable.');
          chunks.push(attachment.content);
        }
        const data = Buffer.concat(chunks);
        if (size + data.length > MAX_BYTES) throw invalid('release', null, 'Public snapshot exceeds 20 MB.');
        record[field.publicLabel] = { contentType: attachment.contentType, encoding: 'base64', data: data.toString('base64') };
      } else record[field.publicLabel] = answer;
    }
    size += Buffer.byteLength(JSON.stringify(record)); if (size > MAX_BYTES) throw invalid('release', null, 'Public snapshot exceeds 20 MB.');
    records.push(record);
  }
  return { metadata: config.metadata, release: { version: 2, kind: 'dataset', label: body.label || 'Published dataset', fields: selections.map(f => ({ label: f.publicLabel, type: f.type, media: f.binary === true })), records, suppressed: false, releasePolicy: { version: 1, purpose: policy.purpose.trim(), allowText: policy.allowText === true, allowLocations: policy.allowLocations === true, allowMedia: policy.allowMedia === true }, disclosure: 'These exact records and approved media are explicitly released for public download. No submission identifiers or unselected answers are included.' } };
};
module.exports = { datasetRelease };
