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
const { Readable } = require('node:stream');
const { User, Project, Config, Form, Submission } = require('../model/frames');
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
const { chartableFields } = require('../util/summary-fields');
const { mergeFields, codingDivergence } = require('../util/merged-datasets');
const { getTarget, normalizeConfig, redactConfig, sealConfig, describeTargets } = require('../util/rest-targets');
const { normalizeOrganization, roleForOrganization, describeRoles } = require('../util/organizations');
const { normalizeFormDefinition, buildWorkbook, QUESTION_TYPES } = require('../util/xlsform-builder');
const { inspectTemplate, validateTemplate, MIME_TYPE,
  MAX_TEMPLATE_BYTES, MAX_REPORT_ROWS } = require('../util/xls-reports');
const { resolveReportSource, rowsForSource } = require('../util/xls-report-data');
const { CSV_MIME, XLSX_MIME, csvExport, xlsxExport } = require('../util/filtered-dataset-export');
const { visibleProjects, actorIdOf } = require('../util/cross-project');
const { MAX_IMPORT_BYTES, templateCsv, inspectCsv, submissionXml } = require('../util/submission-csv-import');

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
const csvImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_BYTES, files: 1, fields: 2 }
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

// Never the signing secret, and never a credential out of config: a value
// handed back once is a value that has been logged and pasted into a ticket.
// What comes back is whether it is set and the last few characters.
const publicWebhook = ({ secret, config: targetConfig, ...webhook }) => ({
  ...webhook,
  config: redactConfig(webhook.target, targetConfig),
  hasSecret: Boolean(secret)
});

const targetOrProblem = (target, targetConfig) => {
  try {
    return normalizeConfig(target, targetConfig);
  } catch (error) {
    if (error.field != null) {
      throw Problem.user.unexpectedValue({
        field: error.field, value: error.value, reason: error.reason
      });
    }
    throw error;
  }
};

const enqueueGoogleSheetSync = async (db, webhookId, formId) => {
  // Serialize clicks for one integration. The partial unique index is still
  // the final defence, but this lets both callers receive the same job rather
  // than one receiving a database constraint error.
  await db.query(sql`select pg_advisory_xact_lock(74124, ${webhookId})`);
  const existing = await db.maybeOne(sql`
    select * from field_data_google_sheet_syncs
    where "webhookId"=${webhookId} and status in ('Pending', 'Running')
    order by id desc limit 1`);
  if (existing != null) return existing;
  const sync = await db.one(sql`
    insert into field_data_google_sheet_syncs ("webhookId") values (${webhookId}) returning *`);
  await db.query(sql`
    insert into field_data_google_sheet_sync_items ("syncId", "submissionId")
    select ${sync.id}, s.id from submissions s
    where s."formId"=${formId} and s."deletedAt" is null and s.draft=false
    order by s.id`);
  return db.one(sql`
    update field_data_google_sheet_syncs set total=(
      select count(*)::integer from field_data_google_sheet_sync_items where "syncId"=${sync.id}
    ) where id=${sync.id} returning *`);
};

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
/*
`minValueCount` is the disclosure control on the anonymous path.

The heuristics below pick a field for charting when its answers repeat, which
is a readability rule and not a privacy one: a field with six submissions and
five distinct answers passes it, and four of those bars are then one bar per
person. On the authenticated routes that is fine -- the reader already holds
submission.read and could open the submissions themselves. On the shared
dashboard, which has no reader at all, it publishes individual answers to the
internet, and the field types that pass include dates of birth and any short
text answer.

So a share asks for a floor: a value is only shown when at least this many
submissions gave it, and a field is only shown when at least two of its values
clear the floor. Everything below it becomes part of the "Other" bar, and that
bar is itself dropped unless it clears the floor too. The result is a chart of
genuine aggregates or no chart at all.
*/
const summarizeForm = async (db, formId, { minValueCount = 1 } = {}) => {
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

  // Which fields are worth a chart, and which values may be shown at all.
  // Both rules live in lib/util/summary-fields.js, where the second one can
  // be tested without a database -- it is the disclosure control on the
  // anonymous path, and it should not be something only an integration test
  // can see.
  const { fields, truncated } = chartableFields(answers, { minValueCount });

  return { ...totals, overTime, reviewStates, fields, truncated };
};

// A path parameter on its way into an integer column. Left as a string it
// reaches Postgres as one, and "abc" comes back a 500 rather than the 404 the
// route means. Throws the Problem rather than returning it, so it can be used
// inline in a query template.
// A map the browser has to draw, so the page size is about what a map can
// usefully show rather than about what the database can return.
const MAP_MAX_FEATURES = 2000;
const MAP_MAX_FORMS = 100;

const intParam = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) throw Problem.user.notFound();
  return parsed;
};

const reportSourceColumns = (sourceType, sourceId) => {
  const id = intParam(sourceId);
  if (sourceType === 'form')
    return { formId: id, filteredDatasetId: null, mergedDatasetId: null };
  if (sourceType === 'filtered')
    return { formId: null, filteredDatasetId: id, mergedDatasetId: null };
  if (sourceType === 'merged')
    return { formId: null, filteredDatasetId: null, mergedDatasetId: id };
  throw Problem.user.unexpectedValue({
    field: 'sourceType', value: sourceType,
    reason: 'must be form, filtered, or merged'
  });
};

const xlsProblem = (error) => Problem.user.unexpectedValue({
  field: 'file', value: '[workbook]', reason: error.reason ?? 'could not read this workbook'
});

/*
The system status block, which is the one part of the dashboard that does
something rather than counting something.

It writes and deletes an object in the configured storage backend and makes an
outbound request to each of Enketo and pyxform. Running that on every dashboard
load meant any project member could drive real infrastructure as fast as they
could refresh a page, and it answered "what does this deployment run, and is it
reachable" for somebody whose question was "how many submissions came in".

So it is administrators only now, and cached. The promise is what gets cached
rather than the value, so requests arriving together share one probe instead of
starting four, and a probe that somehow rejects is not remembered for the rest
of the window -- the next reader finds out for themselves.

Per worker process, deliberately: a probe is about this process's view of the
world, and a shared cache would report somebody else's.
*/
const SYSTEM_STATUS_TTL = 30 * 1000;
let systemStatusProbe = null;

const probeSystemStatus = (db) => {
  if (systemStatusProbe != null && Date.now() - systemStatusProbe.at < SYSTEM_STATUS_TTL)
    return systemStatusProbe.value;

  const value = (async () => {
    let database = false;
    try {
      await db.oneFirst(sql`select 1`);
      database = true;
    } catch (e) { /* status probe is best-effort */ }

    let fileStorage = false;
    try {
      const testKey = `health/${crypto.randomUUID()}`;
      await storage.putBuffer(testKey, Buffer.from('ok'));
      await storage.delete(testKey);
      fileStorage = true;
    } catch (e) { /* status probe is best-effort */ }

    const enketoUrl = config.has('default.enketo.url') ? config.get('default.enketo.url') : null;
    const enketo = enketoUrl ? await pingUrl(enketoUrl) : false;

    const xlsConfig = config.has('default.xlsform') ? config.get('default.xlsform') : null;
    const pyxform = xlsConfig
      ? await pingUrl(`${xlsConfig.protocol || 'http'}://${xlsConfig.host}:${xlsConfig.port}/`)
      : false;

    const emailConfig = config.has('default.email') ? config.get('default.email') : null;
    const emailService = Boolean(emailConfig && emailConfig.transport);

    return { database, fileStorage, enketo, pyxform, emailService };
  })();

  systemStatusProbe = { at: Date.now(), value };
  value.catch(() => { systemStatusProbe = null; });
  return value;
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

const filteredDatasetRecord = (container, projectId, id) => container.maybeOne(sql`
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
  // "Answered" has to mean "contributed to the number shown", not "was not
  // blank". A field somebody typed "about two" into is an answer, but it is not
  // a value any mean was taken over, and counting it would make the coverage
  // line disagree with the chart's own rows by one. Found against real data:
  // 320 answers, 319 of them numbers.
  const answered = normalized.aggregation === 'count'
    ? sql`nullif(btrim(extracted ->> ${value}::text), '') is not null`
    : sql`btrim(extracted ->> ${value}::text) ~ ${WIDGET_NUMERIC}`;
  const coverage = await db.one(sql`
    with rows as (${scoped})
    select count(*)::integer as total,
      count(*) filter (where nullif(btrim(extracted ->> ${key}::text), '') is not null)::integer as grouped,
      count(*) filter (where ${answered})::integer as answered
    from rows`);

  if (coverage.total === 0)
    return { rows: [], omitted: null, coverage, distinct: 0 };

  const grouped = normalized.aggregation === 'count'
    ? await db.any(sql`
        with rows as (${scoped})
        select btrim(extracted ->> ${key}::text) as key, count(*)::integer as count
        from rows
        where nullif(btrim(extracted ->> ${key}::text), '') is not null
        group by 1 order by count(*) desc, 1`)
    : await db.any(sql`
        with rows as (${scoped}),
        numbers as (
          select btrim(extracted ->> ${key}::text) as key,
            case when btrim(extracted ->> ${value}::text) ~ ${WIDGET_NUMERIC}
              then (btrim(extracted ->> ${value}::text))::numeric end as value
          from rows
          where nullif(btrim(extracted ->> ${key}::text), '') is not null
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


////////////////////////////////////////////////////////////////////////////////
// MERGED DATASETS
//
// Several forms, one table over the fields they genuinely share. Read-only by
// construction: there is no route here that writes a submission, because a row
// belongs to one of the source forms and editing it through the merge has no
// good answer to whose validation applies.

const mergedDatasetRecord = (container, projectId, id) => container.maybeOne(sql`
  select * from field_data_merged_datasets
  where id = ${id} and "projectId" = ${projectId}`);

const mergedDatasetForms = (db, mergedDatasetId) => db.any(sql`
  select f.id as "formId", f."xmlFormId", f."currentDefId", fd.name as "formName"
  from field_data_merged_dataset_forms mf
  join forms f on f.id = mf."formId" and f."deletedAt" is null
  left join form_defs fd on fd.id = f."currentDefId"
  where mf."mergedDatasetId" = ${mergedDatasetId}
  order by f."xmlFormId"`);

// The shared field set, recomputed every time. Forms get republished; a
// cached list would go stale and start lying rather than going missing.
const mergedDatasetShape = async (db, forms) => {
  const withFields = await Promise.all(forms.map(async (form) => ({
    ...form,
    // Both sources of `forms` here speak formId; filteredDatasetFields wants a
    // form-shaped object with id. Passing the wrong one binds undefined, which
    // slonik refuses -- and which only a real query ever surfaces.
    fields: await filteredDatasetFields(db, { id: form.formId, currentDefId: form.currentDefId })
  })));
  return { forms: withFields, ...mergeFields(withFields) };
};

// Rows from every source form, each carrying which form it came from so a
// reader can always get back to it.
const mergedDatasetRows = (forms, merged) => sql.join(forms.map(form => sql`
  select ${form.xmlFormId} as "sourceForm", s."instanceId", s."createdAt",
    ${extractObject(merged.map(field => field.path))} as extracted
  from submissions s
  join submission_defs sd on sd."submissionId" = s.id and sd.current = true
  where s."formId" = ${form.formId} and s."deletedAt" is null and s.draft = false
    and xml_is_well_formed_document(sd.xml)`), sql` union all `);

// Evidence of a coding clash, gathered from what submissions actually carry
// because ODK stores no queryable choice list. Bounded hard: this is a
// courtesy check, not a reason to make the detail route expensive.
const CODING_SAMPLE = 25;
const mergedDatasetCoding = async (db, forms, merged) => {
  const candidates = merged
    .filter(field => field.type === 'string' && field.selectMultiple !== true)
    .slice(0, 10);
  if (candidates.length === 0 || forms.length < 2) return [];

  const findings = [];
  for (const field of candidates) {
    const valuesByForm = {};
    for (const form of forms) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await db.any(sql`
        -- ::text for the same reason extractObject casts: xpath's first
        -- argument cannot be a bare parameter, and without it Postgres refuses
        -- the statement. The catch below would then swallow it and this check
        -- would silently never find anything.
        select distinct btrim((xpath(${`/*${field.path}/text()`}::text, sd.xml::xml))[1]::text) as value
        from submissions s
        join submission_defs sd on sd."submissionId" = s.id and sd.current = true
        where s."formId" = ${form.formId} and s."deletedAt" is null and s.draft = false
          and xml_is_well_formed_document(sd.xml)
        limit ${CODING_SAMPLE}`).catch(() => []);
      valuesByForm[form.xmlFormId] = rows
        .map(row => row.value)
        .filter(value => value != null && value !== '');
    }
    const divergence = codingDivergence(valuesByForm);
    if (divergence != null) findings.push({ path: field.path, ...divergence });
  }
  return findings;
};

module.exports = (service, endpoint) => {
  // The field_data_* tables backing these resources are created by the
  // 20260707-01-add-field-data-tables migration.

  ////////////////////////////////////////////////////////////////////////////////
  // FORM BUILDER
  //
  // Building a Form in the browser, without leaving to make a spreadsheet.
  //
  // The builder does not create the Form. It writes an XLSForm and hands it
  // back, and the client posts that to POST /projects/:id/forms -- the same
  // endpoint somebody dropping a file on the page uses. So pyxform's
  // validation, draft and publish, versioning, and the OpenRosa list ODK
  // Collect downloads from are all inherited rather than rebuilt, and there is
  // exactly one path by which a Form comes into being.
  //
  // It also means the spreadsheet is a real artifact. When the builder runs
  // out of road -- a repeat group, a cascading select -- somebody downloads
  // what they have and finishes it in Excel, rather than starting again.

  const formDefinitionOrProblem = (body) => {
    try {
      return normalizeFormDefinition(body);
    } catch (error) {
      if (error.field != null) {
        throw Problem.user.unexpectedValue({
          field: error.field, value: error.value, reason: error.reason
        });
      }
      throw error;
    }
  };

  // What the builder can offer, read from the same table that validates it, so
  // the interface and the validator cannot disagree about which types exist.
  service.get('/field-data/form-builder/question-types', endpoint(async (container, { auth }) => {
    if (!auth.isAuthenticated) return reject(Problem.user.insufficientRights());
    return Object.entries(QUESTION_TYPES).map(([name, spec]) => ({
      name, needsChoices: spec.list === true
    }));
  }));

  service.post('/projects/:projectId/form-builder/xlsform', endpoint(async (container, { params, body, auth }, _, response) => {
    const project = await container.Projects.getById(params.projectId).then(getOrNotFound);
    // The right to make a Form here, because this is the first half of making
    // one. Nothing is read and nothing is written; the check is about who gets
    // to start.
    await auth.canOrReject('form.create', project);

    const definition = formDefinitionOrProblem(body);
    const workbook = await buildWorkbook(definition);
    response.set('Content-Disposition', contentDisposition(`${definition.formId}.xlsx`));
    response.set('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return Readable.from(workbook);
  }));

  // AnyVersion, not PublishedVersion: a Form still in draft is exactly the one
  // somebody is most likely to reopen in the builder.
  const builderForm = (container, params, auth, verb) => container.Forms
    .getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.AnyVersion)
    .then(getOrNotFound)
    .then(async (form) => { await auth.canOrReject(verb, form); return form; });

  service.get('/projects/:projectId/forms/:xmlFormId/builder-definition', endpoint(async (container, { params, auth }) => {
    const form = await builderForm(container, params, auth, 'form.read');
    const row = await container.db.maybeOne(sql`
      select definition, "updatedAt" from field_data_form_definitions
      where "formId" = ${form.id}`);
    // A Form uploaded as a spreadsheet has no definition, and that is not an
    // error: it is the answer to "can this be opened in the builder".
    return row ?? { definition: null, updatedAt: null };
  }));

  service.put('/projects/:projectId/forms/:xmlFormId/builder-definition', endpoint(async (container, { params, body, auth }) => {
    const form = await builderForm(container, params, auth, 'form.update');
    // Validated before it is stored, so what comes back out can always be
    // built again. A definition that cannot be rebuilt is worse than none.
    const definition = formDefinitionOrProblem(body);
    await container.db.query(sql`
      insert into field_data_form_definitions ("formId", definition, "updatedBy", "updatedAt")
      values (${form.id}, ${JSON.stringify(definition)},
        ${auth.actor.map(actor => actor.id).orNull()}, clock_timestamp())
      on conflict ("formId") do update
        set definition = excluded.definition, "updatedBy" = excluded."updatedBy",
          "updatedAt" = excluded."updatedAt"`);
    return success();
  }));

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
  // CONTROLLED SUBMISSION CSV IMPORT
  //
  // Imports only into a Form that has never received a Submission. The caller
  // first validates a file, then commits the exact same bytes and validation
  // hash. There is intentionally no update, overwrite, or delete mode.
  const csvImportForm = async (container, params, auth) => {
    const form = await container.Forms
      .getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.PublishedVersion)
      .then(getOrNotFound);
    await auth.canOrReject('form.read', form);
    await auth.canOrReject('submission.create', form);
    if (!form.acceptsSubmissions()) {
      throw Problem.user.unexpectedValue({ field: 'form', value: form.xmlFormId,
        reason: 'the Form is not accepting Submissions' });
    }
    return form;
  };

  const assertBlankForm = async (container, form) => {
    const count = await container.db.oneFirst(sql`
      select count(*)::integer from submissions where "formId"=${form.id}`);
    if (count !== 0) {
      throw Problem.user.unexpectedValue({
        field: 'form', value: form.xmlFormId,
        reason: 'CSV import is only available before the Form has received any Submissions'
      });
    }
  };

  // multer's .single() puts the upload on the raw Express request as `file`.
  // The endpoint context copies `files` but not `file`, so reading it off the
  // context yields undefined and every upload looks like a missing field.
  const csvFileOrProblem = (request) => {
    if (request.file == null) throw Problem.user.missingMultipartField({ field: 'file' });
    return request.file.buffer;
  };

  service.get('/projects/:projectId/forms/:xmlFormId/submission-import/template.csv',
    endpoint(async (container, { params, auth }, _, response) => {
      const form = await csvImportForm(container, params, auth);
      await assertBlankForm(container, form);
      const fields = await container.Forms.getFields(form.def.id);
      response.set('Content-Disposition', contentDisposition(`${form.xmlFormId}-submission-import.csv`));
      response.set('Content-Type', 'text/csv; charset=utf-8');
      return templateCsv(fields);
    }));

  service.post('/projects/:projectId/forms/:xmlFormId/submission-import/dry-run',
    csvImportUpload.single('file'), uploadErrorHandler,
    endpoint(async (container, { params, auth }, request) => {
      const form = await csvImportForm(container, params, auth);
      await assertBlankForm(container, form);
      const fields = await container.Forms.getFields(form.def.id);
      const result = inspectCsv(csvFileOrProblem(request), fields, form.def.id);
      return { hash: result.hash, rows: result.rows, validRows: result.validRows,
        errors: result.errors };
    }));

  service.post('/projects/:projectId/forms/:xmlFormId/submission-import/commit',
    csvImportUpload.single('file'), uploadErrorHandler,
    endpoint(async (container, { params, body, auth, userAgent, headers }, request) => {
      const form = await csvImportForm(container, params, auth);
      // Serialize two import commits for one Form. This also makes a double
      // click deterministic: the second transaction sees the first one's rows.
      await container.db.query(sql`select pg_advisory_xact_lock(74128, ${form.id})`);
      // Rechecked inside this request's transaction, so a collection upload
      // between dry-run and commit makes this fail closed.
      await assertBlankForm(container, form);
      const fields = await container.Forms.getFields(form.def.id);
      const result = inspectCsv(csvFileOrProblem(request), fields, form.def.id);
      if (typeof body?.validationHash !== 'string' || body.validationHash !== result.hash) {
        throw Problem.user.unexpectedValue({ field: 'validationHash', value: '[redacted]',
          reason: 'the committed file must be the exact file that passed dry-run validation' });
      }
      if (result.errors.length !== 0) {
        throw Problem.user.unexpectedValue({ field: 'file', value: request.file.originalname,
          reason: `dry-run validation found ${result.errors.length} error(s)` });
      }

      const binaryFields = await container.Forms.getBinaryFields(form.def.id);
      let created = 0;
      for (const data of result.submissions) {
        // Sequential writes keep a maximum-size import from opening hundreds
        // of concurrent queries within one transaction.
        // eslint-disable-next-line no-await-in-loop
        const partial = await Submission.fromXml(Buffer.from(submissionXml(form, data)));
        // eslint-disable-next-line no-await-in-loop
        const submission = await container.Submissions.createNew(
          partial, form, null, userAgent, headers['odk-client']
        );
        // No binary fields are importable, but this call preserves the normal
        // Submission attachment bookkeeping and its invariants.
        // eslint-disable-next-line no-await-in-loop
        await container.SubmissionAttachments.create(submission, form, binaryFields);
        created += 1;
      }
      return { created };
    }));

  ////////////////////////////////////////////////////////////////////////////////
  // FILTERED DATASETS
  //
  // A filtered dataset exposes selected answer paths and matching rows from a
  // source form through a destination project. Editors must be able to change
  // the source form; readers need rights only on the destination project. The
  // data route deliberately performs no source-form permission fallback.

  /*
  Which side of a share the caller stands on, or null if neither.

  Creating a filtered dataset takes agreement from both sides: form.update on
  the source form, and project.update on the destination project. Ending one,
  and reading what it exposes, takes either.

  That asymmetry is deliberate. Deleting a dataset only ever takes access
  away, so it cannot be used to reach anything, and a form's administrator has
  to be able to stop their form being served into a project they hold no
  rights in. Before this they could not: the delete demanded the destination's
  project.update as well, so the only remedy left was to delete or unpublish
  the form itself, which is not a proportionate answer to "stop sharing this".

  Reading the definition follows the same rule for a plainer reason. Deciding
  whether to revoke means seeing which columns and which filters are exposed,
  and the source form's administrator can already read every one of those
  values at the source. Withholding it from them protects nothing and leaves
  the decision uninformed.

  Editing still takes both sides, because an edit can widen a share as easily
  as narrow it, and widening somebody else's dataset is not revocation.
  */
  const filteredDatasetSide = async (container, project, dataset, auth) => {
    if (await auth.can('project.update', project)) return 'destination';
    const form = await container.Forms
      .getByProjectAndXmlFormId(dataset.sourceProjectId, dataset.xmlFormId, Form.PublishedVersion)
      .then(getOrNotFound);
    return (await auth.can('form.update', form)) ? 'source' : null;
  };

  // The shares of one form: every filtered dataset built on it, wherever it
  // serves. A share you cannot see is a share you cannot end, so this is the
  // half of revocation that is not the delete button -- the source side had no
  // way to find out that a dataset of their form existed at all.
  service.get('/projects/:projectId/forms/:xmlFormId/filtered-datasets', endpoint(async (container, { params, auth }) => {
    const form = await container.Forms
      .getByProjectAndXmlFormId(params.projectId, params.xmlFormId, Form.PublishedVersion)
      .then(getOrNotFound);
    // The same right that authorises creating one. Anything weaker and this
    // becomes a way to learn which projects hold a given form's data.
    await auth.canOrReject('form.update', form);

    // Counts rather than the column and filter lists themselves: this is a
    // list to act from, and the definition route serves the detail to the
    // same people.
    return container.db.any(sql`
      select d.id, d.name, d."projectId", d."createdAt", d."updatedAt",
        jsonb_array_length(d.columns) as "columnCount",
        jsonb_array_length(d.query) as "filterCount",
        p.name as "projectName",
        actors."displayName" as "createdBy"
      from field_data_filtered_datasets d
      join projects p on p.id = d."projectId"
      left join actors on actors.id = d."createdBy"
      where d."formId" = ${form.id}
      order by d."createdAt" desc`);
  }));

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
    const dataset = await filteredDatasetRecord(container, project.id, id).then(getOrNotFound);
    return publicFilteredDataset(dataset);
  }));

  service.get('/projects/:projectId/filtered-datasets/:id/definition', endpoint(async (container, { params, auth }) => {
    const id = Number.parseInt(params.id, 10);
    if (!Number.isInteger(id)) return reject(Problem.user.notFound());
    const project = await container.Projects.getById(params.projectId).then(getOrNotFound);
    const dataset = await filteredDatasetRecord(container, project.id, id).then(getOrNotFound);
    const side = await filteredDatasetSide(container, project, dataset, auth);
    // notFound rather than a refusal: to somebody with a stake in neither side
    // this dataset does not exist, and answering otherwise would turn the
    // route into a way to test which ids are real.
    if (side == null) return reject(Problem.user.notFound());
    return dataset;
  }));

  service.patch('/projects/:projectId/filtered-datasets/:id', endpoint(async (container, { params, body, auth }) => {
    const id = Number.parseInt(params.id, 10);
    if (!Number.isInteger(id)) return reject(Problem.user.notFound());
    const project = await container.Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('project.update', project);
    const dataset = await filteredDatasetRecord(container, project.id, id).then(getOrNotFound);
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
    const dataset = await filteredDatasetRecord(container, project.id, id).then(getOrNotFound);
    const side = await filteredDatasetSide(container, project, dataset, auth);
    if (side == null) return reject(Problem.user.notFound());

    // Widgets built on this dataset go with it, by the ON DELETE CASCADE on
    // field_data_widgets."filteredDatasetId". That matters here: a widget
    // reads its dataset's rows through its filter, so a chart left behind
    // would be a chart of a share somebody just revoked.
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
    const dataset = await filteredDatasetRecord(container, project.id, id).then(getOrNotFound);
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

  const exportFilteredDataset = async (container, params, auth, response, format) => {
    const id = Number.parseInt(params.id, 10);
    if (!Number.isInteger(id)) return reject(Problem.user.notFound());
    const project = await container.Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('project.read', project);
    await auth.canOrReject('submission.list', project);
    await auth.canOrReject('submission.read', project);
    // Resolve through the same source abstraction XLS Reports use. It applies
    // the saved filters, returns only visible columns, and fails closed when a
    // republished Form removed a filter field.
    const source = await resolveReportSource(container.db, {
      projectId: project.id, formId: null, filteredDatasetId: id, mergedDatasetId: null
    });
    if (source == null) return reject(Problem.user.notFound());
    if (!source.definition.usable) {
      throw Problem.user.unexpectedValue({
        field: 'dataset', value: id,
        reason: 'the dataset cannot be exported because its source Form fields changed'
      });
    }
    const rows = await rowsForSource(container.db, source);
    if (rows.length > MAX_REPORT_ROWS) {
      throw Problem.user.unexpectedValue({
        field: 'dataset', value: id,
        reason: `the dataset has more than ${MAX_REPORT_ROWS.toLocaleString('en')} rows; add filters before exporting it`
      });
    }
    const base = String(source.name || `filtered-dataset-${id}`)
      .replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || `filtered-dataset-${id}`;
    response.set('Content-Disposition', contentDisposition(`${base}.${format}`));
    if (format === 'csv') {
      response.set('Content-Type', CSV_MIME);
      return csvExport(source, rows);
    }
    response.set('Content-Type', XLSX_MIME);
    return xlsxExport(source, rows);
  };

  service.get('/projects/:projectId/filtered-datasets/:id/export.csv',
    endpoint((container, { params, auth }, _, response) =>
      exportFilteredDataset(container, params, auth, response, 'csv')));

  service.get('/projects/:projectId/filtered-datasets/:id/export.xlsx',
    endpoint((container, { params, auth }, _, response) =>
      exportFilteredDataset(container, params, auth, response, 'xlsx')));


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
      const dataset = await filteredDatasetRecord(container, project.id, datasetId)
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
        .filter(fieldPath => fieldPath != null && !byPath.has(fieldPath));
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
    const existing = await container.maybeOne(sql`
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
  // ORGANIZATIONS
  //
  // A tenant above the project. There is no permission logic here: an
  // organization is an actee, a project it owns has that actee as its parent,
  // and Central's can() already walks that parent chain. Every route below
  // either reads a table or grants a role the existing way.

  const organizationBySlug = (container, slug) => container.maybeOne(sql`
    select * from field_data_organizations where slug = ${slug}`);

  const organizationOrProblem = (body) => {
    try {
      return normalizeOrganization(body);
    } catch (error) {
      if (error.field != null) {
        throw Problem.user.unexpectedValue({
          field: error.field, value: error.value, reason: error.reason
        });
      }
      throw error;
    }
  };

  /*
  An organization is an actee, so authority over one is an ordinary can()
  question with the organization row as the target -- can() reads
  `actee.acteeId || actee`, and the row carries `acteeId`.

  This is not a second permission path beside the site-wide one. The migration
  gave the 'organization' species actee a species of '*', so a site
  administrator's grant on '*' reaches every organization through the same
  recursive walk that answers for everybody else. One query, two kinds of
  caller.

  The three verbs the owner role carries -- organization.read,
  organization.update, organization.member.manage -- are checked here and
  nowhere else. Until they were, the role promised in the interface to run the
  organization and its members while every route still demanded the site-wide
  config right, so only administrators could do any of it.
  */
  const organizationRole = (container) => container.Roles.getBySystemName('owner')
    .then(getOrNotFound);

  // What this caller may do with one organization, said plainly, because the
  // interface can no longer work it out from a site-wide permission that no
  // longer decides it. verbsOn answers the whole question in one query rather
  // than one per verb.
  const organizationRights = (verbs) => ({
    canRead: verbs.includes('organization.read'),
    canUpdate: verbs.includes('organization.update'),
    canManageMembers: verbs.includes('organization.member.manage')
  });

  service.get('/field-data/organization-roles', endpoint(async (container, { auth }) => {
    // Four names and a sentence each, and the person choosing a role for
    // somebody needs it. Any signed-in actor may read it; there is nothing in
    // here about any particular organization.
    if (!auth.isAuthenticated) return reject(Problem.user.insufficientRights());
    return describeRoles();
  }));

  service.get('/field-data/organizations', endpoint(async (container, { auth }) => {
    const all = await container.db.any(sql`
      select o.*, count(op."projectId")::integer as "projectCount"
      from field_data_organizations o
      left join field_data_organization_projects op on op."organizationId" = o.id
      group by o.id
      order by o."archivedAt" nulls first, o.name`);

    // The organizations this caller may read, which for a site administrator
    // is all of them and for an owner is their own. Asked one at a time rather
    // than compiled into the query, because a second expression of "who may
    // see what" is how one tenant ends up reading another's.
    const rights = await Promise.all(all.map(org =>
      auth.verbsOn(org).then(organizationRights)));
    return all
      .map((org, index) => ({ ...org, ...rights[index] }))
      .filter(org => org.canRead);
  }));

  service.post('/field-data/organizations', endpoint(async (container, { body, auth }) => {
    // Creating a tenant stays site-wide: there is no organization yet to be an
    // owner of, and a new top-level container is not something one tenant
    // should be able to conjure inside another's deployment.
    await auth.canOrReject('config.set', Config.species);
    const { name, slug } = organizationOrProblem(body);

    // Provisioned through Actees so the row looks exactly like every other
    // actee, including its species, rather than being a special case.
    const actee = await container.Actees.provision('organization');
    const created = await container.db.one(sql`
      insert into field_data_organizations (name, slug, "acteeId", "createdBy")
      values (${name}, ${slug}, ${actee.id}, ${auth.actor.map(a => a.id).orNull()})
      returning *`).catch(postgresErrorToProblem);

    // The creator owns what they created. Without this an organization arrives
    // with nobody able to administer it but a site administrator, which is the
    // state this whole change exists to end.
    if (auth.actor.isDefined()) {
      await container.Assignments.grant(auth.actor.get(), await organizationRole(container),
        { acteeId: created.acteeId });
    }
    return created;
  }));

  service.get('/field-data/organizations/:slug', endpoint(async (container, { params, auth }) => {
    const org = await organizationBySlug(container, params.slug).then(getOrNotFound);
    await auth.canOrReject('organization.read', org);
    const projects = await container.db.any(sql`
      select p.id, p.name from field_data_organization_projects op
      join projects p on p.id = op."projectId"
      where op."organizationId" = ${org.id} order by p.name`);
    return { ...org, projects, ...organizationRights(await auth.verbsOn(org)) };
  }));

  service.patch('/field-data/organizations/:slug', endpoint(async (container, { params, body, auth }) => {
    const org = await organizationBySlug(container, params.slug).then(getOrNotFound);
    await auth.canOrReject('organization.update', org);

    // Archived, never deleted. An organization owns projects that hold
    // submissions, and a delete button beside that is an accident waiting.
    const archivedAt = body?.archived === undefined
      ? org.archivedAt
      : (body.archived === true ? new Date() : null);
    const name = body?.name == null ? org.name : organizationOrProblem(body).name;

    return container.db.one(sql`
      update field_data_organizations
      set name = ${name}, "archivedAt" = ${archivedAt}
      where id = ${org.id} returning *`).catch(postgresErrorToProblem);
  }));

  // Adopting a project is the whole mechanism: point its actee at the
  // organization and every grant on the organization reaches it. Nothing is
  // taken away by this -- a project actee's parent was null, and null implies
  // no actee -- so a grant somebody already held survives untouched.
  service.post('/field-data/organizations/:slug/projects', endpoint(async (container, { params, body, auth }) => {
    const org = await organizationBySlug(container, params.slug).then(getOrNotFound);
    await auth.canOrReject('organization.update', org);
    const project = await container.Projects.getById(body?.projectId).then(getOrNotFound);
    // Moving a project between tenants changes who can read it, so it takes
    // authority over the project and not only over the organization. Holding
    // both is not a way to gain anything: project.update comes with the
    // manager verbs, assignment.create among them, so somebody who can adopt a
    // project could already have granted those same people a role on it
    // directly. What adopting saves is the doing of it one by one.
    await auth.canOrReject('project.update', project);

    await container.db.query(sql`
      insert into field_data_organization_projects ("organizationId", "projectId")
      values (${org.id}, ${project.id})
      on conflict ("projectId") do update set "organizationId" = excluded."organizationId"`);
    await container.db.query(sql`
      update actees set parent = ${org.acteeId} where id = ${project.acteeId}`);
    return success();
  }));

  service.delete('/field-data/organizations/:slug/projects/:projectId', endpoint(async (container, { params, auth }) => {
    const org = await organizationBySlug(container, params.slug).then(getOrNotFound);
    await auth.canOrReject('organization.update', org);
    const project = await container.Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('project.update', project);

    await container.db.query(sql`
      delete from field_data_organization_projects
      where "organizationId" = ${org.id} and "projectId" = ${project.id}`);
    // Releasing the project returns its actee to having no parent, which is
    // what it was before any organization existed.
    await container.db.query(sql`
      update actees set parent = null
      where id = ${project.acteeId} and parent = ${org.acteeId}`);
    return success();
  }));

  service.get('/field-data/organizations/:slug/members', endpoint(async (container, { params, auth }) => {
    const org = await organizationBySlug(container, params.slug).then(getOrNotFound);
    await auth.canOrReject('organization.read', org);
    return container.db.any(sql`
      select actors.id as "actorId", actors."displayName", users.email,
        roles.system as "roleSystem", roles.name as "roleName"
      from assignments
      join actors on actors.id = assignments."actorId"
      left join users on users."actorId" = actors.id
      join roles on roles.id = assignments."roleId"
      where assignments."acteeId" = ${org.acteeId}
      order by actors."displayName"`);
  }));

  service.post('/field-data/organizations/:slug/members', endpoint(async (container, { params, body, auth }) => {
    const org = await organizationBySlug(container, params.slug).then(getOrNotFound);
    await auth.canOrReject('organization.member.manage', org);
    let mapped;
    try {
      mapped = roleForOrganization(body?.role);
    } catch (error) {
      return reject(Problem.user.unexpectedValue({
        field: error.field, value: error.value, reason: error.reason
      }));
    }

    const actorId = Number.parseInt(body?.actorId, 10);
    if (!Number.isInteger(actorId)) return reject(Problem.user.notFound());
    const actor = await container.Actors.getById(actorId).then(getOrNotFound);
    const role = await container.Roles.getBySystemName(mapped.system).then(getOrNotFound);

    // Nobody hands out more than they hold. canAssignRole is Central's own
    // check -- it asks whether the caller has every verb of the role being
    // granted, on this actee -- and using it rather than writing a rule here
    // is what keeps an organization owner from being a way around the site's
    // own answer to that question.
    //
    // One consequence worth knowing: the owner role's verbs were copied from
    // manager when 20260920-05 ran. If a later upstream migration adds a verb
    // to manager without adding it to owner, an owner stops being able to
    // grant the manager role, because they would no longer hold all of it.
    // That fails closed, which is the right direction, but it will read as a
    // puzzling refusal until somebody re-syncs the two.
    if (!(await auth.canAssignRole(role, { acteeId: org.acteeId })))
      return reject(Problem.user.insufficientRights());

    // Granted the ordinary way, on the organization's actee. One role per
    // person per organization: two would leave "what can they do" with two
    // answers and no way to revoke the one you meant.
    await container.db.query(sql`
      delete from assignments
      where "actorId" = ${actor.id} and "acteeId" = ${org.acteeId}`);
    await container.Assignments.grant(actor, role, { acteeId: org.acteeId });
    return success();
  }));

  service.delete('/field-data/organizations/:slug/members/:actorId', endpoint(async (container, { params, auth }) => {
    const org = await organizationBySlug(container, params.slug).then(getOrNotFound);
    await auth.canOrReject('organization.member.manage', org);
    const actorId = Number.parseInt(params.actorId, 10);
    if (!Number.isInteger(actorId)) return reject(Problem.user.notFound());

    // Removing the last owner leaves an organization only a site administrator
    // can administer, and the person who does it is usually removing
    // themselves. Refused with the remedy in the message rather than done and
    // regretted. A site administrator is the escape hatch, so they are not
    // stopped -- blocking the people who would have to fix it is the one way
    // this guard could do harm.
    const owner = await organizationRole(container);
    const remaining = await container.db.oneFirst(sql`
      select count(*)::integer from assignments
      where "acteeId" = ${org.acteeId} and "roleId" = ${owner.id}
        and "actorId" <> ${actorId}`);
    const isRemovingAnOwner = await container.db.oneFirst(sql`
      select count(*)::integer from assignments
      where "acteeId" = ${org.acteeId} and "roleId" = ${owner.id}
        and "actorId" = ${actorId}`) > 0;
    if (isRemovingAnOwner && remaining === 0
      && !(await auth.can('config.set', Config.species))) {
      return reject(Problem.user.unexpectedValue({
        field: 'actorId', value: actorId,
        reason: 'this is the organization\'s only owner. Give somebody else the owner role first, or the organization would be left with nobody able to administer it.'
      }));
    }

    // Only the grants made through this organization. A person may also hold
    // a grant directly on one of its projects, and removing them from the
    // organization is not a statement about that.
    await container.db.query(sql`
      delete from assignments
      where "actorId" = ${actorId} and "acteeId" = ${org.acteeId}`);
    return success();
  }));

  ////////////////////////////////////////////////////////////////////////////////
  // MERGED DATASETS

  // The floor, not the ceiling: read permission on every source form. Anything
  // less turns a merge into a way to read a form you were not given.
  const mergedSourceForms = async (container, projectId, xmlFormIds, auth) => {
    if (!Array.isArray(xmlFormIds) || xmlFormIds.length < 2)
      return reject(Problem.user.unexpectedValue({
        field: 'xmlFormIds', value: xmlFormIds,
        reason: 'a merged dataset needs at least two forms'
      }));
    if (new Set(xmlFormIds).size !== xmlFormIds.length)
      return reject(Problem.user.unexpectedValue({
        field: 'xmlFormIds', value: xmlFormIds, reason: 'must not list a form twice'
      }));

    const forms = [];
    for (const xmlFormId of xmlFormIds) {
      // eslint-disable-next-line no-await-in-loop
      const form = await container.Forms
        .getByProjectAndXmlFormId(projectId, String(xmlFormId), Form.PublishedVersion)
        .then(getOrNotFound);
      // eslint-disable-next-line no-await-in-loop
      await auth.canOrReject('submission.list', form);
      // eslint-disable-next-line no-await-in-loop
      await auth.canOrReject('submission.read', form);
      forms.push({ formId: form.id, xmlFormId: form.xmlFormId, currentDefId: form.currentDefId });
    }
    return forms;
  };

  const readMergedDataset = async (container, params, auth) => {
    const id = Number.parseInt(params.id, 10);
    if (!Number.isInteger(id)) return reject(Problem.user.notFound());
    const project = await container.Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('project.read', project);
    const dataset = await mergedDatasetRecord(container, project.id, id).then(getOrNotFound);
    const forms = await mergedDatasetForms(container.db, dataset.id);
    // Permission is re-checked on read, not only at creation: a grant can be
    // withdrawn after a merge is saved, and the merge must not outlive it.
    await mergedSourceForms(container, project.id, forms.map(f => f.xmlFormId), auth);
    return { project, dataset, forms };
  };

  service.post('/projects/:projectId/merged-datasets', endpoint(async (container, { params, body, auth }) => {
    const project = await container.Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('project.update', project);
    const forms = await mergedSourceForms(container, project.id, body?.xmlFormIds, auth);

    const name = String(body?.name ?? '').trim().slice(0, 255);
    if (name === '') throw Problem.user.missingParameter({ field: 'name' });

    const created = await container.db.one(sql`
      insert into field_data_merged_datasets (name, "projectId", "createdBy")
      values (${name}, ${project.id}, ${auth.actor.map(actor => actor.id).orNull()})
      returning *`).catch(postgresErrorToProblem);
    for (const form of forms) {
      // eslint-disable-next-line no-await-in-loop
      await container.db.query(sql`
        insert into field_data_merged_dataset_forms ("mergedDatasetId", "formId")
        values (${created.id}, ${form.formId})`);
    }

    const shape = await mergedDatasetShape(container.db, forms);
    return {
      ...created,
      forms: forms.map(form => form.xmlFormId),
      fields: shape.merged,
      excluded: shape.excluded
    };
  }));

  service.get('/projects/:projectId/merged-datasets', endpoint(async (container, { params, auth }) => {
    const project = await container.Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('project.read', project);
    await auth.canOrReject('submission.list', project);
    return container.db.any(sql`
      select d.*, count(mf."formId")::integer as "formCount"
      from field_data_merged_datasets d
      left join field_data_merged_dataset_forms mf on mf."mergedDatasetId" = d.id
      where d."projectId" = ${project.id}
      group by d.id order by d."createdAt" desc`);
  }));

  // The detail route is where somebody decides whether to trust the merge, so
  // it carries what was left out and why, not just what went in.
  service.get('/projects/:projectId/merged-datasets/:id', endpoint(async (container, { params, query, auth }) => {
    const { dataset, forms } = await readMergedDataset(container, params, auth);
    const shape = await mergedDatasetShape(container.db, forms);
    const coding = query.coding === 'true'
      ? await mergedDatasetCoding(container.db, shape.forms, shape.merged)
      : null;
    return {
      ...dataset,
      forms: forms.map(form => ({
        xmlFormId: form.xmlFormId, name: form.formName ?? form.xmlFormId
      })),
      fields: shape.merged,
      excluded: shape.excluded,
      coding
    };
  }));

  service.delete('/projects/:projectId/merged-datasets/:id', endpoint(async (container, { params, auth }) => {
    const id = Number.parseInt(params.id, 10);
    if (!Number.isInteger(id)) return reject(Problem.user.notFound());
    const project = await container.Projects.getById(params.projectId).then(getOrNotFound);
    await auth.canOrReject('project.update', project);
    const dataset = await mergedDatasetRecord(container, project.id, id).then(getOrNotFound);
    await container.db.query(sql`
      delete from field_data_merged_datasets where id = ${dataset.id}`);
    return success();
  }));

  service.get('/projects/:projectId/merged-datasets/:id/data', endpoint(async (container, { params, query, auth }) => {
    const { forms } = await readMergedDataset(container, params, auth);
    const shape = await mergedDatasetShape(container.db, forms);
    const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 50, 1), 200);
    const offset = Math.max(Number.parseInt(query.offset, 10) || 0, 0);

    // No shared fields is a real answer, not an error: these forms have
    // nothing in common worth putting in a table.
    if (shape.merged.length === 0)
      return { total: 0, limit, offset, fields: [], excluded: shape.excluded, data: [] };

    const union = mergedDatasetRows(shape.forms, shape.merged);
    const total = await container.db.oneFirst(sql`
      select count(*)::integer from (${union}) as merged`);
    const rows = total === 0 ? [] : await container.db.any(sql`
      select "sourceForm", "instanceId",
        ${projectObject(shape.merged.map(field => field.path))} as data
      from (${union}) as merged
      order by "createdAt" desc, "instanceId"
      limit ${limit} offset ${offset}`);

    return {
      total,
      limit,
      offset,
      fields: shape.merged,
      excluded: shape.excluded,
      // Which form each row came from, so a reader is never looking at a
      // pooled table wondering where a number originated.
      data: rows.map(row => ({
        sourceForm: row.sourceForm, instanceId: row.instanceId, ...row.data
      }))
    };
  }));

  ////////////////////////////////////////////////////////////////////////////////
  // XLS REPORTS
  //
  // Templates belong to one Project and exactly one data source. Project-level
  // rights are intentional: a report can contain every row its source exposes,
  // so it must never become a shortcut around submission.read.

  const reportProject = async (container, projectId, auth, write = false) => {
    const project = await container.Projects.getById(projectId).then(getOrNotFound);
    await auth.canOrReject('project.read', project);
    await auth.canOrReject('submission.list', project);
    await auth.canOrReject('submission.read', project);
    if (write) await auth.canOrReject('project.update', project);
    return project;
  };

  const reportTemplate = (container, projectId, templateId) => container.maybeOne(sql`
    select * from field_data_xls_report_templates
    where id=${intParam(templateId)} and "projectId"=${intParam(projectId)}`);

  const publicReportTemplates = async (db, projectId) => {
    const templates = await db.any(sql`
      select t.id, t.name, t.filename, t."sizeBytes", t.placeholders,
        t."formId", t."filteredDatasetId", t."mergedDatasetId",
        t."createdAt", t."updatedAt",
        coalesce(fd.name, f."xmlFormId", filtered.name, merged.name) as "sourceName",
        case when t."formId" is not null then 'form'
          when t."filteredDatasetId" is not null then 'filtered' else 'merged' end as "sourceType"
      from field_data_xls_report_templates t
      left join forms f on f.id=t."formId"
      left join form_defs fd on fd.id=f."currentDefId"
      left join field_data_filtered_datasets filtered on filtered.id=t."filteredDatasetId"
      left join field_data_merged_datasets merged on merged.id=t."mergedDatasetId"
      where t."projectId"=${projectId}
      order by t."createdAt" desc`);
    if (templates.length === 0) return [];
    const runs = await db.any(sql`
      select id, "templateId", status, "sizeBytes", "rowCount", error,
        "createdAt", "startedAt", "completedAt", downloadable
      from (
        select id, "templateId", status, "sizeBytes", "rowCount", error,
          "createdAt", "startedAt", "completedAt",
          (status='Success' and "storageKey" is not null) as downloadable,
          row_number() over (partition by "templateId" order by "createdAt" desc) as position
        from field_data_xls_report_runs
        where "templateId" in (${sql.join(templates.map(row => row.id), sql`,`)})
      ) ranked where position <= 10
      order by "createdAt" desc`);
    return templates.map(template => ({
      ...template,
      runs: runs.filter(run => run.templateId === template.id)
    }));
  };

  service.get('/projects/:projectId/xls-report-sources', endpoint(async (container, { params, auth }) => {
    const project = await reportProject(container, params.projectId, auth);
    const [forms, filtered, merged] = await Promise.all([
      container.db.any(sql`
        select f.id, coalesce(fd.name, f."xmlFormId") as name, f."xmlFormId"
        from forms f left join form_defs fd on fd.id=f."currentDefId"
        where f."projectId"=${project.id} and f."deletedAt" is null
          and f."currentDefId" is not null order by name`),
      container.db.any(sql`
        select id, name from field_data_filtered_datasets
        where "projectId"=${project.id} order by name`),
      container.db.any(sql`
        select id, name from field_data_merged_datasets
        where "projectId"=${project.id} order by name`)
    ]);
    return { forms, filtered, merged };
  }));

  service.get('/projects/:projectId/xls-report-templates', endpoint(async (container, { params, auth }) => {
    const project = await reportProject(container, params.projectId, auth);
    return publicReportTemplates(container.db, project.id);
  }));

  service.post('/projects/:projectId/xls-report-templates', upload.single('file'), uploadErrorHandler,
    endpoint(async (container, { params, auth }, request) => {
      const project = await reportProject(container, params.projectId, auth, true);
      const { file } = request;
      if (file == null) return reject(Problem.user.missingMultipartField({ field: 'file' }));
      if (file.size > MAX_TEMPLATE_BYTES || path.extname(file.originalname).toLowerCase() !== '.xlsx')
        return reject(Problem.user.unexpectedValue({
          field: 'file', value: file.originalname,
          reason: 'choose an .xlsx workbook no larger than 10 MB'
        }));

      const name = String(request.body?.name ?? '').trim().slice(0, 255);
      if (name === '') throw Problem.user.missingParameter({ field: 'name' });
      const columns = reportSourceColumns(request.body?.sourceType, request.body?.sourceId);
      const source = await resolveReportSource(container.db, { projectId: project.id, ...columns });
      if (source == null) return reject(Problem.user.notFound());
      let inspection;
      try {
        inspection = validateTemplate(await inspectTemplate(file.buffer), source.fields);
      } catch (error) {
        return reject(xlsProblem(error));
      }

      const storageKey = `xls-reports/templates/${crypto.randomUUID()}.xlsx`;
      await storage.putBuffer(storageKey, file.buffer, { 'Content-Type': MIME_TYPE });
      try {
        await container.db.one(sql`
          insert into field_data_xls_report_templates
            (name, "projectId", "formId", "filteredDatasetId", "mergedDatasetId",
              "storageKey", filename, "sizeBytes", placeholders, "createdBy")
          values (${name}, ${project.id}, ${columns.formId}, ${columns.filteredDatasetId},
            ${columns.mergedDatasetId}, ${storageKey}, ${path.basename(file.originalname)},
            ${file.size}, ${JSON.stringify(inspection.placeholders.map(row => row.token))},
            ${auth.actor.map(actor => actor.id).orNull()}) returning id`);
      } catch (error) {
        await storage.delete(storageKey);
        throw error;
      }
      return publicReportTemplates(container.db, project.id);
    }));

  service.get('/projects/:projectId/xls-report-templates/:id/download', endpoint(async (container, { params, auth }, _, response) => {
    await reportProject(container, params.projectId, auth);
    const template = await reportTemplate(container, params.projectId, params.id).then(getOrNotFound);
    response.set('Content-Disposition', contentDisposition(template.filename));
    response.set('Content-Type', MIME_TYPE);
    return storage.getStream(template.storageKey);
  }));

  service.delete('/projects/:projectId/xls-report-templates/:id', endpoint(async (container, { params, auth }) => {
    await reportProject(container, params.projectId, auth, true);
    const template = await reportTemplate(container, params.projectId, params.id).then(getOrNotFound);
    const keys = await container.db.any(sql`
      select "storageKey" from field_data_xls_report_runs
      where "templateId"=${template.id} and "storageKey" is not null`);
    await storage.delete(template.storageKey);
    for (const row of keys) {
      // eslint-disable-next-line no-await-in-loop
      await storage.delete(row.storageKey);
    }
    await container.db.query(sql`
      delete from field_data_xls_report_templates where id=${template.id}`);
    return success();
  }));

  service.post('/projects/:projectId/xls-report-templates/:id/runs', endpoint(async (container, { params, auth }, _, response) => {
    await reportProject(container, params.projectId, auth);
    const template = await reportTemplate(container, params.projectId, params.id).then(getOrNotFound);
    await container.db.query(sql`select pg_advisory_xact_lock(74126, ${template.id})`);
    const existing = await container.db.maybeOne(sql`
      select * from field_data_xls_report_runs
      where "templateId"=${template.id} and status in ('Pending', 'Running')
      order by id desc limit 1`);
    response.status(202);
    if (existing != null) return existing;
    return container.db.one(sql`
      insert into field_data_xls_report_runs ("templateId", "requestedBy")
      values (${template.id}, ${auth.actor.map(actor => actor.id).orNull()}) returning *`);
  }));

  service.post('/projects/:projectId/xls-report-templates/:id/runs/:runId/cancel', endpoint(async (container, { params, auth }) => {
    await reportProject(container, params.projectId, auth);
    const template = await reportTemplate(container, params.projectId, params.id).then(getOrNotFound);
    return container.db.maybeOne(sql`
      update field_data_xls_report_runs set status='Cancelled', "completedAt"=clock_timestamp()
      where id=${intParam(params.runId)} and "templateId"=${template.id}
        and status in ('Pending', 'Running') returning *`).then(getOrNotFound);
  }));

  service.get('/projects/:projectId/xls-report-templates/:id/runs/:runId/download', endpoint(async (container, { params, auth }, _, response) => {
    await reportProject(container, params.projectId, auth);
    const template = await reportTemplate(container, params.projectId, params.id).then(getOrNotFound);
    const run = await container.db.maybeOne(sql`
      select * from field_data_xls_report_runs
      where id=${intParam(params.runId)} and "templateId"=${template.id}
        and status='Success' and "storageKey" is not null`).then(getOrNotFound);
    const base = path.basename(template.filename, '.xlsx').replace(/[^A-Za-z0-9_.-]+/g, '-');
    response.set('Content-Disposition', contentDisposition(`${base}-report-${run.id}.xlsx`));
    response.set('Content-Type', MIME_TYPE);
    return storage.getStream(run.storageKey);
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
    'data-error', // the data was wrong and has been or will be corrected
    'explained', // there is an ordinary explanation
    'unresolved', // looked at, still not understood
    'substantiated' // an authorised process established misconduct
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
    const { Projects, db } = container;

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
  // Only aggregates go through a share. There is no individual submission in
  // it, no attachment and no submitter's name -- and the answer charts carry a
  // minimum count per value (SHARED_MIN_VALUE_COUNT below), because a bar of
  // height one is one household's answer whatever the chart around it says.
  //
  // The token is a credential, so the database keeps only its SHA-256. A
  // reader of the table cannot use what they find; the usable token is
  // returned once, at creation, and never again.

  // How many submissions must give an answer before that answer is shown to
  // somebody with no account. Five is the usual floor for published tabulations
  // and is low enough that a real district breakdown still draws.
  const SHARED_MIN_VALUE_COUNT = 5;

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
      where id = ${intParam(params.id)} and "formId" = ${form.id} and "revokedAt" is null
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

    // The floor that keeps a public chart an aggregate. See summarizeForm.
    const summary = await summarizeForm(container.db, share.formId,
      { minValueCount: SHARED_MIN_VALUE_COUNT });
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
    const { Forms, db } = container;

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
  // ACROSS EVERY PROJECT
  //
  // A form lives in a project and a submission lives in a form, so the API
  // could only ever be asked about one project at a time. That is fine until
  // somebody runs eight of them and wants to know which forms have gone quiet,
  // or to work through everything flagged this week without opening each form
  // in turn.

  // Every form the actor may list, from every project, with the counts the
  // list is sorted and triaged by. Counted in the database: totalling the
  // OData feed instead would describe whatever the client managed to download.
  service.get('/field-data/forms', endpoint(async (container, { auth }) => {
    const rows = await container.db.any(sql`
      ${visibleProjects(actorIdOf(auth), ['project.read', 'form.list'])}
      select p.id as "projectId", p.name as "projectName",
        f."xmlFormId", coalesce(fd.name, dd.name, f."xmlFormId") as name,
        f.state, fd.version,
        (f."currentDefId" is not null) as published,
        (f."draftDefId" is not null) as "hasDraft",
        coalesce(counts.submissions, 0) as submissions,
        counts."lastSubmission"
      from forms f
      join visible on visible.id = f."projectId"
      join projects p on p.id = f."projectId"
      left join form_defs fd on fd.id = f."currentDefId"
      -- A Form with no published version still has a title, on its draft.
      -- Without this a draft lists under its xmlFormId, which is a slug.
      left join form_defs dd on dd.id = f."draftDefId"
      left join lateral (
        select count(*)::integer as submissions, max(s."createdAt") as "lastSubmission"
        from submissions s
        where s."formId" = f.id and s."deletedAt" is null and s.draft = false
      ) as counts on true
      where f."deletedAt" is null
      order by counts."lastSubmission" desc nulls last, p.name asc, name asc`);
    return { forms: rows, total: rows.length };
  }));

  // Every submission the actor may read, from every form, newest first. Paged,
  // because a programme of any size has more of these than a page can hold,
  // and the filters are the ones somebody triaging actually reaches for.
  service.get('/field-data/submissions', endpoint(async (container, { auth, query }) => {
    const limit = Math.min(Math.max(intParam(query.limit ?? '100'), 1), 500);
    const offset = Math.max(intParam(query.offset ?? '0'), 0);

    const conditions = [sql`s."deletedAt" is null`, sql`s.draft = false`,
      sql`f."deletedAt" is null`];
    if (query.projectId != null)
      conditions.push(sql`p.id = ${intParam(query.projectId)}`);
    if (query.xmlFormId != null)
      conditions.push(sql`f."xmlFormId" = ${query.xmlFormId}`);
    if (query.reviewState != null) {
      // 'received' is the absence of a review state rather than a value, which
      // is why filtering on it cannot be a plain equality.
      conditions.push(query.reviewState === 'received'
        ? sql`s."reviewState" is null`
        : sql`s."reviewState" = ${query.reviewState}`);
    }
    if (query.since != null) conditions.push(sql`s."createdAt" >= ${query.since}`);
    const where = sql.join(conditions, sql` and `);

    const from = sql`
      from submissions s
      join forms f on f.id = s."formId"
      join visible on visible.id = f."projectId"
      join projects p on p.id = f."projectId"
      left join form_defs fd on fd.id = f."currentDefId"
      left join actors submitter on submitter.id = s."submitterId"
      where ${where}`;

    const prefix = visibleProjects(actorIdOf(auth),
      ['project.read', 'submission.list', 'submission.read']);
    const total = await container.db.oneFirst(sql`
      ${prefix} select count(*)::integer ${from}`);
    const submissions = await container.db.any(sql`
      ${prefix}
      select s."instanceId", s."createdAt", s."updatedAt",
        coalesce(s."reviewState", 'received') as "reviewState",
        submitter."displayName" as "submitterName",
        p.id as "projectId", p.name as "projectName",
        f."xmlFormId", coalesce(fd.name, f."xmlFormId") as "formName"
      ${from}
      order by s."createdAt" desc, s.id desc
      limit ${limit} offset ${offset}`);
    return { total, limit, offset, submissions };
  }));

  // Where collection is happening, across every Project at once. The per-Form
  // map answers this one Form at a time, which is no help when the question is
  // which district has gone quiet.
  //
  // The geometry comes from GeoExtracts, the same query the per-Form map uses,
  // rather than a second reading of the submission XML: the extraction knows
  // about repeat groups, edit lineages and its own cache, and a reimplementation
  // here would quietly disagree with the map people already trust.
  service.get('/field-data/map', endpoint(async (container, { auth, query }) => {
    const limit = Math.min(
      Math.max(intParam(query.limit ?? String(MAP_MAX_FEATURES)), 1),
      MAP_MAX_FEATURES
    );

    const conditions = [sql`f."deletedAt" is null`];
    if (query.projectId != null)
      conditions.push(sql`p.id = ${intParam(query.projectId)}`);
    if (query.xmlFormId != null)
      conditions.push(sql`f."xmlFormId" = ${query.xmlFormId}`);

    // Only Forms that have a default geo field and at least one Submission:
    // asking GeoExtracts about the rest returns an empty collection at the
    // cost of a query each.
    const forms = await container.db.any(sql`
      ${visibleProjects(actorIdOf(auth),
    ['project.read', 'form.list', 'submission.list', 'submission.read'])}
      select f.id, f."xmlFormId", coalesce(fd.name, f."xmlFormId") as "formName",
        p.id as "projectId", p.name as "projectName",
        count(s.*)::integer as submissions,
        max(s."createdAt") as "lastSubmission"
      from forms f
      join visible on visible.id = f."projectId"
      join projects p on p.id = f."projectId"
      join form_defs fd on fd.id = f."currentDefId"
      join submissions s on s."formId" = f.id
        and s."deletedAt" is null and s.draft = false
      where ${sql.join(conditions, sql` and `)}
        and exists (
          select 1 from form_field_geo g
          where g.formschema_id = fd."schemaId" and g.is_default
        )
      group by f.id, f."xmlFormId", fd.name, p.id, p.name
      order by max(s."createdAt") desc
      limit ${MAP_MAX_FORMS}`);

    const features = [];
    for (const form of forms) {
      if (features.length >= limit) break;
      // Deliberately serial: each Form's budget is what the ones before it
      // left, so there is nothing to run in parallel.
      // eslint-disable-next-line no-await-in-loop
      const collection = await container.GeoExtracts.getSubmissionFeatureCollectionGeoJson(
        form.id, query.$filter ?? null, [], limit - features.length
      );
      for (const feature of JSON.parse(collection).features) {
        features.push({
          ...feature,
          properties: {
            ...(feature.properties ?? {}),
            projectId: form.projectId,
            projectName: form.projectName,
            xmlFormId: form.xmlFormId,
            formName: form.formName
          }
        });
      }
    }

    return {
      type: 'FeatureCollection',
      features: features.slice(0, limit),
      // Filling the budget means there may be more, whether that happened
      // across several Forms or inside one: the page says it is showing the
      // first so many rather than implying it has drawn everything.
      truncated: features.length >= limit,
      forms: forms.map(({ id, ...rest }) => rest)
    };
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

    // Asked before the early return, because it decides the system status
    // block and an administrator with no projects should still get it.
    const isAdmin = await auth.can('user.list', User.species);

    if (projectIds.length === 0) {
      return {
        kpi: { projects: 0, forms: 0, submissions: 0, users: 0 },
        recentSubmissions: [],
        projects: [],
        submissionsTrend: [],
        topForms: [],
        // Was five hardcoded values claiming the database and storage were up
        // without having asked either. A probe or nothing.
        systemStatus: isAdmin ? await probeSystemStatus(dbPool) : null
      };
    }

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
      systemStatus: isAdmin ? await probeSystemStatus(dbPool) : null
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
    const mediaId = intParam(params.id);
    const record = await container.maybeOne(sql`
      select * from field_data_media where id = ${mediaId}
    `).then(getOrNotFound);

    if (record.storageKey) await storage.delete(record.storageKey);
    await container.db.query(sql`delete from field_data_media where id = ${mediaId}`);
    return success();
  }));

  service.get('/field-data/media/download/:id', endpoint(async (container, { params, auth }, _, response) => {
    await auth.canOrReject('project.create', Project.species);
    const record = await container.maybeOne(sql`
      select * from field_data_media where id = ${intParam(params.id)}
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
      select w.id, w.name, w.url, w.events, w.active, w."lastStatus", w."createdAt",
        w.target, w.config, w."formId", f."xmlFormId",
        (w.secret is not null and w.secret <> '') as "hasSecret"
      from field_data_webhooks w
      left join forms f on f.id = w."formId" and f."deletedAt" is null
      order by w."createdAt" desc`);
    return webhooks.map(webhook => ({
      ...webhook, config: redactConfig(webhook.target, webhook.config)
    }));
  }));

  // A Google Sheet must belong to one readable Form: its columns come from
  // that Form and site-wide delivery would mix unrelated questionnaires into
  // one worksheet. This small picker is administrator-only, like the rest of
  // integration configuration.
  service.get('/field-data/integration-forms', endpoint(async (container, { auth }) => {
    await auth.canOrReject('config.set', Config.species);
    return container.db.any(sql`
      select p.id as "projectId", p.name as "projectName", f."xmlFormId",
        coalesce(fd.name, f."xmlFormId") as "formName"
      from projects p
      join forms f on f."projectId" = p.id and f."deletedAt" is null
      join form_defs fd on fd.id = f."currentDefId"
      where p."deletedAt" is null
      order by p.name, fd.name, f."xmlFormId"`);
  }));

  service.post('/field-data/webhooks', endpoint(async (container, { body, auth }) => {
    await auth.canOrReject('config.set', Config.species);
    if (!body.name) return reject(Problem.user.missingParameter({ field: 'name' }));
    const normalized = targetOrProblem(body.target ?? 'json', body.config);
    const { target } = normalized;
    const deliveryUrl = target.managesUrl
      ? target.deliveryUrl(normalized.config)
      : body.url;
    if (!deliveryUrl) return reject(Problem.user.missingParameter({ field: 'url' }));
    await validWebhookUrl(deliveryUrl);
    // Generate a signing secret so receivers can verify the HMAC-SHA256
    // signature sent with each delivery (X-FieldData-Signature header).
    const events = target.submissionRows === true || target.submissionValues === true
      ? ['submission.create', ...((target.name !== 'google-sheets' || normalized.config.syncUpdates)
        ? ['submission.update.version'] : [])]
      : validateEvents(body.events === undefined ? [] : body.events);
    const storedConfig = sealConfig(target.name, normalized.config);

    // Scoping to a form takes permission on that form, not only the site-wide
    // config right: pointing a service at a form is a way to read it.
    let formId = null;
    let selectedForm = null;
    if (body.xmlFormId != null && body.projectId != null) {
      selectedForm = await container.Forms
        .getByProjectAndXmlFormId(body.projectId, body.xmlFormId, Form.PublishedVersion)
        .then(getOrNotFound);
      await auth.canOrReject('submission.list', selectedForm);
      await auth.canOrReject('submission.read', selectedForm);
      formId = selectedForm.id;
    }
    if (target.requiresForm && formId == null) {
      throw Problem.user.unexpectedValue({
        field: 'xmlFormId', value: body.xmlFormId,
        reason: 'choose the Form whose Submissions should be synchronized'
      });
    }
    if (typeof target.mappedPaths === 'function') {
      const available = new Set((await filteredDatasetFields(container.db, selectedForm))
        .map(field => field.path));
      const missing = target.mappedPaths(normalized.config)
        .filter(fieldPath => !available.has(fieldPath));
      if (missing.length !== 0) {
        throw Problem.user.unexpectedValue({
          field: 'config.mapping', value: '[redacted]',
          reason: `these paths do not exist in the selected Form: ${missing.join(', ')}`
        });
      }
    }

    const secret = target.signsDeliveries === false
      ? null
      : crypto.randomBytes(24).toString('hex');
    const created = await container.db.one(sql`
      insert into field_data_webhooks (name, url, events, secret, target, config, "formId")
      values (${body.name}, ${deliveryUrl}, ${JSON.stringify(events)},
        ${secret == null ? null : encryptSecret(secret)},
        ${target.name}, ${JSON.stringify(storedConfig)}, ${formId})
      returning *
    `);
    const sync = target.name === 'google-sheets' && normalized.config.sendExisting === true
      ? await enqueueGoogleSheetSync(container.db, created.id, formId)
      : null;
    const result = secret == null ? publicWebhook(created) : { ...publicWebhook(created), secret };
    return sync == null ? result : { ...result, sync };
  }));

  service.get('/field-data/webhook-targets', endpoint(async (container, { auth }) => {
    await auth.canOrReject('config.set', Config.species);
    return describeTargets();
  }));

  service.get('/field-data/webhooks/:id/deliveries', endpoint(async (container, { params, auth }) => {
    await auth.canOrReject('config.set', Config.species);
    return container.db.any(sql`
      select * from field_data_webhook_deliveries
      where "webhookId" = ${intParam(params.id)}
      order by "createdAt" desc
      limit 50
    `);
  }));

  service.get('/field-data/webhooks/:id/syncs', endpoint(async (container, { params, auth }) => {
    await auth.canOrReject('config.set', Config.species);
    const webhookId = intParam(params.id);
    await container.maybeOne(sql`
      select id from field_data_webhooks where id=${webhookId} and target='google-sheets'`)
      .then(getOrNotFound);
    return container.db.any(sql`
      select * from field_data_google_sheet_syncs where "webhookId"=${webhookId}
      order by id desc limit 10`);
  }));

  service.post('/field-data/webhooks/:id/syncs', endpoint(async (container, { params, auth }, _, response) => {
    await auth.canOrReject('config.set', Config.species);
    const webhookId = intParam(params.id);
    const webhook = await container.maybeOne(sql`
      select id, "formId" from field_data_webhooks
      where id=${webhookId} and target='google-sheets'`)
      .then(getOrNotFound);
    response.status(202);
    return enqueueGoogleSheetSync(container.db, webhook.id, webhook.formId);
  }));

  service.post('/field-data/webhooks/:id/syncs/:syncId/retry', endpoint(async (container, { params, auth }, _, response) => {
    await auth.canOrReject('config.set', Config.species);
    const webhookId = intParam(params.id);
    const syncId = intParam(params.syncId);
    const sync = await container.maybeOne(sql`
      select * from field_data_google_sheet_syncs
      where id=${syncId} and "webhookId"=${webhookId} and status in ('Partial', 'Failed')`)
      .then(getOrNotFound);
    await container.db.query(sql`
      update field_data_google_sheet_sync_items
      set status='Pending', error=null, "completedAt"=null
      where "syncId"=${sync.id} and status='Failed'`);
    response.status(202);
    return container.db.one(sql`
      update field_data_google_sheet_syncs set status='Pending', "lastError"=null,
        "completedAt"=null where id=${sync.id} returning *`);
  }));

  service.post('/field-data/webhooks/:id/syncs/:syncId/cancel', endpoint(async (container, { params, auth }) => {
    await auth.canOrReject('config.set', Config.species);
    return container.maybeOne(sql`
      update field_data_google_sheet_syncs set status='Cancelled',
        "completedAt"=clock_timestamp()
      where id=${intParam(params.syncId)} and "webhookId"=${intParam(params.id)}
        and status in ('Pending', 'Running') returning *`)
      .then(getOrNotFound);
  }));

  service.patch('/field-data/webhooks/:id', endpoint(async (container, { params, body, auth }) => {
    await auth.canOrReject('config.set', Config.species);
    const webhookId = intParam(params.id);
    const webhook = await container.maybeOne(sql`
      select * from field_data_webhooks where id = ${webhookId}
    `).then(getOrNotFound);

    const requestedTarget = body.target ?? webhook.target;
    const target = getTarget(requestedTarget);
    if (target == null) targetOrProblem(requestedTarget, {});
    const normalizedUpdate = body.config === undefined && requestedTarget === webhook.target
      ? null
      : targetOrProblem(requestedTarget, body.config);
    const updated = {
      name: body.name !== undefined ? body.name : webhook.name,
      url: target.managesUrl
        ? target.deliveryUrl(normalizedUpdate?.config ?? webhook.config)
        : (body.url !== undefined ? body.url : webhook.url),
      events: body.events !== undefined ? JSON.stringify(validateEvents(body.events)) : JSON.stringify(validateEvents(webhook.events)),
      active: body.active !== undefined ? body.active : webhook.active
    };
    await validWebhookUrl(updated.url);
    // An absent config means leave the sealed JSONB untouched. Re-normalizing
    // it would stringify encrypted credential envelopes as "[object Object]".
    const storedConfig = body.config === undefined && requestedTarget === webhook.target
      ? webhook.config
      : sealConfig(requestedTarget, normalizedUpdate.config);
    if (target.requiresForm && webhook.formId == null) {
      throw Problem.user.unexpectedValue({
        field: 'target', value: requestedTarget,
        reason: 'this integration must be created for a specific Form'
      });
    }
    if (body.config !== undefined && typeof target.mappedPaths === 'function') {
      const form = await container.maybeOne(sql`
        select id, "currentDefId" from forms
        where id=${webhook.formId} and "deletedAt" is null`).then(getOrNotFound);
      const available = new Set((await filteredDatasetFields(container.db, form))
        .map(field => field.path));
      const missing = target.mappedPaths(normalizedUpdate.config)
        .filter(fieldPath => !available.has(fieldPath));
      if (missing.length !== 0) {
        throw Problem.user.unexpectedValue({
          field: 'config.mapping', value: '[redacted]',
          reason: `these paths do not exist in the selected Form: ${missing.join(', ')}`
        });
      }
    }
    if ((target.submissionRows === true || target.submissionValues === true)
      && body.config !== undefined) {
      updated.events = JSON.stringify([
        'submission.create',
        ...(target.name !== 'google-sheets' || normalizedUpdate.config.syncUpdates
          ? ['submission.update.version'] : [])
      ]);
    }

    const result = await container.db.one(sql`
      update field_data_webhooks
      set name=${updated.name}, url=${updated.url}, events=${updated.events},
        active=${updated.active}, target=${target.name}, config=${JSON.stringify(storedConfig)}
      where id=${webhookId}
      returning *
    `);
    return publicWebhook(result);
  }));

  service.post('/field-data/webhooks/:id/rotate-secret', endpoint(async (container, { params, auth }) => {
    await auth.canOrReject('config.set', Config.species);
    const secret = crypto.randomBytes(24).toString('hex');
    const result = await container.maybeOne(sql`
      update field_data_webhooks set secret=${encryptSecret(secret)}
      where id=${intParam(params.id)} returning *
    `).then(getOrNotFound);
    return { ...publicWebhook(result), secret };
  }));

  service.delete('/field-data/webhooks/:id', endpoint(async (container, { params, auth }) => {
    await auth.canOrReject('config.set', Config.species);
    await container.db.query(sql`delete from field_data_webhooks where id = ${intParam(params.id)}`);
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
      select * from field_data_backups where id=${intParam(params.id)}
    `).then(getOrNotFound);
    if (!record.storageKey || record.status !== 'Success') return reject(Problem.user.notFound());
    response.set('Content-Disposition', contentDisposition(`field-data-backup-${record.id}.pgdump.enc.bin`));
    response.set('Content-Type', 'application/octet-stream');
    return storage.getStream(record.storageKey);
  }));
};
