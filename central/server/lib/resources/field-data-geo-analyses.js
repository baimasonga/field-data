// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
/* eslint-disable no-await-in-loop */
const { randomUUID } = require('node:crypto');
const { sql } = require('slonik');
const geo = require('../util/geo-assessments');
const analysis = require('../util/geo-analysis');
const imagery = require('../util/imagery');
const { UUID_PATTERN } = require('../util/claim-versioning');
const Problem = require('../util/problem');
const conflict = () => Problem.user.geoAssessmentConflict();
module.exports = (service, endpoint, { scope, sourceFor, cacheFor, lockPermissions }) => {
  const root = '/projects/:projectId/forms/:xmlFormId/submissions/:instanceId/geo-assessments/analyses';
  const writable = target => !target.row.archived && !target.source.encrypted && !!target.source.location;
  const current = async (tx, auth, form, params) => {
    const reviewer = await lockPermissions(tx, auth.actor.get().id, form); const target = await sourceFor(tx.db, form, params, true);
    if (!analysis.enabled() || !writable(target)) throw conflict(); return { ...target, reviewer };
  };
  service.get(root, endpoint(async (c, { auth, params }, _, response) => {
    const form = await scope(c, auth, params); const target = await sourceFor(c.db, form, params); const { catalogue } = geo.config();
    const cache = await cacheFor(c.db, target.source); const rows = await analysis.history(c.db, target.row.submissionId); const items = [];
    for (const row of rows) items.push(analysis.present(row, target.source, catalogue, await analysis.reviewsFor(c.db, row.id)));
    const canRun = analysis.enabled() && writable(target) && auth.actor.orNull()?.type === 'user' && (await auth.verbsOn(form)).includes('submission.update');
    response.set('Cache-Control', 'private, no-store');
    return { source: target.source, enabled: analysis.enabled(), canRun, remaining: Math.max(0, 20-rows.length), scenes: cache.scenes.slice(0, 50), catalogueStatus: cache.status, items, method: analysis.METHOD };
  }));
  service.post(`${root}/scenes`, endpoint(async (c, { auth, params, body }, _, response) => {
    const form = await scope(c, auth, params, true);
    if (!geo.exact(body, ['sourceFingerprint', 'allowExternalProcessing']) || !geo.validHash(body.sourceFingerprint) || body.allowExternalProcessing !== true) throw Problem.user.geoAssessmentInvalid();
    const target = await c.transacting(async tx => { const value = await current(tx, auth, form, params); if (value.source.fingerprint !== body.sourceFingerprint) throw conflict(); return value; });
    const setup = geo.config(); if (!setup.catalogue) throw Problem.internal.imageryNotConfigured();
    const cell = imagery.cellOf(target.source.location.latitude, target.source.location.longitude); const window = imagery.windowAround(new Date(target.source.visitAt));
    const answer = await imagery.lookup(setup.catalogue, cell, window);
    await c.transacting(async tx => {
      const value = await current(tx, auth, form, params);
      if (value.source.fingerprint !== target.source.fingerprint || geo.config().catalogue !== setup.catalogue) throw conflict();
      if (answer.ok) await tx.db.query(sql`INSERT INTO field_data_imagery_lookups(catalogue,collection,"cellKey","visitDay","windowDays",scenes,matched)
        VALUES(${setup.catalogue},${imagery.COLLECTION},${cell.key},${window.day},${imagery.WINDOW_DAYS},${JSON.stringify(answer.scenes.map(scene => ({ id: scene.id, at: scene.at.toISOString(), cloud: scene.cloud })))},${answer.matched})
        ON CONFLICT(catalogue,collection,"cellKey","visitDay","windowDays") DO UPDATE SET scenes=excluded.scenes,matched=excluded.matched,"fetchedAt"=clock_timestamp()`);
      await tx.Audits.log(auth.actor.get(), 'field_data.geo.analysis.scenes', form, { sourceFingerprint: value.source.fingerprint, ok: answer.ok });
    });
    response.set('Cache-Control', 'private, no-store'); return { ok: answer.ok, reason: answer.ok ? null : 'catalogue-unavailable' };
  }));
  service.post(root, endpoint(async (c, { auth, params, body }, _, response) => {
    const form = await scope(c, auth, params, true); const data = analysis.checked(body); const actor = auth.actor.get(); const requestHash = geo.hash({ actorId: actor.id, ...data });
    const reservation = await c.transacting(async tx => {
      await tx.db.query(sql`SELECT pg_advisory_xact_lock(74169)`);
      const target = await current(tx, auth, form, params); const rows = await analysis.history(tx.db, target.row.submissionId);
      const prior = rows.find(row => row.requestId === data.requestId);
      if (prior) { if (prior.requestHash !== requestHash) throw conflict(); return { ...target, row: prior, replayed: true }; }
      const active = await tx.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_geo_analyses WHERE status='pending' AND "createdAt">clock_timestamp()-interval '3 minutes'`);
      if (active >= 2 || rows.length >= 20 || data.sourceFingerprint !== target.source.fingerprint || rows.some(row => row.status === 'pending' && Date.now()-Date.parse(row.createdAt)<180000)) throw conflict();
      const cache = await cacheFor(tx.db, target.source, true);
      const before = cache.scenes.slice(0, 50).find(scene => scene.id === data.beforeId && scene.fingerprint === data.beforeFingerprint);
      const after = data.mode === 'change' && cache.scenes.slice(0, 50).find(scene => scene.id === data.afterId && scene.fingerprint === data.afterFingerprint);
      if (!before || (data.mode === 'change' && (!after || Date.parse(before.at) >= Date.parse(after.at)))) throw conflict();
      const row = await tx.db.one(sql`INSERT INTO field_data_geo_analyses(id,"submissionDefId","requestId","requestHash","actorId","actorName","sourceFingerprint",source,catalogue,mode,status)
        VALUES(${randomUUID()},${target.row.id},${data.requestId},${requestHash},${actor.id},${target.reviewer.displayName},${target.source.fingerprint},${JSON.stringify(target.source)},${geo.config().catalogue},${data.mode},'pending') RETURNING *`);
      return { ...target, row, before, after, replayed: false };
    });
    response.set('Cache-Control', 'private, no-store');
    if (reservation.replayed) { response.set('Idempotency-Status', 'replayed'); return { item: analysis.present(reservation.row, reservation.source, geo.config().catalogue, await analysis.reviewsFor(c.db, reservation.row.id)), replayed: true }; }
    let result;
    try {
      const before = await analysis.providerScene(reservation.before, reservation.source, reservation.row.catalogue);
      const after = reservation.after ? await analysis.providerScene(reservation.after, reservation.source, reservation.row.catalogue) : null;
      const provider = { before, after, retrievedAt: new Date().toISOString(), verification: 'retrieved-from-configured-catalogue-over-https', catalogue: reservation.row.catalogue };
      if (data.mode === 'footprint') result = { status: 'footprint-checked', provider, method: analysis.METHOD, candidates: [] };
      else if ([before, after].some(scene => scene.coverage.relation !== 'inside' || scene.coverage.accuracyRelation !== 'contained')) result = { status: 'withheld', reason: 'reported-point-or-accuracy-not-covered', provider, method: analysis.METHOD, candidates: [] };
      else if ([before, after].some(scene => !Number.isFinite(scene.sunElevation) || scene.sunElevation < 15) || Math.abs(before.sunElevation-after.sunElevation)>15) result = { status: 'withheld', reason: 'illumination-metadata-not-comparable', provider, method: analysis.METHOD, candidates: [] };
      else {
        let pixels;
        try { pixels = await analysis.raster(reservation.source, before, after); } catch { pixels = { status: 'withheld', reason: 'raster-service-unavailable-or-invalid-output', method: analysis.METHOD, candidates: [] }; }
        result = { ...pixels, provider };
      }
      const item = await c.transacting(async tx => {
        const target = await current(tx, auth, form, params);
        if (target.source.fingerprint !== reservation.source.fingerprint || geo.config().catalogue !== reservation.row.catalogue) throw conflict();
        const row = await tx.db.one(sql`UPDATE field_data_geo_analyses SET status='complete',result=${JSON.stringify(result)},"completedAt"=clock_timestamp() WHERE id=${reservation.row.id} AND status='pending' RETURNING *`);
        await tx.Audits.log(actor, 'field_data.geo.analysis.completed', form, { analysisId: row.id, sourceFingerprint: row.sourceFingerprint, status: result.status, candidates: result.candidates?.length ?? 0 });
        return analysis.present(row, target.source, geo.config().catalogue);
      });
      response.set('Idempotency-Status', 'created'); return { item, replayed: false };
    } catch {
      const row = await c.db.maybeOne(sql`UPDATE field_data_geo_analyses SET status='failed',failure='provider-unavailable-or-source-access-changed',"completedAt"=clock_timestamp() WHERE id=${reservation.row.id} AND status='pending' RETURNING *`);
      return c.transacting(async tx => {
        const target = await current(tx, auth, form, params);
        return { item: analysis.present(row, target.source, geo.config().catalogue), replayed: false };
      });
    }
  }));
  service.post(`${root}/:analysisId/reviews`, endpoint(async (c, { auth, params, body }, _, response) => {
    const form = await scope(c, auth, params, true); const data = analysis.checkedReview(body);
    if (!UUID_PATTERN.test(params.analysisId)) throw Problem.user.notFound();
    const actor = auth.actor.get(); const digest = geo.hash({ actorId: actor.id, ...data });
    const result = await c.transacting(async tx => {
      const target = await current(tx, auth, form, params);
      const row = await tx.db.maybeOne(sql`SELECT a.* FROM field_data_geo_analyses a JOIN submission_defs sd ON sd.id=a."submissionDefId"
        WHERE a.id=${params.analysisId} AND sd."submissionId"=${target.row.submissionId} FOR UPDATE OF a`);
      if (!row) throw Problem.user.notFound();
      const reviews = await analysis.reviewsFor(tx.db, row.id); const revision = reviews[0]?.sequence ?? 0; const prior = reviews.find(review => review.requestId === data.requestId);
      if (prior) { if (prior.requestHash !== digest) throw conflict(); return { revision, replayed: true }; }
      if (revision !== data.revision || revision >= 50 || row.status !== 'complete' || row.result?.status !== 'analysed' || row.sourceFingerprint !== target.source.fingerprint || row.catalogue !== geo.config().catalogue || !row.result.candidates.some(candidate => candidate.id === data.candidateId)) throw conflict();
      const id = randomUUID();
      await tx.db.query(sql`INSERT INTO field_data_geo_candidate_reviews(id,"analysisId",sequence,"requestId","requestHash","candidateId",action,reason,"actorId","actorName")
        VALUES(${id},${row.id},${revision+1},${data.requestId},${digest},${data.candidateId},${data.action},${data.reason},${actor.id},${target.reviewer.displayName})`);
      await tx.Audits.log(actor, 'field_data.geo.candidate.reviewed', form, { analysisId: row.id, candidateId: data.candidateId, action: data.action, reviewId: id });
      return { revision: revision+1, replayed: false };
    });
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
};
