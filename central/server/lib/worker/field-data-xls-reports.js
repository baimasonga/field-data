// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { buffer } = require('node:stream/consumers');
const { sql } = require('slonik');
const { storage } = require('../external/field-data-storage');
const { inspectTemplate, validateTemplate, renderTemplate, MIME_TYPE } = require('../util/xls-reports');
const { resolveReportSource, rowsForSource } = require('../util/xls-report-data');

const runXlsReports = (db, dependencies = {}) => db.connect(async connection => {
  const store = dependencies.storage || storage;
  const locked = await connection.oneFirst(sql`
    select pg_try_advisory_lock(74125, hashtext(current_schema()))`);
  if (!locked) return;
  try {
    const interrupted = await connection.any(sql`
      update field_data_xls_report_runs set status='Pending', "startedAt"=null
      where status='Running' returning "storageKey"`);
    for (const previous of interrupted) {
      if (previous.storageKey != null) {
        // eslint-disable-next-line no-await-in-loop
        await store.delete(previous.storageKey).catch(() => {});
      }
    }

    const record = await connection.maybeOne(sql`
      select r.*, t.name, t."projectId", t."formId", t."filteredDatasetId",
        t."mergedDatasetId", t."storageKey" as "templateStorageKey", t.filename
      from field_data_xls_report_runs r
      join field_data_xls_report_templates t on t.id=r."templateId"
      where r.status='Pending' order by r.id limit 1`);
    if (record == null) return;

    const outputKey = `xls-reports/${record.templateId}/report-${record.id}.xlsx`;
    await connection.query(sql`
      update field_data_xls_report_runs set status='Running', "storageKey"=${outputKey},
        "startedAt"=clock_timestamp(), error=null where id=${record.id}`);
    try {
      const templateBuffer = await buffer(await store.getStream(record.templateStorageKey));
      const source = await resolveReportSource(connection, record);
      if (source == null) throw Object.assign(new Error('The report data source no longer exists.'),
        { reason: 'The report data source no longer exists.' });
      const inspection = await inspectTemplate(templateBuffer);
      validateTemplate(inspection, source.fields);
      const rows = await rowsForSource(connection, source);
      const output = await renderTemplate(templateBuffer, {
        name: record.name,
        sourceName: source.name,
        generatedAt: new Date()
      }, rows);
      await store.putBuffer(outputKey, output, { 'Content-Type': MIME_TYPE });
      const completed = await connection.maybeOne(sql`
        update field_data_xls_report_runs set status='Success', "sizeBytes"=${output.length},
          "rowCount"=${rows.length}, error=null, "completedAt"=clock_timestamp()
        where id=${record.id} and status='Running' returning id`);
      // A cancellation may arrive while ExcelJS is writing. Cancellation wins,
      // and its now-unreferenced workbook is removed immediately.
      if (completed == null) {
        await store.delete(outputKey);
        await connection.query(sql`
          update field_data_xls_report_runs set "storageKey"=null
          where id=${record.id} and status='Cancelled'`);
      }
    } catch (error) {
      process.stderr.write(`XLS report ${record.id} failed: ${error.message}\n`);
      const message = String(error.reason ??
        'Report generation failed. Check the template and try again.').slice(0, 1000);
      await connection.query(sql`
        update field_data_xls_report_runs set status='Failed', "storageKey"=null, error=${message},
          "completedAt"=clock_timestamp()
        where id=${record.id} and status='Running'`);
      await store.delete(outputKey).catch(() => {});
    }
  } finally {
    await connection.query(sql`select pg_advisory_unlock(74125, hashtext(current_schema()))`);
  }
});

module.exports = { runXlsReports };
