// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const webpush = require('web-push');
const { sql } = require('slonik');
const { UUID_PATTERN } = require('../util/claim-versioning');
const { pushConfig, subscriptionBody } = require('../util/backcheck-push');

const dispatchBackcheckPush = async (container, event, send = webpush.sendNotification, env = process.env) => {
  const config = pushConfig(env);
  const id = event.details?.backcheckId;
  const expectedStatus = { 'field_data.backcheck.request': 'requested',
    'field_data.backcheck.cancel': 'cancelled', 'field_data.backcheck.link': 'linked' }[event.action];
  if (config == null || !UUID_PATTERN.test(id ?? '') || expectedStatus == null) return;
  const subscriptions = await container.db.any(sql`SELECT push.id, push.endpoint, push.p256dh, push.auth
    FROM field_data_backchecks b
    JOIN field_data_review_cases c ON c.id = b."caseId"
    JOIN field_data_claim_versions cv ON cv.id = b."claimVersionId"
    JOIN submission_defs sd ON sd.id = cv."submissionDefId" AND sd.current
    JOIN submissions s ON s.id = sd."submissionId" AND s."deletedAt" IS NULL
    JOIN forms f ON f.id = COALESCE(b."responseFormId", s."formId") AND f."deletedAt" IS NULL
    JOIN field_keys fk ON fk."actorId" = b."assignedTo" AND fk."projectId" = f."projectId"
    JOIN actors a ON a.id = fk."actorId" AND a."deletedAt" IS NULL
    JOIN projects project ON project.id = f."projectId" AND project."deletedAt" IS NULL
    JOIN field_data_app_user_push push ON push."actorId" = b."assignedTo"
    WHERE b.id = ${id} AND b.status = ${expectedStatus}
      AND (${expectedStatus} <> 'requested' OR (c.status = 'in-review' AND f.state = 'open' AND b."seenAt" IS NULL))
      AND EXISTS (SELECT 1 FROM assignments ass JOIN roles r ON r.id = ass."roleId"
        WHERE ass."actorId" = b."assignedTo" AND ass."acteeId" = f."acteeId" AND r.verbs ? 'submission.create')`);
  const results = await Promise.all(subscriptions.map(async (subscription) => {
    const target = { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } };
    if (subscriptionBody(target) == null) {
      await container.db.query(sql`DELETE FROM field_data_app_user_push WHERE id = ${subscription.id}`);
      return true;
    }
    try {
      await send(target,
        JSON.stringify({ type: 'backcheck-update', tag: `backcheck-${id}` }),
        { vapidDetails: config, TTL: 3600, timeout: 5000 });
      return true;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await container.db.query(sql`DELETE FROM field_data_app_user_push WHERE id = ${subscription.id}`);
        return true;
      }
      return false;
    }
  }));
  // A generic error permits the existing durable worker retry without logging
  // endpoint capabilities, keys, provider response bodies or assignment text.
  if (results.some(result => !result)) throw new Error('Backcheck push delivery failed');
};
module.exports = { dispatchBackcheckPush };
