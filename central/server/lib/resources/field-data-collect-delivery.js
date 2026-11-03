// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
/* eslint-disable no-await-in-loop */
const { sql } = require('slonik');
const Problem = require('../util/problem');
const { account } = require('../util/media-couriers');

const PAGE = 20;
module.exports = (service, endpoint) => {
  service.get('/field-data/app-user/collect-delivery', endpoint(async (c, { auth, query }, _, response) => {
    const actor = auth.actor.orNull();
    if (actor?.type !== 'field_key') throw Problem.user.insufficientRights();
    const { cursor } = query;
    if (cursor != null && (typeof cursor !== 'string' || !/^[1-9]\d{0,9}$/.test(cursor) || Number(cursor) > 2147483647))
      throw Problem.user.unexpectedValue({ field: 'cursor', reason: 'Use the next cursor returned by the server.' });
    const result = await c.transacting(async tx => {
      const projectId = await tx.db.maybeOneFirst(sql`SELECT "projectId" FROM field_keys WHERE "actorId"=${actor.id}`);
      if (!projectId || !await account(tx, actor.id, projectId)) throw Problem.user.notFound();
      const rows = await tx.db.any(sql`SELECT sd.id AS "submissionDefId",sd."instanceId",sd."createdAt" AS "receivedAt",
          f."xmlFormId",f."acteeId",f.state AS "formState",COALESCE(fd.name,f."xmlFormId") AS "formName"
        FROM submission_defs sd JOIN submissions s ON s.id=sd."submissionId"
        JOIN forms f ON f.id=s."formId" JOIN form_defs fd ON fd.id=sd."formDefId"
        WHERE f."projectId"=${projectId} AND f."deletedAt" IS NULL AND fd."publishedAt" IS NOT NULL
          AND s."deletedAt" IS NULL AND s.draft=FALSE AND sd.current
          AND s."submitterId"=${actor.id} AND sd."submitterId"=${actor.id}
          AND ${cursor == null ? sql`TRUE` : sql`sd.id<${Number(cursor)}`}
          AND EXISTS(SELECT 1 FROM assignments ass JOIN roles r ON r.id=ass."roleId"
            WHERE ass."actorId"=${actor.id} AND ass."acteeId"=f."acteeId" AND r.verbs ? 'submission.create')
        ORDER BY sd.id DESC LIMIT ${PAGE + 1} FOR SHARE OF sd,s,f,fd`);
      const items = [];
      for (const entry of rows.slice(0, PAGE)) {
        const grant = await tx.db.maybeOne(sql`SELECT ass."actorId" FROM assignments ass JOIN roles r ON r.id=ass."roleId"
          WHERE ass."actorId"=${actor.id} AND ass."acteeId"=${entry.acteeId} AND r.verbs ? 'submission.create' LIMIT 1 FOR SHARE OF ass,r`);
        if (!grant) continue;
        const counts = await tx.db.one(sql`SELECT count(*)::integer AS "expectedFiles",count("blobId")::integer AS "recordedFiles",
          ARRAY(SELECT name FROM submission_attachments WHERE "submissionDefId"=${entry.submissionDefId} AND "blobId" IS NULL ORDER BY name LIMIT 10) AS "missingFiles"
          FROM submission_attachments WHERE "submissionDefId"=${entry.submissionDefId}`);
        const { acteeId, ...metadata } = entry;
        items.push({ ...metadata, ...counts });
      }
      return { actorId: actor.id, projectId, items, nextCursor: rows.length > PAGE ? String(rows[PAGE - 1].submissionDefId) : null, checkedAt: new Date().toISOString() };
    });
    response.set('Cache-Control', 'private, no-store');
    return result;
  }));
};
