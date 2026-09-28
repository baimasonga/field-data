// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
//
// Resolve the three report sources into one honest shape: visible fields and
// rows. Filtered datasets fail closed if a saved filter no longer exists;
// merged datasets recompute their common fields whenever a report runs.

const { sql } = require('slonik');
const { resolveStoredDefinition, compileFilter, extractObject,
  projectObject } = require('./filtered-datasets');
const { mergeFields } = require('./merged-datasets');
const { MAX_REPORT_ROWS } = require('./xls-reports');

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const coerceData = (data, fields) => Object.fromEntries(fields.map((field) => {
  const value = data?.[field.path];
  if (value == null || value === '') return [field.path, value ?? ''];
  if ((field.type === 'int' || field.type === 'decimal') && NUMBER.test(value))
    return [field.path, Number(value)];
  if (field.type === 'date' || field.type === 'dateTime') {
    const date = new Date(value);
    if (!Number.isNaN(date.valueOf())) return [field.path, date];
  }
  return [field.path, value];
}));

const fieldsForForm = (db, formId, currentDefId) => db.any(sql`
  select ff.path, ff.name, ff.type, ff.binary, ff."selectMultiple", ff."order"
  from form_fields ff
  join form_defs fd on fd.id=${currentDefId} and fd."schemaId"=ff."schemaId"
  where ff."formId"=${formId}
    and coalesce(ff.binary, false)=false
    and ff.path ~ '^(/[A-Za-z_][A-Za-z0-9_.-]*)+$'
  order by ff."order", ff.path`);

const formSource = async (db, formId, projectId) => {
  const form = await db.maybeOne(sql`
    select f.id as "formId", f."xmlFormId", f."currentDefId",
      coalesce(fd.name, f."xmlFormId") as name
    from forms f
    left join form_defs fd on fd.id=f."currentDefId"
    where f.id=${formId} and f."projectId"=${projectId}
      and f."deletedAt" is null and f."currentDefId" is not null`);
  if (form == null) return null;
  return { kind: 'form', name: form.name, forms: [form],
    fields: await fieldsForForm(db, form.formId, form.currentDefId) };
};

const filteredSource = async (db, datasetId, projectId) => {
  const dataset = await db.maybeOne(sql`
    select d.*, f."xmlFormId", f."currentDefId",
      coalesce(d.name, f."xmlFormId") as "sourceName"
    from field_data_filtered_datasets d
    join forms f on f.id=d."formId" and f."deletedAt" is null
    where d.id=${datasetId} and d."projectId"=${projectId}`);
  if (dataset == null) return null;
  const fields = await fieldsForForm(db, dataset.formId, dataset.currentDefId);
  const definition = resolveStoredDefinition(dataset, fields);
  return {
    kind: 'filtered',
    name: dataset.sourceName,
    dataset,
    definition,
    fields: definition.columns.map(path => definition.fieldByPath.get(path))
  };
};

const mergedSource = async (db, datasetId, projectId) => {
  const dataset = await db.maybeOne(sql`
    select * from field_data_merged_datasets where id=${datasetId} and "projectId"=${projectId}`);
  if (dataset == null) return null;
  const forms = await db.any(sql`
    select f.id as "formId", f."xmlFormId", f."currentDefId"
    from field_data_merged_dataset_forms mf
    join forms f on f.id=mf."formId" and f."deletedAt" is null
    where mf."mergedDatasetId"=${dataset.id}
    order by f."xmlFormId"`);
  const withFields = await Promise.all(forms.map(async form => ({
    ...form,
    fields: await fieldsForForm(db, form.formId, form.currentDefId)
  })));
  const shape = mergeFields(withFields);
  return { kind: 'merged', name: dataset.name, dataset, forms: withFields,
    fields: shape.merged };
};

const resolveReportSource = async (db, template) => {
  if (template.formId != null) return formSource(db, template.formId, template.projectId);
  if (template.filteredDatasetId != null)
    return filteredSource(db, template.filteredDatasetId, template.projectId);
  if (template.mergedDatasetId != null)
    return mergedSource(db, template.mergedDatasetId, template.projectId);
  return null;
};

const ordinaryRows = async (db, formId, paths, extra = sql`true`) => {
  if (paths.length === 0) return [];
  return db.any(sql`
    with valid as (
      select s."instanceId", s."createdAt", ${extractObject(paths)} as extracted
      from submissions s
      join submission_defs sd on sd."submissionId"=s.id and sd.current=true
      where s."formId"=${formId} and s."deletedAt" is null and s.draft=false
        and xml_is_well_formed_document(sd.xml)
    )
    select "instanceId", "createdAt" as "submittedAt", extracted
    from valid where ${extra}
    order by "createdAt", "instanceId"
    limit ${MAX_REPORT_ROWS + 1}`);
};

const rowsForSource = async (db, source) => {
  if (source.kind === 'form') {
    const rows = await ordinaryRows(db, source.forms[0].formId,
      source.fields.map(field => field.path));
    return rows.map(row => ({ instanceId: row.instanceId, submittedAt: row.submittedAt,
      sourceForm: source.forms[0].xmlFormId, data: coerceData(row.extracted, source.fields) }));
  }

  if (source.kind === 'filtered') {
    if (!source.definition.usable) {
      throw new Error('The filtered dataset is no longer usable because its Form fields changed.');
    }
    const paths = [...new Set([
      ...source.definition.columns,
      ...source.definition.query.map(filter => filter.column)
    ])];
    const filter = compileFilter(source.definition.query, source.definition.fieldByPath);
    const rows = await ordinaryRows(db, source.dataset.formId, paths, filter);
    return rows.map(row => ({ instanceId: row.instanceId, submittedAt: row.submittedAt,
      sourceForm: source.dataset.xmlFormId,
      data: coerceData(row.extracted, source.fields) }));
  }

  if (source.fields.length === 0 || source.forms.length === 0) return [];
  const paths = source.fields.map(field => field.path);
  const union = sql.join(source.forms.map(form => sql`
    select ${form.xmlFormId} as "sourceForm", s."instanceId", s."createdAt",
      ${extractObject(paths)} as extracted
    from submissions s
    join submission_defs sd on sd."submissionId"=s.id and sd.current=true
    where s."formId"=${form.formId} and s."deletedAt" is null and s.draft=false
      and xml_is_well_formed_document(sd.xml)`), sql` union all `);
  const rows = await db.any(sql`
    select "sourceForm", "instanceId", "createdAt" as "submittedAt",
      ${projectObject(paths)} as data
    from (${union}) as merged
    order by "createdAt", "instanceId"
    limit ${MAX_REPORT_ROWS + 1}`);
  return rows.map(row => ({ sourceForm: row.sourceForm, instanceId: row.instanceId,
    submittedAt: row.submittedAt, data: coerceData(row.data, source.fields) }));
};

module.exports = { fieldsForForm, resolveReportSource, rowsForSource, _coerceData: coerceData };
