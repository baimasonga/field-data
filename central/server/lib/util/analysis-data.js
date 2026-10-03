// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { sql } = require('slonik');
const { normalizeDefinition, compileFilter, extractObject, projectObject } = require('./filtered-datasets');
const { fieldsForForm, resolveReportSource } = require('./xls-report-data');
const { normalizeWidget, capRows, MAX_BARS } = require('./widgets');
const { parseGeopoint } = require('./fieldwork-integrity');
const { Form } = require('../model/frames');
const { getOrNotFound } = require('./promise');
const Problem = require('./problem');

const invalid = (field, value, reason) => Problem.user.unexpectedValue({ field, value, reason });
const sourceSpec = (source) => {
  const names = { form: 'formId', filtered: 'filteredDatasetId', merged: 'mergedDatasetId' };
  if (!names[source?.kind] || !Number.isSafeInteger(Number(source.id)) || Number(source.id) < 1)
    throw invalid('source', source, 'Choose an existing form or dataset.');
  return { [names[source.kind]]: Number(source.id) };
};
const authorizeSource = async (container, projectId, selection, auth) => {
  const project = await container.Projects.getById(projectId).then(getOrNotFound);
  await auth.canOrReject('project.read', project);
  await auth.canOrReject('submission.list', project);
  await auth.canOrReject('submission.read', project);
  const source = await resolveReportSource(container.db, { projectId: project.id, ...sourceSpec(selection) });
  if (source == null) throw Problem.user.notFound();
  // Filtered datasets are an explicit delegation to their destination project.
  // A merged dataset, unlike a filtered delegation, requires every source form.
  if (source.kind !== 'filtered') {
    await Promise.all(source.forms.map(async f => {
      const form = await container.Forms.getByProjectAndXmlFormId(project.id, f.xmlFormId,
        Form.WithoutDef, Form.WithoutXml).then(getOrNotFound);
      await auth.canOrReject('submission.list', form);
      await auth.canOrReject('submission.read', form);
    }));
  }
  if (source.kind === 'filtered' && !source.definition.usable)
    throw invalid('source', selection, 'The saved dataset has missing fields or filters. Repair it before use.');
  const forms = source.kind === 'filtered' ? [source.dataset] : source.forms;
  const schemas = await Promise.all(forms.map(f => fieldsForForm(container.db, f.formId, f.currentDefId)));
  source.repeatPaths = [...new Set(schemas.flat().filter(f => f.type === 'repeat').map(f => f.path))];
  source.fields = source.fields.map(f => ({ ...f, repeated: source.repeatPaths.some(p => f.path.startsWith(`${p}/`)) }));
  return { source, project };
};
const normalizeAnalysis = (body, source) => {
  if (body?.version != null && body.version !== 1) throw invalid('version', body.version, 'Unsupported saved-view version.');
  const fields = source.fields.filter(f => !['structure', 'group', 'repeat'].includes(f.type) && !f.repeated);
  let definition;
  let chart;
  try {
    definition = normalizeDefinition({ columns: body?.columns || fields.slice(0, 100).map(f => f.path), query: body?.query || [] }, fields);
    chart = body?.chart == null ? null : normalizeWidget({ title: 'Analysis', ...body.chart }, fields.filter(f => definition.columns.includes(f.path)));
  } catch (e) {
    if (e.field != null) throw invalid(e.field, e.value, e.message);
    throw e;
  }
  const geometry = body?.geometry || null;
  if (geometry && !definition.columns.includes(geometry)) throw invalid('geometry', geometry, 'Choose a visible field.');
  const tab = body?.tab || 'table';
  if (!['table', 'chart', 'map'].includes(tab)) throw invalid('tab', tab, 'Choose table, chart or map.');
  return { version: 1, source: body.source, columns: definition.columns, query: definition.query, chart, geometry, tab };
};
const sourceRowsSql = (source) => {
  const visible = source.fields.map(f => f.path);
  const forms = source.kind === 'filtered'
    ? [{ formId: source.dataset.formId, xmlFormId: source.dataset.xmlFormId }] : source.forms;
  const paths = source.kind === 'filtered' ? [...new Set([...visible, ...source.definition.query.map(f => f.column)])] : visible;
  const delegatedFilter = source.kind === 'filtered'
    ? compileFilter(source.definition.query, source.definition.fieldByPath) : sql`true`;
  if (forms.length === 0) return sql`select null::text as "instanceId", null::timestamptz as "submittedAt", null::text as "sourceForm", '{}'::jsonb as extracted where false`;
  return sql.join(forms.map(form => sql`
    select "instanceId", "submittedAt", "sourceForm", ${projectObject(visible)} as extracted
    from (
      select s."instanceId", s."createdAt" as "submittedAt", ${form.xmlFormId}::text as "sourceForm",
        ${extractObject(paths)} as extracted
      from submissions s join submission_defs sd on sd."submissionId"=s.id and sd.current=true
      where s."formId"=${form.formId} and s."deletedAt" is null and s.draft=false
        and xml_is_well_formed_document(sd.xml)
    ) as source where ${delegatedFilter}`), sql` union all `);
};
const scopedRowsSql = (source, definition) => {
  const normalized = normalizeDefinition(definition, source.fields);
  return sql`select * from (${sourceRowsSql(source)}) as permitted
    where ${compileFilter(normalized.query, normalized.fieldByPath)}`;
};
const analysisRows = (db, source, definition, limit, offset = 0) => db.any(sql`
  select "instanceId", "submittedAt", "sourceForm", ${projectObject(definition.columns)} as data
  from (${scopedRowsSql(source, definition)}) as selected
  order by "submittedAt" desc, "instanceId", "sourceForm" limit ${limit} offset ${offset}`);
const analysisSummary = async (db, source, definition) => {
  const base = scopedRowsSql(source, definition);
  const total = await db.oneFirst(sql`select count(*)::integer from (${base}) as selected`);
  if (!definition.chart) return { total, chart: null };
  const c = definition.chart;
  const key = c.groupBy || c.column;
  const number = sql`case when (extracted ->> ${c.column}::text) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$'
    then (extracted ->> ${c.column}::text)::numeric end`;
  const numeric = c.aggregation !== 'count';
  const answered = await db.oneFirst(sql`select count(*)::integer from (${base}) as selected
    where ${numeric ? sql`${number} is not null` : sql`nullif(btrim(extracted ->> ${c.column}::text), '') is not null`}`);
  const grouped = await db.any(sql`select btrim(extracted ->> ${key}::text) as key,
    count(*)::integer as count,
    ${c.aggregation === 'count' ? sql`count(*)::numeric` : c.aggregation === 'sum' ? sql`sum(${number})`
    : c.aggregation === 'mean' ? sql`avg(${number})` : sql`percentile_cont(0.5) within group (order by ${number})`} as value
    from (${base}) as selected where nullif(btrim(extracted ->> ${key}::text), '') is not null
      and ${numeric ? sql`${number} is not null` : sql`true`}
    group by 1 order by 3 desc, 1 limit 1001`);
  if (grouped.length > 1000) return { total, chart: { coverage: { total, answered }, rows: [], unavailable: 'Too many categories. Add a filter.' } };
  // Means and medians must never be summed into a misleading Other bucket.
  const rows = grouped.map(r => ({ ...r, value: Number(r.value) }));
  return { total, chart: { coverage: { total, answered }, ...(numeric && !['sum'].includes(c.aggregation)
    ? { rows: rows.slice(0, MAX_BARS), omitted: rows.length > MAX_BARS ? { categories: rows.length - MAX_BARS } : null }
    : capRows(rows, MAX_BARS)) } };
};
const mapFeatures = (rows, geometry) => ({ type: 'FeatureCollection', features: rows.flatMap(row => {
  const p = parseGeopoint(row.data?.[geometry]);
  return p == null ? [] : [{ type: 'Feature', geometry: { type: 'Point', coordinates: [p.longitude, p.latitude] },
    properties: { instanceId: row.instanceId, sourceForm: row.sourceForm } }];
}) });
module.exports = { invalid, sourceSpec, authorizeSource, normalizeAnalysis, sourceRowsSql, scopedRowsSql, analysisRows, analysisSummary, mapFeatures };
