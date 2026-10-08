// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const http = require('node:http');
const { sql } = require('slonik');
const { analysisFields, authorizeSource, normalizeAnalysis, scopedRowsSql, invalid } = require('./analysis-data');
const write = payload => new Promise((resolve, reject) => {
  const body = Buffer.from(JSON.stringify(payload));
  if (body.length > 24 * 1024 * 1024) { reject(invalid('export', null, 'Export exceeds 24 MB. Add filters.')); return; }
  const req = http.request({ hostname: '127.0.0.1', port: 5001, path: `/api/v1/data-export/${payload.format}`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': body.length } }, res => {
    const chunks = []; let size = 0;
    res.on('data', chunk => { size += chunk.length; if (size > 64 * 1024 * 1024) { res.destroy(); reject(invalid('export', null, 'Generated file exceeds 64 MB. Add filters.')); } else chunks.push(chunk); });
    res.on('error', reject); res.on('end', () => {
      const buffer = Buffer.concat(chunks);
      if (res.statusCode !== 200) { let message = 'Export writer failed.'; try { message = JSON.parse(buffer).message; } catch { /* sanitized error */ } reject(invalid('export', null, message)); } else resolve({ buffer, type: res.headers['content-type'], disposition: res.headers['content-disposition'] });
    });
  });
  req.setTimeout(60000, () => req.destroy(new Error('Export writer timed out.'))); req.on('error', reject); req.end(body);
});
const prepareExport = async (container, params, auth, body) => {
  if (!['csv', 'xlsx', 'kml', 'sav', 'dta'].includes(params.format)) throw invalid('format', params.format, 'Unsupported export format.');
  const { source } = await authorizeSource(container, params.projectId, body?.source, auth);
  const definition = normalizeAnalysis(body, source);
  // Repeat descendants are exported in separate joinable tables; never flattened to first answers.
  const fields = (definition.repeatPath ? analysisFields(source, definition.repeatPath) : source.fields).filter(f => !['structure', 'group', 'repeat'].includes(f.type) && (definition.repeatPath ? definition.columns.includes(f.path) : (body.columns == null || body.columns.includes(f.path) || (f.repeated && body.includeRepeats !== false))));
  const boundary = source.kind === 'filtered'
    ? { formId: source.dataset.formId, columns: source.definition.columns, query: source.definition.query }
    : { forms: source.forms.map(f => f.formId), fields: source.fields.map(f => [f.path, f.type]) };
  return { source, definition, fields, payload: { format: params.format, source: body.source, definition, fields, repeatPaths: source.repeatPaths, geometry: definition.geometry, boundary } };
};
const exportRowsSql = (source, definition, limit) => (definition.repeatPath ? sql`
    select "instanceId", "sourceForm", "submittedAt", "repeatIndex", extracted as data, null::text as xml
    from (${scopedRowsSql(source, definition)}) selected order by "submittedAt", "sourceForm", "instanceId", "repeatIndex" limit ${limit}` : sql`select selected."instanceId", selected."sourceForm", selected."submittedAt", null::integer as "repeatIndex", null::jsonb as data, sd.xml from (${scopedRowsSql(source, definition)}) selected
    join forms f on f."xmlFormId"=selected."sourceForm" and f.id=any(${sql.array(source.kind === 'filtered' ? [source.dataset.formId] : source.forms.map(f => f.formId), 'int4')})
    join submissions s on s."formId"=f.id and s."instanceId"=selected."instanceId" and s."deletedAt" is null and not s.draft
    join submission_defs sd on sd."submissionId"=s.id and sd.current=true
    order by selected."submittedAt", selected."sourceForm", selected."instanceId" limit ${limit}`);
const exportSelection = async (container, params, auth, body) => {
  const { source, definition, payload } = await prepareExport(container, params, auth, body);
  const rows = await container.db.any(sql`with bounded as (${exportRowsSql(source, definition, 5001)})
    select "instanceId", "sourceForm", "submittedAt", "repeatIndex", data,
      sum(octet_length(coalesce(xml, data::text))) over () > 20 * 1024 * 1024 as "tooLarge",
      case when sum(octet_length(coalesce(xml, data::text))) over () <= 20 * 1024 * 1024 then xml else null end as xml from bounded`);
  if (rows.length > 5000) throw invalid('export', null, 'Export is limited to 5000 submissions. Add filters.');
  if (rows.some(r => r.tooLarge)) throw invalid('export', null, 'Source XML exceeds 20 MB. Add filters.');
  return write({ ...payload,
    rows: rows.map(r => ({ instanceId: r.instanceId, sourceForm: r.sourceForm, submittedAt: r.submittedAt, xml: r.xml, data: r.data, repeatIndex: r.repeatIndex })) });
};
module.exports = { exportSelection, prepareExport, exportRowsSql, write };
