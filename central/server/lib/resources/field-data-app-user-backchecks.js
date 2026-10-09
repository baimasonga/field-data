// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { sql } = require('slonik');
const Problem = require('../util/problem');
const { UUID_PATTERN } = require('../util/claim-versioning');
const { pushConfig, subscriptionBody } = require('../util/backcheck-push');
const offlineAssignments = require('../util/offline-assignments');

const appUser = async (container, auth) => {
  const actor = auth.actor.orNull();
  if (actor?.type !== 'field_key') throw Problem.user.insufficientRights();
  const [key] = await container.db.any(sql`SELECT fk."projectId", a."displayName", p.name AS "projectName"
    FROM field_keys fk JOIN actors a ON a.id = fk."actorId" AND a."deletedAt" IS NULL
    JOIN projects p ON p.id = fk."projectId" AND p."deletedAt" IS NULL
    WHERE fk."actorId" = ${actor.id}`);
  if (key == null) throw Problem.user.insufficientRights();
  return { ...key, actorId: actor.id };
};

// App Users have submission.create, not submission.read. Limit this surface to
// their own assignments and instructions, never original answers or review data.
const inboxQuery = (user, cursor = null, id = null) => sql`SELECT b.id, b.question, b."dueAt",
  b.status, to_char(b."createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt", b."seenAt", f."xmlFormId", fd.name AS "formName",
  (b.status = 'requested' AND sd.current AND c.status = 'in-review' AND f.state = 'open') AS actionable
  FROM field_data_backchecks b
  JOIN field_data_review_cases c ON c.id = b."caseId"
  JOIN field_data_claim_versions cv ON cv.id = b."claimVersionId"
  JOIN submission_defs sd ON sd.id = cv."submissionDefId"
  JOIN submissions s ON s.id = sd."submissionId" AND s."deletedAt" IS NULL
  JOIN forms f ON f.id = COALESCE(b."responseFormId", s."formId")
    AND f."projectId" = ${user.projectId} AND f."deletedAt" IS NULL
  JOIN form_defs fd ON fd.id = f."currentDefId"
  WHERE b."assignedTo" = ${user.actorId}
    AND EXISTS (SELECT 1 FROM assignments ass JOIN roles r ON r.id = ass."roleId"
      WHERE ass."actorId" = ${user.actorId} AND ass."acteeId" = f."acteeId" AND r.verbs ? 'submission.create')
    ${id == null ? sql`` : sql`AND b.id = ${id}`}
    ${cursor == null ? sql`` : sql`AND (b."createdAt", b.id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`}
  ORDER BY b."createdAt" DESC, b.id DESC LIMIT 51`;

module.exports = (service, endpoint) => {
  service.get('/field-data/app-user/offline-assignments', endpoint(async (container, { auth }, request, response) => {
    const user = await appUser(container, auth);
    response.set('Cache-Control', 'private, no-store');
    const settings = offlineAssignments.config();
    if (settings == null) return { enabled: false };
    const rows = await container.db.any(inboxQuery(user));
    let bundle;
    try { bundle = offlineAssignments.issue(settings, user, rows); } catch (error) {
      if (error.code === 'OFFLINE_SNAPSHOT_TOO_LARGE') throw Problem.user.reviewAssignmentInvalid();
      throw error;
    }
    const data = JSON.parse(Buffer.from(bundle.payload, 'base64url').toString('utf8'));
    await container.Audits.log(auth.actor.orNull(), 'field_data.offline.assignments.issue', null,
      { bundleId: data.id, projectId: user.projectId, actorId: user.actorId,
        expiresAt: data.expiresAt, count: data.items.length, keyId: settings.keyId });
    return { enabled: true, bundle };
  }));
  service.get('/field-data/app-user/backchecks', endpoint(async (container, { auth, query }, request, response) => {
    const user = await appUser(container, auth);
    let cursor = null;
    if (query.cursor != null) {
      try {
        if (typeof query.cursor !== 'string' || query.cursor.length > 512) throw new Error();
        cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
        if (!UUID_PATTERN.test(cursor.id ?? '') || typeof cursor.createdAt !== 'string'
          || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.createdAt)
          || !Number.isFinite(Date.parse(cursor.createdAt))) throw new Error();
      } catch { throw Problem.user.reviewCursorInvalid(); }
    }
    const rows = await container.db.any(inboxQuery(user, cursor));
    const items = rows.slice(0, 50);
    const last = items[items.length - 1];
    response.set('Cache-Control', 'private, no-store');
    return { appUser: { name: user.displayName, projectName: user.projectName }, items,
      nextCursor: rows.length > 50 ? Buffer.from(JSON.stringify({ id: last.id, createdAt: last.createdAt })).toString('base64url') : null };
  }));

  service.post('/field-data/app-user/backchecks/:id/seen', endpoint(async (container, { auth, params }, request, response) => {
    const user = await appUser(container, auth);
    if (!UUID_PATTERN.test(params.id)) throw Problem.user.notFound();
    const [item] = await container.db.any(inboxQuery(user, null, params.id));
    if (item == null) throw Problem.user.notFound();
    const result = await container.db.one(sql`UPDATE field_data_backchecks
      SET "seenAt" = COALESCE("seenAt", clock_timestamp())
      WHERE id = ${item.id} AND "assignedTo" = ${user.actorId} RETURNING id, "seenAt"`);
    response.set('Cache-Control', 'private, no-store');
    return result;
  }));

  service.get('/field-data/app-user/push', endpoint(async (container, { auth }, request, response) => {
    const user = await appUser(container, auth);
    const config = pushConfig();
    const subscriptions = await container.db.any(sql`SELECT id, encode(sha256(convert_to(endpoint, 'UTF8')), 'hex') AS "endpointHash" FROM field_data_app_user_push WHERE "actorId" = ${user.actorId}`);
    response.set('Cache-Control', 'private, no-store');
    return { enabled: config != null, publicKey: config?.publicKey ?? null, subscriptions };
  }));

  service.post('/field-data/app-user/push', endpoint(async (container, { auth, body }, request, response) => {
    const user = await appUser(container, auth);
    if (pushConfig() == null) throw Problem.user.reviewCaseClosed();
    const subscription = subscriptionBody(body);
    if (subscription == null) throw Problem.user.reviewAssignmentInvalid();
    const result = await container.transacting(async (tx) => {
      await tx.db.query(sql`SELECT id FROM actors WHERE id = ${user.actorId} FOR UPDATE`);
      const [existing] = await tx.db.any(sql`SELECT id, "actorId" FROM field_data_app_user_push WHERE endpoint = ${subscription.endpoint}`);
      if (existing != null && existing.actorId !== user.actorId) throw Problem.user.reviewCaseClosed();
      const { count } = await tx.db.one(sql`SELECT count(*)::integer AS count FROM field_data_app_user_push WHERE "actorId" = ${user.actorId}`);
      if (existing == null && count >= 3) throw Problem.user.reviewCaseClosed();
      return tx.db.one(sql`INSERT INTO field_data_app_user_push ("actorId", endpoint, p256dh, auth)
        VALUES (${user.actorId}, ${subscription.endpoint}, ${subscription.p256dh}, ${subscription.auth})
        ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
        WHERE field_data_app_user_push."actorId" = EXCLUDED."actorId" RETURNING id`);
    });
    response.set('Cache-Control', 'private, no-store');
    return result;
  }));

  service.delete('/field-data/app-user/push/:id', endpoint(async (container, { auth, params }, request, response) => {
    const user = await appUser(container, auth);
    if (!UUID_PATTERN.test(params.id)) throw Problem.user.notFound();
    await container.db.query(sql`DELETE FROM field_data_app_user_push WHERE id = ${params.id} AND "actorId" = ${user.actorId}`);
    response.set('Cache-Control', 'private, no-store');
    return { success: true };
  }));
};
