// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.
// This resource adds custom API support for Field Data platform dashboard metrics,
// media library uploads, webhooks, and backup history tracking.

const { sql } = require('slonik');
const config = require('config');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const http = require('http');
const https = require('https');
const { User, Project, Config, Form } = require('../model/frames');
const Problem = require('../util/problem');
const { postgresErrorToProblem } = require('../util/db');
const { getOrNotFound, reject } = require('../util/promise');
const { success, contentDisposition } = require('../util/http');
const { webhookEvents } = require('../worker/webhooks');
const { storage, formatBytes } = require('../external/field-data-storage');
const { resolveWebhookUrl } = require('../util/safe-webhook-url');
const { encryptSecret } = require('../util/field-data-secret');
const { parseGeopoint, checkImplausibleTravel, IMPLAUSIBLE_TRAVEL } = require('../util/fieldwork-integrity');
const { normalizeDefinition, resolveStoredDefinition, compileFilter, extractObject, projectObject } = require('../util/filtered-datasets');
const { normalizeWidget, capRows, tooManyDistinct, MAX_BARS } = require('../util/widgets');

const pingUrl = (urlStr) => new Promise((resolve) => {
  try {
    const parsed = new URL(urlStr);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(urlStr, { timeout: 1500 }, (res) => {
      resolve(res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  } catch (err) {
    resolve(false);
  }
});

const uploadLimit = Number.parseInt(process.env.FIELD_DATA_UPLOAD_MAX_BYTES || '', 10) || 25 * 1024 * 1024;
const allowedMediaTypes = new Map([
  ['image/png', 'image'],
  ['image/jpeg', 'image'],
  ['image/gif', 'image'],
  ['image/svg+xml', 'image'],
  ['video/mp4', 'video'],
  ['video/quicktime', 'video'],
  ['audio/mpeg', 'audio'],
  ['audio/wav', 'audio'],
  ['audio/ogg', 'audio'],
  ['audio/mp4', 'audio'],
  ['application/pdf', 'document']
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: uploadLimit, files: 1, fields: 5 }
});
const uploadErrorHandler = (error, request, response, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    next(Problem.user.requestTooLarge());
  } else if (error instanceof multer.MulterError) {
    next(Problem.user.multipartParsingFailed(error.message));
  } else {
    next(error);
  }
};

const publicWebhook = ({ secret, ...webhook }) => ({ ...webhook, hasSecret: Boolean(secret) });
const validWebhookUrl = async (url) => {
  try {
    await resolveWebhookUrl(url);
    return url;
  } catch (error) {
    return reject(Problem.user.unexpectedValue({
      field: 'url',
      value: url,
      reason: error.message
    }));
  }
};

const validateEvents = (events) => {
  if (!Array.isArray(events) || events.some(event => !webhookEvents.includes(event))) {
    throw Problem.user.unexpectedValue({ field: 'events', value: events,
      reason: 'must be an array of supported webhook event names' });
  }
  return [...new Set(events)];
};

// The whole of a form's summary, counted in the database. Lives here rather
// than inside the route because a shared dashboard serves exactly the same
// numbers to somebody who has no account, and two copies of this would drift.
const summarizeForm = async (db, formId) => {
  const live = sql`
    from submissions s
    where s."formId" = ${formId} and s."deletedAt" is null and s.draft = false`;

  const totals = await db.one(sql`
    select count(*)::integer as submissions,
           count(distinct s."submitterId")::integer as submitters,
           min(s."createdAt") as "firstSubmission",
           max(s."createdAt") as "lastSubmission"
    ${live}`);

  if (totals.submissions === 0)
    return { ...totals, overTime: [], reviewStates: [], fields: [], truncated: false };

  // One row per day the form was in use. Days with no submissions are the
  // client's to fill in, because only it knows the reader's time zone.
  const overTime = await db.any(sql`
    select (s."createdAt" at time zone 'UTC')::date as date, count(*)::integer as count
    ${live}
    group by 1 order by 1`);

  // Null is what ODK stores for a submission nobody has reviewed. It is a
  // state like any other to a reader, so it gets named rather than dropped.
  const reviewStates = await db.any(sql`
    select coalesce(s."reviewState", 'received') as state, count(*)::integer as count
    ${live}
    group by 1 order by 2 desc`);

  // The paths come from uploaded forms, so they are somebody's input, and
  // they are about to be concatenated into an XPath expression. Only a plain
  // slash-separated path of ordinary name characters is allowed through;
  // anything else is skipped rather than escaped, because a form field whose
  // name needs escaping is not one worth charting.
  // Postgres has no try-cast, so one submission whose body will not parse as
  // XML takes the whole query down with it. The counts above do not depend
  // on it, so a failure here costs the answer charts and nothing else.
  const answers = await db.any(sql`
    with candidate as (
      select distinct on (ff.path) ff.path, ff.name, ff.type, ff."order"
      from form_fields ff
      where ff."formId" = ${formId}
        and ff.type in ('string', 'int', 'decimal', 'date', 'time', 'dateTime')
        and coalesce(ff.binary, false) = false
        and ff.path ~ '^(/[A-Za-z_][A-Za-z0-9_.-]*)+$'
      order by ff.path, ff."order" desc
    ),
    current_defs as (
      -- The current version of a submission is the submission_defs row flagged
      -- current; submissions has no currentDefId column.
      select sd.id, sd.xml
      from submissions s
      join submission_defs sd on sd."submissionId" = s.id and sd.current = true
      where s."formId" = ${formId} and s."deletedAt" is null and s.draft = false
    ),
    answered as (
      select c.path, c.name, c.type, c."order",
             btrim((xpath('/*' || c.path || '/text()', d.xml::xml))[1]::text) as value
      from current_defs d cross join candidate c
    )
    select path, name, type, "order", value, count(*)::integer as count
    from answered
    where value is not null and value <> ''
    group by path, name, type, "order", value
    order by "order", count(*) desc`).catch(() => []);

  // A field is worth a chart when its answers repeat. A name, a note or a
  // free-text comment has about as many distinct answers as submissions and
  // makes a chart of one-tall bars, so those are left out. The cutoffs are
  // the series-count ladder: past eight bars a chart stops being readable,
  // so the tail becomes one "Other" bar rather than more bars.
  const MAX_DISTINCT = 25;
  const MAX_BARS = 8;
  const MAX_FIELDS = 12;

  const byPath = new Map();
  for (const row of answers) {
    if (!byPath.has(row.path))
      byPath.set(row.path, { path: row.path, name: row.name, type: row.type, values: [] });
    byPath.get(row.path).values.push({ value: row.value, count: row.count });
  }

  const fields = [];
  for (const field of byPath.values()) {
    const distinct = field.values.length;
    const answered = field.values.reduce((sum, v) => sum + v.count, 0);
    // Every answer different means free text, not a category.
    if (distinct > MAX_DISTINCT || distinct === answered) continue;
    if (distinct < 2) continue;
    const top = field.values.slice(0, MAX_BARS);
    const tail = field.values.slice(MAX_BARS);
    if (tail.length > 0)
      top.push({ value: null, other: tail.length, count: tail.reduce((sum, v) => sum + v.count, 0) });
    fields.push({ ...field, values: top, distinct, answered });
    if (fields.length === MAX_FIELDS) break;
  }

  return { ...totals, overTime, reviewStates, fields, truncated: byPath.size > fields.length };
};

const normalizeWidgetOrProblem = (body, fields) => {
  try {
    return normalizeWidget(body, fields);
  } catch (error) {
    if (error.field != null) {
      throw Problem.user.unexpectedValue({
        field: error.field, value: error.value, reason: error.reason
      });
    }
    throw error;
  }
};

const normalizeFilteredDataset = (body, fields) => {
  try {
    return normalizeDefinition(body, fields);
  } catch (error) {
    if (error.field != null) {
      throw Problem.user.unexpectedValue({
        field: error.field, value: error.value, reason: error.reason
      });
    }
    throw error;
  }
};

const filteredDatasetName = (body) => {
  const name = String(body?.name ?? '').trim().slice(0, 255);
  if (name === '') throw Problem.user.missingParameter({ field: 'name' });
  return name;
};

const filteredDatasetFields = (db, form) => db.any(sql`
  select ff.path, ff.name, ff.type, ff.binary, ff."order"
  from form_fields ff
  join form_defs fd on fd.id = ${form.currentDefId} and fd."schemaId" = ff."schemaId"
  where ff."formId" = ${form.id}
    and coalesce(ff.binary, false) = false
    and ff.path ~ '^(/[A-Za-z_][A-Za-z0-9_.-]*)+$'
  order by ff."order", ff.path`);

const filteredDatasetRecord = (db, projectId, id) => db.maybeOne(sql`
  select d.*, f."xmlFormId", f."projectId" as "sourceProjectId", f."currentDefId"
  from field_data_filtered_datasets d
  join forms f on f.id = d."formId" and f."deletedAt" is null
  where d.id = ${id} and d."projectId" = ${projectId}`);

// A row filter may use a field that is not one of the dataset's visible
// columns. Destination readers can use the subset, but the filter definition
// itself is editor-only because even its field names can disclose source data.
const publicFilteredDataset = ({ query, ...dataset }) => ({
  ...dataset, filterCount: Array.isArray(query) ? query.length : 0
});

const filteredDatasetStats = async (db, formId, normalized) => {
  const paths = [...new Set([
    ...normalized.columns,
    ...normalized.query.map(filter => filter.column)
  ])];
  const filter = compileFilter(normalized.query, normalized.fieldByPath);
  const totals = await db.one(sql`
    select count(*)::integer as total,
      count(*) filter (where xml_is_well_formed_document(sd.xml))::integer as valid
    from submissions s
    join submission_defs sd on sd."submissionId" = s.id and sd.current = true
    where s."formId" = ${formId} and s."deletedAt" is null and s.draft = false`);
  const matching = totals.valid === 0 ? 0 : await db.oneFirst(sql`
    with valid as (
      select ${extractObject(paths)} as extracted
      from submissions s
      join submission_defs sd on sd."submissionId" = s.id and sd.current = true
      where s."formId" = ${formId} and s."deletedAt" is null and s.draft = false
        and xml_is_well_formed_document(sd.xml)
    )
    select count(*)::integer from valid where ${filter}`);
  return { total: totals.total, matching, excludedMalformed: totals.total - totals.valid };
};

const filteredDatasetData = async (db, dataset, normalized, limit, offset) => {
  const paths = [...new Set([
    ...normalized.columns,
    ...normalized.query.map(filter => filter.column)
  ])];
  const filter = compileFilter(normalized.query, normalized.fieldByPath);
  const rows = await db.any(sql`
    with valid as (
      select s."createdAt", ${extractObject(paths)} as extracted
      from submissions s
      join submission_defs sd on sd."submissionId" = s.id and sd.current = true
      where s."formId" = ${dataset.formId} and s."deletedAt" is null and s.draft = false
        and xml_is_well_formed_document(sd.xml)
    )
    select ${projectObject(normalized.columns)} as data
    from valid where ${filter}
    order by "createdAt" desc
    limit ${limit} offset ${offset}`);
  return rows.map(row => row.data);
};


////////////////////////////////////////////////////////////////////////////////
// SAVED CHART WIDGETS
//
// A widget is a chart somebody kept: a title they chose, a field, an
// aggregation and a place in an order. It hangs off a form, or off a filtered
// dataset -- and when it is the latter it may only read that dataset's visible
// columns and only sees that dataset's rows, because a chart is as good a way
// to leak a hidden field as a table is.

// Only a number that looks like a number is cast. Postgres has no try-cast, so
// one submission where somebody typed "four" would otherwise take the whole
// chart down.
const WIDGET_NUMERIC = '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$';

// The rows a widget draws from: current submission versions whose XML parses,
// narrowed by the parent's filter when the parent is a filtered dataset.
const widgetRows = (formId, paths) => sql`
  select ${extractObject(paths)} as extracted
  from submissions s
  join submission_defs sd on sd."submissionId" = s.id and sd.current = true
  where s."formId" = ${formId} and s."deletedAt" is null and s.draft = false
    and xml_is_well_formed_document(sd.xml)`;

const widgetData = async (db, formId, normalized, filter) => {
  const paths = [...new Set([normalized.column, normalized.groupBy].filter(p => p != null))];
  const base = widgetRows(formId, paths);
  const scoped = filter == null
    ? sql`with rows as (${base}) select * from rows`
    : sql`with rows as (${base}) select * from rows where ${filter}`;

  // How much the answer rests on, gathered before the answer itself so a
  // reader is never shown a mean without its denominator.
  const key = normalized.groupBy ?? normalized.column;
  const value = normalized.column;
  const coverage = await db.one(sql`
    with rows as (${scoped})
    select count(*)::integer as total,
      count(*) filter (where nullif(btrim(extracted ->> ${key}), '') is not null)::integer as grouped,
      count(*) filter (where nullif(btrim(extracted ->> ${value}), '') is not null)::integer as answered
    from rows`);

  if (coverage.total === 0)
    return { rows: [], omitted: null, coverage, distinct: 0 };

  const grouped = normalized.aggregation === 'count'
    ? await db.any(sql`
        with rows as (${scoped})
        select btrim(extracted ->> ${key}) as key, count(*)::integer as count
        from rows
        where nullif(btrim(extracted ->> ${key}), '') is not null
        group by 1 order by count(*) desc, 1`)
    : await db.any(sql`
        with rows as (${scoped}),
        numbers as (
          select btrim(extracted ->> ${key}) as key,
            case when btrim(extracted ->> ${value}) ~ ${WIDGET_NUMERIC}
              then (btrim(extracted ->> ${value}))::numeric end as value
          from rows
          where nullif(btrim(extracted ->> ${key}), '') is not null
        )
        select key, count(value)::integer as count,
          ${normalized.aggregation === 'sum' ? sql`sum(value)`
    : normalized.aggregation === 'mean' ? sql`avg(value)`
      : sql`percentile_cont(0.5) within group (order by value)`}::numeric as value
        from numbers
        where value is not null
        group by key
        order by 3 desc, 1`);

  const capped = capRows(grouped.map(row => ({
    key: row.key,
    count: row.count,
    value: row.value == null ? null : Number(row.value)
  })), MAX_BARS);

  return { ...capped, coverage, distinct: grouped.length };
};

module.exports = (service, endpoint) => {
  // The field_data_* tables backing these resources are created by the
  // 20260707-01-add-field-data-tables migration.

  ////////////////////////////////////////////////////////////////////////////////
  // FORM SUMMARY
  //
  // Everything the summary charts plot, counted in the database. The client
  // could total up the OData feed instead, but then the summary would describe
  // whatever it managed to download rather than the form, and would say so
  // only by being quietly wrong on the forms where it matters most.
  service.get('/projects/:projectId/forms/:xmlFormId/summary', endpoint(async (container, { params, auth }) => {
    const form = await container.Forms
      .getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.PublishedVersion)
      .then(getOrNotFound);
    await auth.canOrReject('submission.list', form);
    await auth.canOrReject('submission.read', form);
    return summarizeForm(container.db, form.id);
  }));

  ////////////////////////////////////////////////////////////////////////////////
  // FILTERED DATASETS
  //
  // A filtered dataset exposes selected answer paths and matching rows from a
  // source form through a destination project. Editors must be able to change
  // the source form; readers need rights only on the destination project. The
  // data route deliberately performs no source-form permission fallback.

  service.get('/projects/:projectId/forms/:xmlFormId/filter-fields', endpoint(async (container, { params, auth }) => {
    const form = await container.Forms
      .getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.PublishedVersion)
      .then(getOrNotFound);
    await auth.canOrReject('submission.list', form);
    await auth.canOrReject('submission.read', form);
    return filteredDatasetFields(container.db, form);
  }));

  service.post('/projects/:projectId/forms/:xmlFormId/filtered-datasets/preview', endpoint(async (container, { params, body, auth }) => {
    const form = await container.Forms
      .getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.PublishedVersion)
      .then(getOrNotFound);
    await auth.canOrReject('form.update', form);
    const fields = await filteredDatasetFields(container.db, form);
    const normalized = normalizeFilteredDataset(body, fields);
    const stats = await filteredDatasetStats(container.db, form.id, normalized);
    return { ...stats, fields: normalized.columns.length, availableFields: fields.length };
  }));

  service.post('/projects/:projectId/filtered-datasets', endpoint(async (container, { params, body, auth }) => {
    const project = await container.Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('project.update', project);
    const sourceProjectId = Number.parseInt(body?.sourceProjectId ?? params.projectId, 10);
    const form = await container.Forms
      .getByProjectAndXmlFormId(sourceProjectId, body?.xmlFormId, Form.PublishedVersion)
      .then(getOrNotFound);
    await auth.canOrReject('form.update', form);
    const fields = await filteredDatasetFields(container.db, form);
    const normalized = normalizeFilteredDataset(body, fields);
    const name = filteredDatasetName(body);
    const created = await container.db.one(sql`
      insert into field_data_filtered_datasets
        (name, "projectId", "formId", columns, query, "createdBy")
      values (${name}, ${project.id}, ${form.id}, ${JSON.stringify(normalized.columns)},
        ${JSON.stringify(normalized.query)}, ${auth.actor.map(actor => actor.id).orNull()})
      returning *`).catch(postgresErrorToProblem);
    const stats = await filteredDatasetStats(container.db, form.id, normalized);
    return { ...created, xmlFormId: form.xmlFormId, sourceProjectId: form.projectId, stats };
  }));

  service.get('/projects/:projectId/filtered-datasets', endpoint(async (container, { params, query, auth }) => {
    const project = await container.Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('project.read', project);
    await auth.canOrReject('submission.list', project);
    await auth.canOrReject('submission.read', project);
    const sourceProjectId = Number.parseInt(query.sourceProjectId, 10);
    const rows = await container.db.any(sql`
      select d.id, d.name, d."projectId", d."formId", d.columns,
        jsonb_array_length(d.query) as "filterCount", d."createdAt", d."updatedAt",
        f."xmlFormId", f."projectId" as "sourceProjectId"
      from field_data_filtered_datasets d
      join forms f on f.id = d."formId" and f."deletedAt" is null
      where d."projectId" = ${project.id}
        and (${query.xmlFormId ?? null}::text is null or f."xmlFormId" = ${query.xmlFormId ?? null})
        and (${Number.isFinite(sourceProjectId) ? sourceProjectId : null}::integer is null
          or f."projectId" = ${Number.isFinite(sourceProjectId) ? sourceProjectId : null})
      order by d."createdAt" desc`);
    return rows;
  }));

  service.get('/projects/:projectId/filtered-datasets/:id', endpoint(async (container, { params, auth }) => {
    const id = Number.parseInt(params.id, 10);
    if (!Number.isInteger(id)) return reject(Problem.user.notFound());
    const project = await container.Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('project.read', project);
    await auth.canOrReject('submission.list', project);
    await auth.canOrReject('submission.read', project);
    const dataset = await filteredDatasetRecord(container.db, project.id, id).then(getOrNotFound);
    return publicFilteredDataset(dataset);
  }));

  service.get('/projects/:projectId/filtered-datasets/:id/definition', endpoint(async (container, { params, auth }) => {
    const id = Number.parseInt(params.id, 10);
    if (!Number.isInteger(id)) return reject(Problem.user.notFound());
    const project = await container.Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('project.update', project);
    const dataset = await filteredDatasetRecord(container.db, project.id, id).then(getOrNotFound);
    const form = await container.Forms
      .getByProjectAndXmlFormId(dataset.sourceProjectId, dataset.xmlFormId, Form.PublishedVersion)
      .then(getOrNotFound);
    await auth.canOrReject('form.update', form);
    return dataset;
  }));

  service.patch('/projects/:projectId/filtered-datasets/:id', endpoint(async (container, { params, body, auth }) => {
    const id = Number.parseInt(params.id, 10);
    if (!Number.isInteger(id)) return reject(Problem.user.notFound());
    const project = await container.Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('project.update', project);
    const dataset = await filteredDatasetRecord(container.db, project.id, id).then(getOrNotFound);
    const form = await container.Forms
      .getByProjectAndXmlFormId(dataset.sourceProjectId, dataset.xmlFormId, Form.PublishedVersion)
      .then(getOrNotFound);
    await auth.canOrReject('form.update', form);
    const fields = await filteredDatasetFields(container.db, form);
    const normalized = normalizeFilteredDataset({
      columns: body?.columns ?? dataset.columns,
      query: body?.query ?? dataset.query
    }, fields);
    const name = body?.name == null ? dataset.name : filteredDatasetName(body);
    const updated = await container.db.one(sql`
      update field_data_filtered_datasets
      set name = ${name}, columns = ${JSON.stringify(normalized.columns)},
        query = ${JSON.stringify(normalized.query)}, "updatedAt" = clock_timestamp()
      where id = ${dataset.id}
      returning *`).catch(postgresErrorToProblem);
    const stats = await filteredDatasetStats(container.db, form.id, normalized);
    return { ...updated, xmlFormId: form.xmlFormId, sourceProjectId: form.projectId, stats };
  }));

  service.delete('/projects/:projectId/filtered-datasets/:id', endpoint(async (container, { params, auth }) => {
    const id = Number.parseInt(params.id, 10);
    if (!Number.isInteger(id)) return reject(Problem.user.notFound());
    const project = await container.Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('project.update', project);
    const dataset = await filteredDatasetRecord(container.db, project.id, id).then(getOrNotFound);
    const form = await container.Forms
      .getByProjectAndXmlFormId(dataset.sourceProjectId, dataset.xmlFormId, Form.PublishedVersion)
      .then(getOrNotFound);
    await auth.canOrReject('form.update', form);
    await container.db.query(sql`delete from field_data_filtered_datasets where id = ${dataset.id}`);
    return success();
  }));

  service.get('/projects/:projectId/filtered-datasets/:id/data', endpoint(async (container, { params, query, auth }) => {
    const id = Number.parseInt(params.id, 10);
    if (!Number.isInteger(id)) return reject(Problem.user.notFound());
    const project = await container.Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('project.read', project);
    await auth.canOrReject('submission.list', project);
    await auth.canOrReject('submission.read', project);
    const dataset = await filteredDatasetRecord(container.db, project.id, id).then(getOrNotFound);
    const formShape = { id: dataset.formId, currentDefId: dataset.currentDefId };
    const fields = await filteredDatasetFields(container.db, formShape);
    const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 50, 1), 200);
    const offset = Math.max(Number.parseInt(query.offset, 10) || 0, 0);

    // The reader's path resolves rather than validates. A republished form can
    // drop a field this dataset was built on, and the reader can neither fix
    // that nor read a message written for the person who can.
    const resolved = resolveStoredDefinition(dataset, fields);
    const stale = {
      missingColumns: resolved.missingColumns,
      missingFilters: resolved.missingFilters
    };
    if (!resolved.usable) {
      // A filter we can no longer apply was holding the row set narrow, so
      // serving the rows without it would disclose what the dataset hid.
      return { total: 0, limit, offset, excludedMalformed: 0,
        columns: resolved.columns, data: [], usable: false, ...stale };
    }

    const normalized = normalizeFilteredDataset(
      { columns: resolved.columns, query: resolved.query }, fields
    );
    const stats = await filteredDatasetStats(container.db, dataset.formId, normalized);
    const data = stats.matching === 0 ? [] : await filteredDatasetData(
      container.db, dataset, normalized, limit, offset
    );
    return { total: stats.matching, limit, offset, excludedMalformed: stats.excludedMalformed,
      columns: normalized.columns, data, usable: true, ...stale };
  }));


  ////////////////////////////////////////////////////////////////////////////////
  // SAVED CHART WIDGETS

  // What a widget is allowed to read depends on its parent. A form widget sees
  // every chartable field; a filtered-dataset widget sees only that dataset's
  // visible columns and only its rows. Resolving that here, once, is what keeps
  // the restriction from being something each route remembers separately.
  const widgetParent = async (container, projectId, body, auth, { write }) => {
    const datasetId = body?.filteredDatasetId == null
      ? null
      : Number.parseInt(body.filteredDatasetId, 10);

    if (datasetId != null) {
      if (!Number.isInteger(datasetId)) return reject(Problem.user.notFound());
      const project = await container.Projects.getById(projectId).then(getOrNotFound);
      await auth.canOrReject(write ? 'project.update' : 'project.read', project);
      if (!write) {
        await auth.canOrReject('submission.list', project);
        await auth.canOrReject('submission.read', project);
      }
      const dataset = await filteredDatasetRecord(container.db, project.id, datasetId)
        .then(getOrNotFound);
      const all = await filteredDatasetFields(container.db,
        { id: dataset.formId, currentDefId: dataset.currentDefId });
      const resolved = resolveStoredDefinition(dataset, all);
      // Only the dataset's surviving visible columns, so a widget can never be
      // built on -- or keep drawing -- a field the dataset hides.
      const visible = new Set(resolved.columns);
      return {
        kind: 'dataset',
        formId: dataset.formId,
        datasetId: dataset.id,
        fields: all.filter(field => visible.has(field.path)),
        filter: resolved.usable
          ? compileFilter(normalizeDefinition(
            { columns: resolved.columns, query: resolved.query }, all
          ).query, new Map(all.map(f => [f.path, f])))
          : null,
        usable: resolved.usable,
        missingFilters: resolved.missingFilters
      };
    }

    const form = await container.Forms
      .getByProjectAndXmlFormId(projectId, body?.xmlFormId, Form.PublishedVersion)
      .then(getOrNotFound);
    if (write) await auth.canOrReject('form.update', form);
    else {
      await auth.canOrReject('submission.list', form);
      await auth.canOrReject('submission.read', form);
    }
    return {
      kind: 'form',
      formId: form.id,
      datasetId: null,
      fields: await filteredDatasetFields(container.db, form),
      filter: null,
      usable: true,
      missingFilters: []
    };
  };

  const parentWhere = (parent) => (parent.datasetId == null
    ? sql`"formId" = ${parent.formId}`
    : sql`"filteredDatasetId" = ${parent.datasetId}`);

  // Order is contiguous from zero within a parent. Renumbering on every write
  // costs a few lines here and saves every later reordering feature from
  // coping with gaps.
  const renumber = (db, parent) => db.query(sql`
    with ordered as (
      select id, row_number() over (order by "order", id) - 1 as position
      from field_data_widgets where ${parentWhere(parent)}
    )
    update field_data_widgets w set "order" = ordered.position
    from ordered where ordered.id = w.id and w."order" <> ordered.position`);

  service.post('/projects/:projectId/widgets', endpoint(async (container, { params, body, auth }) => {
    const parent = await widgetParent(container, params.projectId, body, auth, { write: true });
    const normalized = normalizeWidgetOrProblem(body, parent.fields);
    const created = await container.db.one(sql`
      insert into field_data_widgets
        (title, description, "formId", "filteredDatasetId", column_path, "groupBy",
         aggregation, "viewType", "order", "createdBy")
      values (${normalized.title}, ${normalized.description},
        ${parent.datasetId == null ? parent.formId : null}, ${parent.datasetId},
        ${normalized.column}, ${normalized.groupBy}, ${normalized.aggregation},
        ${normalized.viewType},
        (select coalesce(max("order") + 1, 0) from field_data_widgets where ${parentWhere(parent)}),
        ${auth.actor.map(actor => actor.id).orNull()})
      returning *`).catch(postgresErrorToProblem);
    await renumber(container.db, parent);
    return created;
  }));

  service.get('/projects/:projectId/widgets', endpoint(async (container, { params, query, auth }) => {
    const parent = await widgetParent(container, params.projectId, query, auth, { write: false });
    const widgets = await container.db.any(sql`
      select * from field_data_widgets
      where ${parentWhere(parent)} order by "order", id`);

    if (query.data !== 'true') return widgets;

    // A dataset whose filter field the form no longer has serves no rows at
    // all, and its widgets must not quietly become charts of everything.
    if (!parent.usable) {
      return widgets.map(widget => ({
        ...widget, usable: false, missingFilters: parent.missingFilters
      }));
    }

    const byPath = new Map(parent.fields.map(field => [field.path, field]));
    return Promise.all(widgets.map(async (widget) => {
      // A form republished without this widget's field leaves the widget
      // readable but undrawable. Said, rather than thrown at the reader.
      const missing = [widget.column_path, widget.groupBy]
        .filter(path => path != null && !byPath.has(path));
      if (missing.length > 0)
        return { ...widget, usable: false, missingFields: missing };

      const normalized = {
        column: widget.column_path,
        groupBy: widget.groupBy,
        aggregation: widget.aggregation
      };
      const result = await widgetData(container.db, parent.formId, normalized, parent.filter);
      return {
        ...widget,
        usable: true,
        ...result,
        // Charting free text produces one bar per submission. Say so instead.
        tooManyCategories: tooManyDistinct(result.distinct)
      };
    }));
  }));

  service.patch('/projects/:projectId/widgets/order', endpoint(async (container, { params, body, auth }) => {
    const parent = await widgetParent(container, params.projectId, body, auth, { write: true });
    const ids = Array.isArray(body?.order) ? body.order.map(id => Number.parseInt(id, 10)) : null;
    if (ids == null || ids.some(id => !Number.isInteger(id)))
      return reject(Problem.user.unexpectedValue({
        field: 'order', value: body?.order, reason: 'must be an array of widget ids'
      }));

    // The whole order arrives at once. Patching each widget's position one at a
    // time races with itself and leaves two widgets sharing a place.
    const existing = await container.db.any(sql`
      select id from field_data_widgets where ${parentWhere(parent)}`);
    const known = new Set(existing.map(row => row.id));
    if (ids.length !== known.size || ids.some(id => !known.has(id)))
      return reject(Problem.user.unexpectedValue({
        field: 'order', value: body.order,
        reason: 'must list every widget of this chart set exactly once'
      }));

    for (const [position, id] of ids.entries()) {
      // eslint-disable-next-line no-await-in-loop
      await container.db.query(sql`
        update field_data_widgets set "order" = ${position}, "updatedAt" = clock_timestamp()
        where id = ${id}`);
    }
    return container.db.any(sql`
      select * from field_data_widgets where ${parentWhere(parent)} order by "order", id`);
  }));

  service.patch('/projects/:projectId/widgets/:id', endpoint(async (container, { params, body, auth }) => {
    const id = Number.parseInt(params.id, 10);
    if (!Number.isInteger(id)) return reject(Problem.user.notFound());
    const parent = await widgetParent(container, params.projectId, body, auth, { write: true });
    const existing = await container.db.maybeOne(sql`
      select * from field_data_widgets where id = ${id} and ${parentWhere(parent)}`)
      .then(getOrNotFound);
    const normalized = normalizeWidgetOrProblem({
      title: body?.title ?? existing.title,
      description: body?.description ?? existing.description,
      column: body?.column ?? existing.column_path,
      groupBy: body?.groupBy === undefined ? existing.groupBy : body.groupBy,
      aggregation: body?.aggregation ?? existing.aggregation,
      viewType: body?.viewType ?? existing.viewType
    }, parent.fields);
    return container.db.one(sql`
      update field_data_widgets
      set title = ${normalized.title}, description = ${normalized.description},
        column_path = ${normalized.column}, "groupBy" = ${normalized.groupBy},
        aggregation = ${normalized.aggregation}, "viewType" = ${normalized.viewType},
        "updatedAt" = clock_timestamp()
      where id = ${existing.id}
      returning *`).catch(postgresErrorToProblem);
  }));

  service.delete('/projects/:projectId/widgets/:id', endpoint(async (container, { params, query, auth }) => {
    const id = Number.parseInt(params.id, 10);
    if (!Number.isInteger(id)) return reject(Problem.user.notFound());
    const parent = await widgetParent(container, params.projectId, query, auth, { write: true });
    const removed = await container.db.maybeOne(sql`
      delete from field_data_widgets where id = ${id} and ${parentWhere(parent)} returning id`);
    if (removed == null) return reject(Problem.user.notFound());
    await renumber(container.db, parent);
    return success();
  }));

  ////////////////////////////////////////////////////////////////////////////////
  // FIELDWORK VERIFICATION
  //
  // Evidence about how submissions were collected, and explainable checks over
  // it. Nothing here decides anything: a check produces a finding for a person
  // to review, with what it saw and what would innocently explain it.
  //
  // What the evidence can and cannot say is part of the feature. A location
  // reading does not prove somebody was there, an accuracy figure is the
  // device's own claim, and a device identifier does not say who held it. The
  // responses carry those limits so the interface can show them.

  const evidenceFor = async (db, formId) => {
    // Device capture time comes from the audit log ODK Collect writes when a
    // form enables it. Server receipt time is when the upload arrived, which
    // for offline work can be days later and is never used as a capture time.
    const rows = await db.any(sql`
      with live as (
        -- A submission has no currentDefId column; the current version is the
        -- submission_defs row flagged current. Everything below joins through
        -- that def, so it is resolved once here.
        select s.id, s."instanceId", s."createdAt", s."submitterId",
               s."deviceId", s."reviewState", sd.id as "currentDefId"
        from submissions s
        join submission_defs sd on sd."submissionId" = s.id and sd.current = true
        where s."formId" = ${formId} and s."deletedAt" is null and s.draft = false
      ),
      device_time as (
        -- One row per submission: the first and last event the device logged.
        select l.id,
               min(nullif(ca.start, '')::timestamptz) as "deviceStart",
               max(nullif(ca."end", '')::timestamptz) as "deviceEnd",
               count(*)::integer as events
        from live l
        join submission_attachments sa
          on sa."submissionDefId" = l."currentDefId" and sa."isClientAudit" = true
        join client_audits ca on ca."blobId" = sa."blobId"
        group by l.id
      ),
      geopoint as (
        -- The first geopoint answer in the form. ODK writes these as
        -- "latitude longitude altitude accuracy".
        select l.id, btrim((xpath('/*' || ff.path || '/text()', sd.xml::xml))[1]::text) as value
        from live l
        join submission_defs sd on sd.id = l."currentDefId"
        join lateral (
          select path from form_fields
          where "formId" = ${formId} and type = 'geopoint'
            and path ~ '^(/[A-Za-z_][A-Za-z0-9_.-]*)+$'
          order by "order" limit 1
        ) ff on true
      ),
      attachments as (
        select l.id, count(*)::integer as files,
               count(b.sha)::integer as hashed
        from live l
        join submission_attachments sa on sa."submissionDefId" = l."currentDefId"
        left join blobs b on b.id = sa."blobId"
        where coalesce(sa."isClientAudit", false) = false
        group by l.id
      )
      select l."instanceId", l."createdAt" as "receivedAt", l."deviceId",
             l."reviewState",
             actors."displayName" as submitter, l."submitterId",
             d."deviceStart", d."deviceEnd", d.events as "deviceEvents",
             g.value as "geopoint",
             coalesce(a.files, 0) as "attachments",
             coalesce(a.hashed, 0) as "attachmentsHashed"
      from live l
      left join actors on actors.id = l."submitterId"
      left join device_time d on d.id = l.id
      left join geopoint g on g.id = l.id
      left join attachments a on a.id = l.id
      order by l."createdAt" desc`).catch(() => []);

    return rows.map((row) => {
      const location = parseGeopoint(row.geopoint);
      return {
        instanceId: row.instanceId,
        submitter: row.submitter,
        submitterId: row.submitterId,
        // A device identifier says which installation, not who held it.
        deviceId: row.deviceId,
        receivedAt: row.receivedAt,
        capturedAt: row.deviceStart ?? null,
        captureEndedAt: row.deviceEnd ?? null,
        captureTimeSource: row.deviceStart != null ? 'device-audit-log' : null,
        location,
        locationSource: location != null ? 'form-answer' : null,
        reviewState: row.reviewState ?? 'received',
        attachments: row.attachments,
        attachmentsHashed: row.attachmentsHashed,
        // Named rather than implied, so a reader can see what is missing and
        // an interface can say why a check could not run.
        missing: [
          row.deviceStart == null ? 'device-capture-time' : null,
          location == null ? 'location' : null
        ].filter((m) => m != null)
      };
    });
  };

  service.get('/projects/:projectId/forms/:xmlFormId/evidence', endpoint(async (container, { params, auth }) => {
    const form = await container.Forms
      .getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.PublishedVersion)
      .then(getOrNotFound);
    await auth.canOrReject('submission.list', form);
    await auth.canOrReject('submission.read', form);

    const evidence = await evidenceFor(container.db, form.id);
    return {
      submissions: evidence,
      // A summary of the evidence itself, so somebody can see at a glance
      // whether the checks below have anything to work with.
      coverage: {
        total: evidence.length,
        withCaptureTime: evidence.filter((e) => e.capturedAt != null).length,
        withLocation: evidence.filter((e) => e.location != null).length
      },
      limits: [
        'A location reading shows where a device believed it was, not that anybody was present.',
        'Reported accuracy is the device\'s own estimate and is not a guarantee.',
        'A device identifier identifies an installation, not a person.',
        'Device capture times come from the form\'s audit log and exist only where the form enables it.'
      ]
    };
  }));

  // Runs the checks and records what they found. Re-running is safe: a finding
  // is identified by its rule, version and the submissions it is about, so the
  // same observation updates in place and a reviewer's decision survives.
  service.post('/projects/:projectId/forms/:xmlFormId/integrity/run', endpoint(async (container, { params, auth }) => {
    const form = await container.Forms
      .getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.PublishedVersion)
      .then(getOrNotFound);
    await auth.canOrReject('submission.update', form);

    const evidence = await evidenceFor(container.db, form.id);

    // Travel is only meaningful within one collector's own sequence. Two
    // people working in two districts are not travelling between them.
    const byCollector = new Map();
    for (const row of evidence) {
      const key = row.submitterId ?? 'unknown';
      if (!byCollector.has(key)) byCollector.set(key, []);
      byCollector.get(key).push({
        instanceId: row.instanceId,
        capturedAt: row.capturedAt == null ? null : new Date(row.capturedAt),
        location: row.location,
        locationSource: row.locationSource,
        captureTimeSource: row.captureTimeSource
      });
    }

    const findings = [];
    for (const rows of byCollector.values())
      findings.push(...checkImplausibleTravel(rows));

    // Only what a person should see is stored. A plausible pair is the normal
    // case and recording every one of them would bury the rest.
    const worthKeeping = findings.filter((f) => f.outcome !== 'plausible');

    for (const finding of worthKeeping) {
      // eslint-disable-next-line no-await-in-loop
      await container.db.query(sql`
        insert into field_data_integrity_flags
          ("formId", rule, "ruleVersion", "instanceId", "relatedInstanceId", outcome, evidence)
        values (${form.id}, ${finding.rule}, ${finding.ruleVersion},
                ${finding.instanceId}, ${finding.relatedInstanceId},
                ${finding.outcome}, ${JSON.stringify(finding.evidence)})
        on conflict ("formId", rule, "ruleVersion", "instanceId", coalesce("relatedInstanceId", ''))
        -- The evidence is refreshed; the review is not touched.
        do update set evidence = excluded.evidence, outcome = excluded.outcome`);
    }

    return {
      rule: IMPLAUSIBLE_TRAVEL.rule,
      ruleVersion: IMPLAUSIBLE_TRAVEL.version,
      thresholds: {
        maxSpeedKmh: IMPLAUSIBLE_TRAVEL.maxSpeedKmh,
        minSecondsBetween: IMPLAUSIBLE_TRAVEL.minSecondsBetween,
        maxUsableAccuracyM: IMPLAUSIBLE_TRAVEL.maxUsableAccuracyM
      },
      examined: evidence.length,
      collectors: byCollector.size,
      concerns: findings.filter((f) => f.outcome === 'concern').length,
      inconclusive: findings.filter((f) => f.outcome === 'inconclusive').length,
      plausible: findings.filter((f) => f.outcome === 'plausible').length
    };
  }));

  service.get('/projects/:projectId/forms/:xmlFormId/integrity', endpoint(async (container, { params, auth }) => {
    const form = await container.Forms
      .getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.PublishedVersion)
      .then(getOrNotFound);
    await auth.canOrReject('submission.list', form);
    await auth.canOrReject('submission.read', form);

    return container.db.any(sql`
      select f.*, actors."displayName" as "decidedByName"
      from field_data_integrity_flags f
      left join actors on actors.id = f."decidedBy"
      where f."formId" = ${form.id}
      order by
        case f.outcome when 'concern' then 0 else 1 end,
        case f.status when 'open' then 0 when 'investigating' then 1 else 2 end,
        f."createdAt" desc`);
  }));

  // A reviewer's decision. The rule never writes here: a finding is closed by
  // a person, with a reason, and the finding itself is left intact.
  const DECISIONS = new Set([
    'data-error',        // the data was wrong and has been or will be corrected
    'explained',         // there is an ordinary explanation
    'unresolved',        // looked at, still not understood
    'substantiated'      // an authorised process established misconduct
  ]);

  service.patch('/projects/:projectId/forms/:xmlFormId/integrity/:id', endpoint(async (container, { params, body, auth }) => {
    const form = await container.Forms
      .getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.PublishedVersion)
      .then(getOrNotFound);
    await auth.canOrReject('submission.update', form);

    const id = Number.parseInt(params.id, 10);
    if (!Number.isInteger(id)) return reject(Problem.user.notFound());

    const status = String(body?.status ?? '');
    if (!['open', 'investigating', 'resolved'].includes(status))
      return reject(Problem.user.unexpectedValue({
        field: 'status', value: body?.status,
        reason: 'must be open, investigating or resolved'
      }));

    const decision = body?.decision == null ? null : String(body.decision);
    if (status === 'resolved' && !DECISIONS.has(decision))
      return reject(Problem.user.unexpectedValue({
        field: 'decision', value: decision,
        reason: `resolving a finding needs one of: ${[...DECISIONS].join(', ')}`
      }));

    const note = body?.note == null ? null : String(body.note).slice(0, 4000);
    // Saying a finding is substantiated is an accusation, and an accusation
    // with no reasoning attached is not one this will record.
    if (decision === 'substantiated' && (note == null || note.trim() === ''))
      return reject(Problem.user.unexpectedValue({
        field: 'note', value: note,
        reason: 'recording substantiated misconduct requires a written reason'
      }));

    const updated = await container.db.maybeOne(sql`
      update field_data_integrity_flags
      set status = ${status},
          decision = ${status === 'resolved' ? decision : null},
          note = ${note},
          "decidedBy" = ${auth.actor.map((a) => a.id).orNull()},
          "decidedAt" = clock_timestamp()
      where id = ${id} and "formId" = ${form.id}
      returning *`);
    if (updated == null) return reject(Problem.user.notFound());
    return updated;
  }));

  ////////////////////////////////////////////////////////////////////////////////
  // PROJECT SUMMARY
  //
  // The same questions the form summary answers, asked of a whole project.
  // A project manager wants to know how the round is going, and reading it
  // form by form makes them do the adding up themselves.
  service.get('/projects/:projectId/summary', endpoint(async (container, { params, auth }) => {
    const { Projects } = container;
    const db = container.db;

    const project = await Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('submission.list', project);
    await auth.canOrReject('submission.read', project);

    const live = sql`
      from submissions s
      join forms f on f.id = s."formId"
      where f."projectId" = ${project.id} and f."deletedAt" is null
        and s."deletedAt" is null and s.draft = false`;

    const totals = await db.one(sql`
      select count(*)::integer as submissions,
             count(distinct s."submitterId")::integer as submitters,
             count(distinct s."formId")::integer as "formsWithSubmissions",
             min(s."createdAt") as "firstSubmission",
             max(s."createdAt") as "lastSubmission"
      ${live}`);

    const forms = await db.oneFirst(sql`
      select count(*)::integer from forms
      where "projectId" = ${project.id} and "deletedAt" is null`);

    if (totals.submissions === 0)
      return { ...totals, forms, overTime: [], reviewStates: [], byForm: [] };

    const overTime = await db.any(sql`
      select (s."createdAt" at time zone 'UTC')::date as date, count(*)::integer as count
      ${live}
      group by 1 order by 1`);

    const reviewStates = await db.any(sql`
      select coalesce(s."reviewState", 'received') as state, count(*)::integer as count
      ${live}
      group by 1 order by 2 desc`);

    // Which forms the submissions came from. A form nobody has used does not
    // appear: a row of zero tells a reader nothing they cannot see from the
    // forms list, and it would push the forms that are working off the chart.
    // Not ${live}: this one needs the form's title, which lives on the form's
    // current definition rather than on the form row -- forms.name was dropped
    // in 20210423-02. Left joined so a form without a published definition
    // still appears, falling back to its id.
    const byForm = await db.any(sql`
      select f."xmlFormId" as "xmlFormId",
             coalesce(fd.name, f."xmlFormId") as name,
             count(*)::integer as count
      from submissions s
      join forms f on f.id = s."formId"
      left join form_defs fd on fd.id = f."currentDefId"
      where f."projectId" = ${project.id} and f."deletedAt" is null
        and s."deletedAt" is null and s.draft = false
      group by f."xmlFormId", fd.name
      order by count(*) desc`);

    return { ...totals, forms, overTime, reviewStates, byForm };
  }));

  ////////////////////////////////////////////////////////////////////////////////
  // SHARED DASHBOARDS
  //
  // A read-only link to one form's summary that works without an account, for
  // the funder, the ministry or the district office who should see the numbers
  // and should not be given a login.
  //
  // Only counts go through a share. The summary has no individual submission
  // in it, no attachment and no submitter's name, so a link cannot leak what
  // one household answered however long somebody holds it.
  //
  // The token is a credential, so the database keeps only its SHA-256. A
  // reader of the table cannot use what they find; the usable token is
  // returned once, at creation, and never again.
  const dashboardView = ({ tokenSha, ...rest }) => rest;
  const tokenSha = (token) => crypto.createHash('sha256').update(token).digest('hex');

  service.get('/projects/:projectId/forms/:xmlFormId/dashboards', endpoint(async (container, { params, auth }) => {
    const form = await container.Forms
      .getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.PublishedVersion)
      .then(getOrNotFound);
    await auth.canOrReject('form.update', form);
    const rows = await container.db.any(sql`
      select * from field_data_dashboards
      where "formId" = ${form.id} and "revokedAt" is null
      order by "createdAt" desc`);
    return rows.map(dashboardView);
  }));

  service.post('/projects/:projectId/forms/:xmlFormId/dashboards', endpoint(async (container, { params, body, auth }) => {
    const form = await container.Forms
      .getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.PublishedVersion)
      .then(getOrNotFound);
    // Sharing a form's numbers with the whole internet is an act of
    // publication, so it takes the permission that changes the form rather
    // than the one that reads it.
    await auth.canOrReject('form.update', form);

    const name = String(body?.name ?? '').trim().slice(0, 255);
    if (name === '')
      return reject(Problem.user.missingParameter({ field: 'name' }));

    // 32 bytes of randomness. Long enough that guessing is not a strategy.
    const token = crypto.randomBytes(32).toString('base64url');

    let expiresAt = null;
    if (body?.expiresInDays != null) {
      const days = Number.parseInt(body.expiresInDays, 10);
      if (!Number.isFinite(days) || days < 1 || days > 3650)
        return reject(Problem.user.unexpectedValue({
          field: 'expiresInDays', value: body.expiresInDays,
          reason: 'must be a whole number of days between 1 and 3650'
        }));
      expiresAt = new Date(Date.now() + (days * 24 * 60 * 60 * 1000));
    }

    const created = await container.db.one(sql`
      insert into field_data_dashboards
        ("tokenSha", "tokenHint", name, "projectId", "formId", "createdBy", "expiresAt")
      values (${tokenSha(token)}, ${token.slice(0, 8)}, ${name},
              ${form.projectId}, ${form.id}, ${auth.actor.map((a) => a.id).orNull()}, ${expiresAt})
      returning *`);

    // The only time the usable token is ever returned.
    return { ...dashboardView(created), token };
  }));

  service.delete('/projects/:projectId/forms/:xmlFormId/dashboards/:id', endpoint(async (container, { params, auth }) => {
    const form = await container.Forms
      .getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.PublishedVersion)
      .then(getOrNotFound);
    await auth.canOrReject('form.update', form);
    const revoked = await container.db.maybeOne(sql`
      update field_data_dashboards set "revokedAt" = clock_timestamp()
      where id = ${params.id} and "formId" = ${form.id} and "revokedAt" is null
      returning id`);
    if (revoked == null) return reject(Problem.user.notFound());
    return success();
  }));

  // The public face of a share. No session, no cookie, no actor: the token in
  // the URL is the whole of the authorisation, which is why it buys so little.
  service.get('/field-data/shared/:token', endpoint(async (container, { params }) => {
    const token = String(params.token ?? '');
    // A token is 32 random bytes in base64url. Anything else is not a token
    // that was ever issued, and is refused before it reaches the database.
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return reject(Problem.user.notFound());

    const share = await container.db.maybeOne(sql`
      select d.*, f."xmlFormId", coalesce(fd.name, f."xmlFormId") as "formName",
             p.name as "projectName"
      from field_data_dashboards d
      join forms f on f.id = d."formId"
      -- The title is on the current definition; forms.name no longer exists.
      left join form_defs fd on fd.id = f."currentDefId"
      join projects p on p.id = d."projectId"
      where d."tokenSha" = ${tokenSha(token)}
        and d."revokedAt" is null
        and (d."expiresAt" is null or d."expiresAt" > clock_timestamp())
        and f."deletedAt" is null`);

    // Revoked, expired, never issued, or for a form since deleted: all the
    // same answer, so the link cannot be used to learn which it was.
    if (share == null) return reject(Problem.user.notFound());

    // Counting views is what makes a share auditable after the fact. It must
    // never be the reason a reader gets an error, so it is not awaited into
    // the response path.
    container.db.query(sql`
      update field_data_dashboards
      set views = views + 1, "lastViewedAt" = clock_timestamp()
      where id = ${share.id}`).catch(() => {});

    const summary = await summarizeForm(container.db, share.formId);
    return {
      name: share.name,
      formName: share.formName ?? share.xmlFormId,
      projectName: share.projectName,
      expiresAt: share.expiresAt,
      summary
    };
  }));

  ////////////////////////////////////////////////////////////////////////////////
  // FORM PHOTOS
  //
  // The image attachments of a form's submissions, newest first, with enough
  // about each one to say where it came from. The images themselves are served
  // by the existing attachment route; this only says which ones exist, so a
  // gallery never has to walk every submission to find out.
  service.get('/projects/:projectId/forms/:xmlFormId/photos', endpoint(async (container, { params, query, auth }) => {
    const { Forms } = container;
    const db = container.db;

    const form = await Forms.getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.PublishedVersion)
      .then(getOrNotFound);
    await auth.canOrReject('submission.list', form);
    await auth.canOrReject('submission.read', form);

    // A page the browser can actually hold. Asking for more is treated as
    // asking for the maximum rather than refused.
    const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 60, 1), 120);
    const offset = Math.max(Number.parseInt(query.offset, 10) || 0, 0);

    const images = sql`
      from submissions s
      join submission_defs sd on sd."submissionId" = s.id and sd.current = true
      join submission_attachments sa on sa."submissionDefId" = sd.id
      join blobs b on b.id = sa."blobId"
      left join actors on actors.id = s."submitterId"
      where s."formId" = ${form.id} and s."deletedAt" is null and s.draft = false
        and coalesce(sa."isClientAudit", false) = false
        and b."contentType" like 'image/%'`;

    const total = await db.oneFirst(sql`select count(*)::integer ${images}`);

    const photos = total === 0 ? [] : await db.any(sql`
      select s."instanceId" as "instanceId", sa.name as name,
             b."contentType" as "contentType", s."createdAt" as "createdAt",
             s."reviewState" as "reviewState",
             actors."displayName" as submitter
      ${images}
      order by s."createdAt" desc, sa.name
      limit ${limit} offset ${offset}`);

    return { total, limit, offset, photos };
  }));

  ////////////////////////////////////////////////////////////////////////////////
  // DASHBOARD STATS
  service.get('/field-data/stats', endpoint(async (container, { auth }) => {
    const { Projects } = container;
    const dbPool = container.db;

    // Get projects the user has access to
    const projects = await Projects.getAllByAuth(auth);
    const projectIds = projects.map(p => p.id);
    const readable = await Promise.all(projects.map(async project =>
      (((await auth.can('submission.list', project)) && (await auth.can('submission.read', project)))
        ? project.id : null)));
    const submissionProjectIds = readable.filter(id => id != null);

    if (projectIds.length === 0) {
      return {
        kpi: { projects: 0, forms: 0, submissions: 0, users: 0 },
        recentSubmissions: [],
        projects: [],
        submissionsTrend: [],
        topForms: [],
        systemStatus: {
          database: true,
          fileStorage: true,
          enketo: false,
          pyxform: false,
          emailService: false
        }
      };
    }

    const isAdmin = await auth.can('user.list', User.species);

    // 1. KPI Counts
    const formsCount = await dbPool.oneFirst(sql`
      select count(*)::integer from forms 
      where "deletedAt" is null and "projectId" = ANY(${sql.array(projectIds, 'int4')})
    `);

    const submissionsCount = await dbPool.oneFirst(sql`
      select count(*)::integer from submissions 
      join forms on submissions."formId" = forms.id 
      where forms."deletedAt" is null and submissions."deletedAt" is null and submissions.draft = false
        and forms."projectId" = ANY(${sql.array(submissionProjectIds, 'int4')})
    `);

    const usersCount = isAdmin
      ? await dbPool.oneFirst(sql`select count(*)::integer from users join actors on users."actorId" = actors.id where actors."deletedAt" is null`)
      : await dbPool.oneFirst(sql`select count(distinct "actorId")::integer from assignments where "acteeId" = ANY(${sql.array(projects.map(p => p.acteeId), 'text')})`);

    // 2. Recent Submissions
    const recentSubmissions = await dbPool.any(sql`
      select submissions.id, submissions."instanceId", submissions."createdAt",
             forms."xmlFormId" as form, form_defs.name as "formName",
             projects.name as project, actors."displayName" as submitter
      from submissions
      join forms on submissions."formId" = forms.id
      join form_defs on form_defs.id = forms."currentDefId"
      join projects on forms."projectId" = projects.id
      left join actors on submissions."submitterId" = actors.id
      where forms."deletedAt" is null and submissions."deletedAt" is null
        and submissions.draft = false
        and forms."projectId" = ANY(${sql.array(submissionProjectIds, 'int4')})
      order by submissions."createdAt" desc
      limit 5
    `);

    // 3. Submissions Trend (grouped by day)
    const trend = await dbPool.any(sql`
      select date_trunc('day', submissions."createdAt")::date as day, count(*)::integer as count
      from submissions
      join forms on submissions."formId" = forms.id
      where forms."deletedAt" is null and submissions."deletedAt" is null
        and submissions.draft = false
        and forms."projectId" = ANY(${sql.array(submissionProjectIds, 'int4')})
        and submissions."createdAt" >= now() - interval '7 days'
      group by day
      order by day asc
    `);

    // 4. Top Forms
    const topForms = await dbPool.any(sql`
      select forms."xmlFormId" as form, form_defs.name as name, count(submissions.id)::integer as count
      from submissions
      join forms on submissions."formId" = forms.id
      join form_defs on form_defs.id = forms."currentDefId"
      where forms."deletedAt" is null and submissions."deletedAt" is null
        and submissions.draft = false
        and forms."projectId" = ANY(${sql.array(submissionProjectIds, 'int4')})
      group by forms.id, forms."xmlFormId", form_defs.name
      order by count desc
      limit 5
    `);

    // 5. System Status Checkers
    let dbStatus = false;
    try {
      await dbPool.oneFirst(sql`select 1`);
      dbStatus = true;
    } catch (e) { /* status probe is best-effort */ }

    let fileStorageStatus = false;
    try {
      const testKey = `health/${crypto.randomUUID()}`;
      await storage.putBuffer(testKey, Buffer.from('ok'));
      await storage.delete(testKey);
      fileStorageStatus = true;
    } catch (e) { /* status probe is best-effort */ }

    let enketoStatus = false;
    const enketoUrl = config.has('default.enketo.url') ? config.get('default.enketo.url') : null;
    if (enketoUrl) {
      enketoStatus = await pingUrl(enketoUrl);
    }

    let pyxformStatus = false;
    const xlsConfig = config.has('default.xlsform') ? config.get('default.xlsform') : null;
    if (xlsConfig) {
      pyxformStatus = await pingUrl(`${xlsConfig.protocol || 'http'}://${xlsConfig.host}:${xlsConfig.port}/`);
    }

    let emailServiceStatus = false;
    const emailConfig = config.has('default.email') ? config.get('default.email') : null;
    if (emailConfig && emailConfig.transport) emailServiceStatus = true;

    return {
      kpi: {
        projects: projectIds.length,
        forms: formsCount,
        submissions: submissionsCount,
        users: usersCount
      },
      recentSubmissions,
      projects: projects.map(p => ({
        id: p.id,
        name: p.name,
        date: p.createdAt,
        count: p.def?.forms || 0
      })),
      submissionsTrend: trend,
      topForms,
      systemStatus: {
        database: dbStatus,
        fileStorage: fileStorageStatus,
        enketo: enketoStatus,
        pyxform: pyxformStatus,
        emailService: emailServiceStatus
      }
    };
  }));

  ////////////////////////////////////////////////////////////////////////////////
  // MEDIA LIBRARY
  service.get('/field-data/media', endpoint(async (container, { auth }) => {
    await auth.canOrReject('project.create', Project.species);
    return container.db.any(sql`select * from field_data_media order by "createdAt" desc`);
  }));

  service.post('/field-data/media', upload.single('file'), uploadErrorHandler,
    endpoint(async (container, { auth }, request) => {
      await auth.canOrReject('project.create', Project.species); // restrict to admin/managers
      const { file } = request; // populated by multer's upload.single middleware
      if (!file) return reject(Problem.user.missingMultipartField({ field: 'file' }));
      const type = allowedMediaTypes.get(file.mimetype);
      if (type == null) {
        return reject(Problem.user.unexpectedValue({
          field: 'file',
          value: file.mimetype,
          reason: 'unsupported media type'
        }));
      }

      const fileExt = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
      const storageKey = `media/${crypto.randomUUID()}${fileExt}`;
      await storage.putBuffer(storageKey, file.buffer, { 'Content-Type': file.mimetype });
      try {
        return await container.db.one(sql`
        insert into field_data_media (name, type, size, "sizeBytes", "mimeType", "storageKey")
        values (${path.basename(file.originalname)}, ${type}, ${formatBytes(file.size)},
          ${file.size}, ${file.mimetype}, ${storageKey})
        returning *
      `);
      } catch (error) {
        await storage.delete(storageKey);
        throw error;
      }
    }));

  service.delete('/field-data/media/:id', endpoint(async (container, { params, auth }) => {
    await auth.canOrReject('project.create', Project.species);
    const record = await container.maybeOne(sql`
      select * from field_data_media where id = ${params.id}
    `).then(getOrNotFound);

    if (record.storageKey) await storage.delete(record.storageKey);
    await container.db.query(sql`delete from field_data_media where id = ${params.id}`);
    return success();
  }));

  service.get('/field-data/media/download/:id', endpoint(async (container, { params, auth }, _, response) => {
    await auth.canOrReject('project.create', Project.species);
    const record = await container.maybeOne(sql`
      select * from field_data_media where id = ${params.id}
    `).then(getOrNotFound);
    if (!record.storageKey) return reject(Problem.user.notFound());

    response.set('Content-Disposition', contentDisposition(record.name));
    response.set('Content-Type', record.mimeType || 'application/octet-stream');
    return storage.getStream(record.storageKey);
  }));

  ////////////////////////////////////////////////////////////////////////////////
  // WEBHOOKS
  service.get('/field-data/webhooks', endpoint(async (container, { auth }) => {
    await auth.canOrReject('config.set', Config.species);
    const webhooks = await container.db.any(sql`
      select id, name, url, events, active, "lastStatus", "createdAt",
        (secret is not null and secret <> '') as "hasSecret"
      from field_data_webhooks order by "createdAt" desc`);
    return webhooks;
  }));

  service.post('/field-data/webhooks', endpoint(async (container, { body, auth }) => {
    await auth.canOrReject('config.set', Config.species);
    if (!body.name) return reject(Problem.user.missingParameter({ field: 'name' }));
    if (!body.url) return reject(Problem.user.missingParameter({ field: 'url' }));
    await validWebhookUrl(body.url);
    // Generate a signing secret so receivers can verify the HMAC-SHA256
    // signature sent with each delivery (X-FieldData-Signature header).
    const events = validateEvents(body.events === undefined ? [] : body.events);
    const secret = crypto.randomBytes(24).toString('hex');
    const created = await container.db.one(sql`
      insert into field_data_webhooks (name, url, events, secret)
      values (${body.name}, ${body.url}, ${JSON.stringify(events)}, ${encryptSecret(secret)})
      returning *
    `);
    return { ...publicWebhook(created), secret };
  }));

  service.get('/field-data/webhooks/:id/deliveries', endpoint(async (container, { params, auth }) => {
    await auth.canOrReject('config.set', Config.species);
    return container.db.any(sql`
      select * from field_data_webhook_deliveries
      where "webhookId" = ${params.id}
      order by "createdAt" desc
      limit 50
    `);
  }));

  service.patch('/field-data/webhooks/:id', endpoint(async (container, { params, body, auth }) => {
    await auth.canOrReject('config.set', Config.species);
    const webhook = await container.maybeOne(sql`
      select * from field_data_webhooks where id = ${params.id}
    `).then(getOrNotFound);

    const updated = {
      name: body.name !== undefined ? body.name : webhook.name,
      url: body.url !== undefined ? body.url : webhook.url,
      events: body.events !== undefined ? JSON.stringify(validateEvents(body.events)) : JSON.stringify(validateEvents(webhook.events)),
      active: body.active !== undefined ? body.active : webhook.active
    };
    await validWebhookUrl(updated.url);

    const result = await container.db.one(sql`
      update field_data_webhooks
      set name=${updated.name}, url=${updated.url}, events=${updated.events}, active=${updated.active}
      where id=${params.id}
      returning *
    `);
    return publicWebhook(result);
  }));

  service.post('/field-data/webhooks/:id/rotate-secret', endpoint(async (container, { params, auth }) => {
    await auth.canOrReject('config.set', Config.species);
    const secret = crypto.randomBytes(24).toString('hex');
    const result = await container.maybeOne(sql`
      update field_data_webhooks set secret=${encryptSecret(secret)}
      where id=${params.id} returning *
    `).then(getOrNotFound);
    return { ...publicWebhook(result), secret };
  }));

  service.delete('/field-data/webhooks/:id', endpoint(async (container, { params, auth }) => {
    await auth.canOrReject('config.set', Config.species);
    await container.db.query(sql`delete from field_data_webhooks where id = ${params.id}`);
    return success();
  }));

  ////////////////////////////////////////////////////////////////////////////////
  // BACKUPS
  service.get('/field-data/backups', endpoint(async (container, { auth }) => {
    await auth.canOrReject('backup.run', Config.species);
    return container.db.any(sql`
      select id, date, type, size, status, "statusColor", "sizeBytes", error, "completedAt",
        ("storageKey" is not null and status='Success') as downloadable
      from field_data_backups order by date desc`);
  }));

  service.post('/field-data/backups', endpoint(async (container, { auth }, _, response) => {
    await auth.canOrReject('backup.run', Config.species);
    const passphrase = process.env.FIELD_DATA_BACKUP_PASSPHRASE;
    if (typeof passphrase !== 'string' || passphrase.length < 16) {
      throw Problem.user.unexpectedValue({ field: 'passphrase', value: '[redacted]',
        reason: 'set FIELD_DATA_BACKUP_PASSPHRASE to at least 16 characters' });
    }
    // Serialize enqueue operations within the request transaction. Repeated clicks
    // reuse the outstanding job rather than launching concurrent database dumps.
    await container.db.query(sql`select pg_advisory_xact_lock(74120, hashtext(current_schema()))`);
    const existing = await container.db.maybeOne(sql`
      select * from field_data_backups where status in ('Pending', 'Running') order by id limit 1`);
    response.status(202);
    if (existing != null) return { ...existing, downloadable: false };
    return container.db.one(sql`
      insert into field_data_backups (type, size, status, "statusColor")
      values ('Manual', 'Pending', 'Pending', 'info')
      returning *, false as downloadable`);
  }));

  service.get('/field-data/backups/:id/download', endpoint(async (container, { params, auth }, _, response) => {
    await auth.canOrReject('backup.run', Config.species);
    const record = await container.maybeOne(sql`
      select * from field_data_backups where id=${params.id}
    `).then(getOrNotFound);
    if (!record.storageKey || record.status !== 'Success') return reject(Problem.user.notFound());
    response.set('Content-Disposition', contentDisposition(`field-data-backup-${record.id}.pgdump.enc.bin`));
    response.set('Content-Type', 'application/octet-stream');
    return storage.getStream(record.storageKey);
  }));
};
