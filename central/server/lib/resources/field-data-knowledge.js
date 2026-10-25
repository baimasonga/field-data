// Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.
const { randomUUID, createHash } = require('node:crypto');
const { sql } = require('slonik');
const Problem = require('../util/problem');
const { UUID_PATTERN } = require('../util/claim-versioning');
const data = require('../util/knowledge-data');
const models = require('../util/knowledge-models');
const { freshness } = require('../util/asset-freshness');
const { scoreCorpus } = require('../util/knowledge-retrieval');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value === value.trim() && value.length <= max;
const present = row => ({ projectId: row.projectId, id: row.id, title: row.title, definition: row.definition, revision: row.revision, archived: row.archived });
module.exports = (service, endpoint) => {
  const root = '/projects/:projectId/knowledge';
  service.get(root, endpoint(async (c, { auth, params, query }, _, response) => {
    if (Object.keys(query).length) throw data.invalid('No catalogue query options are supported.');
    const result = await c.transacting(async tx => {
      const project = await data.scope(tx, auth, params.projectId);
      const snapshot = await data.snapshot(tx, auth, project.id, {});
      const definitions = await tx.db.any(sql`SELECT * FROM field_data_knowledge_definitions WHERE "projectId"=${project.id} ORDER BY "updatedAt" DESC,id LIMIT 100`);
      return { projectId: project.id, method: 'knowledge-workspace@1', assets: snapshot.assets.map(asset => ({ id: asset.id, name: asset.name, externalId: asset.externalId, xmlFormId: asset.xmlFormId, assetType: asset.assetType })), availablePredicates: snapshot.availablePredicates, visibleAssets: snapshot.assets.length,
        withheldAssets: snapshot.withheldAssets, truncated: snapshot.truncated, definitions: definitions.map(present),
        canManage: !project.archived && auth.actor.orNull()?.type === 'user' && await auth.can('project.update', project) };
    });
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.post(`${root}/snapshot`, endpoint(async (c, { auth, params, body }, _, response) => {
    const result = await c.transacting(tx => data.snapshot(tx, auth, params.projectId, body));
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.post(`${root}/evaluate`, endpoint(async (c, { auth, params, body }, _, response) => {
    if (!body || Object.keys(body).some(key => !['definition', 'definitionId', 'definitionRevision', 'at', 'knownAt'].includes(key)) || (body.definition == null) === (body.definitionId == null)) throw data.invalid('Choose exactly one inline or saved definition.');
    const result = await c.transacting(async tx => {
      const project = await data.scope(tx, auth, params.projectId); let { definition } = body; let source = null;
      if (body.definitionId != null) {
        if (!UUID_PATTERN.test(body.definitionId) || (body.definitionRevision != null && (!Number.isInteger(body.definitionRevision) || body.definitionRevision < 1 || body.definitionRevision > 500))) throw data.invalid('Invalid saved definition or revision.');
        const row = await tx.db.maybeOne(sql`SELECT * FROM field_data_knowledge_definitions WHERE id=${body.definitionId} AND "projectId"=${project.id}`);
        if (!row) throw Problem.user.notFound();
        source = present(row);
        if (body.definitionRevision != null) {
          const prior = await tx.db.maybeOne(sql`SELECT snapshot FROM field_data_knowledge_definition_events WHERE "definitionId"=${row.id} AND revision=${body.definitionRevision}`);
          if (!prior) throw Problem.user.notFound(); source = prior.snapshot;
        }
        definition = source.definition;
      }
      definition = models.checkedDefinition(definition);
      const snapshot = await data.snapshot(tx, auth, project.id, { predicates: models.predicatesOf(definition), ...(body.at == null ? {} : { at: body.at }), ...(body.knownAt == null ? {} : { knownAt: body.knownAt }) });
      const evaluation = definition.kind === 'geography' ? models.geography(snapshot, definition.locationPredicate, definition.areas)
        : definition.kind === 'decision' ? models.decide(snapshot, definition) : models.causal(snapshot, definition);
      return { method: 'knowledge-evaluation@1', definitionSource: source, definition, snapshot, evaluation,
        reproducibility: 'Definitions and input citations are included. Rebuilds enforce current source permissions; deleted or revoked source evidence is withheld.' };
    });
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.post(`${root}/definitions/:id`, endpoint(async (c, { auth, params, body }, _, response) => {
    if (!UUID_PATTERN.test(params.id ?? '') || !body || Object.keys(body).length !== 7 || Object.keys(body).some(key => !['requestId', 'expectedRevision', 'title', 'definition', 'reason', 'archived', 'shared'].includes(key)) ||
      !UUID_PATTERN.test(body.requestId ?? '') || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision >= 500 || !text(body.title, 200) || !text(body.reason, 2000) || typeof body.archived !== 'boolean' || body.shared !== true) throw data.invalid('Provide a request identity, expected revision, title, definition, reason, archive flag and explicit shared-project confirmation.');
    const definition = models.checkedDefinition(body.definition);
    const result = await c.transacting(async tx => {
      const project = await data.scope(tx, auth, params.projectId, true);
      await tx.db.query(sql`SELECT pg_advisory_xact_lock(74156,${project.id})`);
      const actorId = auth.actor.get().id; const requestHash = hash({ actorId, id: params.id.toLowerCase(), expectedRevision: body.expectedRevision, title: body.title, definition, reason: body.reason, archived: body.archived });
      const prior = await tx.db.maybeOne(sql`SELECT * FROM field_data_knowledge_definition_events WHERE "projectId"=${project.id} AND "requestId"=${body.requestId}`);
      if (prior) { if (prior.requestHash !== requestHash) throw new Problem(409, 'The request identity was already used for different content.'); return { ...prior.snapshot, replayed: true }; }
      const current = await tx.db.maybeOne(sql`SELECT * FROM field_data_knowledge_definitions WHERE id=${params.id} FOR UPDATE`);
      if (current && current.projectId !== project.id) throw Problem.user.notFound();
      if ((current?.revision ?? 0) !== body.expectedRevision) throw new Problem(412, 'The Knowledge definition changed. Refresh its history before saving.');
      if (!current && (await tx.db.oneFirst(sql`SELECT count(*)::integer FROM field_data_knowledge_definitions WHERE "projectId"=${project.id}`)) >= 100) throw data.invalid('A project may retain at most 100 Knowledge definitions.');
      const revision = body.expectedRevision + 1;
      const saved = current ? await tx.db.one(sql`UPDATE field_data_knowledge_definitions SET title=${body.title},definition=${sql.json(definition)},revision=${revision},archived=${body.archived},"updatedAt"=clock_timestamp() WHERE id=${current.id} RETURNING *`)
        : await tx.db.one(sql`INSERT INTO field_data_knowledge_definitions(id,"projectId",title,definition,revision,archived) VALUES(${params.id},${project.id},${body.title},${sql.json(definition)},${revision},${body.archived}) RETURNING *`);
      await tx.db.query(sql`INSERT INTO field_data_knowledge_definition_events(id,"definitionId","projectId",revision,"requestId","requestHash","actorId",reason,snapshot)
        VALUES(${randomUUID()},${saved.id},${project.id},${revision},${body.requestId},${requestHash},${actorId},${body.reason},${sql.json(present(saved))})`);
      await tx.Audits.log(auth.actor, 'field_data.knowledge.definition.saved', project, { definitionId: saved.id, revision, kind: definition.kind, archived: body.archived });
      return { ...present(saved), replayed: false };
    });
    response.set('Cache-Control', 'private, no-store'); response.set('ETag', `"knowledge-definition-${result.revision}"`); response.set('Idempotency-Status', result.replayed ? 'replayed' : 'created'); return result;
  }));
  service.get(`${root}/definitions/:id/history`, endpoint(async (c, { auth, params, query }, _, response) => {
    if (!UUID_PATTERN.test(params.id ?? '') || Object.keys(query).some(key => key !== 'before') || (query.before != null && !/^[1-9]\d{0,3}$/.test(query.before))) throw data.invalid('Invalid history cursor.');
    const result = await c.transacting(async tx => {
      const project = await data.scope(tx, auth, params.projectId);
      const row = await tx.db.maybeOne(sql`SELECT id FROM field_data_knowledge_definitions WHERE id=${params.id} AND "projectId"=${project.id}`); if (!row) throw Problem.user.notFound();
      const events = await tx.db.any(sql`SELECT revision,"actorId",reason,snapshot,"createdAt" FROM field_data_knowledge_definition_events WHERE "definitionId"=${row.id} AND revision<${query.before == null ? 501 : Number(query.before)} ORDER BY revision DESC LIMIT 51`);
      return { items: events.slice(0, 50), nextBefore: events.length > 50 ? events[49].revision : null };
    });
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
  service.post(`${root}/retrieval`, endpoint(async (c, { auth, params, body }, _, response) => {
    if (!body || Object.keys(body).some(key => !['q', 'mode', 'xmlFormId', 'paths', 'offset', 'at', 'knownAt'].includes(key)) || !text(body.q, 200) || body.q.length < 2 || !['literal', 'semantic'].includes(body.mode) ||
      (body.xmlFormId != null && !text(body.xmlFormId, 255)) || (body.offset != null && (!Number.isInteger(body.offset) || body.offset < 0 || body.offset > 100000)) ||
      (body.paths != null && (!Array.isArray(body.paths) || body.paths.length > 20 || body.paths.some(path => typeof path !== 'string' || path.length > 500 || !/^(\/[A-Za-z_][A-Za-z0-9_.-]*)+$/.test(path))))) throw data.invalid('Use a query, literal/semantic mode, optional form/field paths and a bounded corpus offset.');
    const result = await c.transacting(async tx => {
      const snapshot = await data.snapshot(tx, auth, params.projectId, { ...(body.at == null ? {} : { at: body.at }), ...(body.knownAt == null ? {} : { knownAt: body.knownAt }) });
      const projectId = Number(params.projectId); const readable = await data.readableForms(tx, auth, projectId); const ids = sql.array(readable, 'int4');
      const sources = await tx.db.any(sql`WITH versions AS (SELECT DISTINCT ON (s.id) cv.id,cv."submissionDefId",cv."createdAt",s."formId",s."instanceId",f."xmlFormId"
        FROM field_data_claim_versions cv JOIN submission_defs sd ON sd.id=cv."submissionDefId"
        JOIN submissions s ON s.id=sd."submissionId" AND s."deletedAt" IS NULL AND s.draft=FALSE
        JOIN forms f ON f.id=s."formId" AND f."deletedAt" IS NULL
        WHERE f.id=ANY(${ids}) AND cv."createdAt"<=${snapshot.knownAt} ${body.xmlFormId == null ? sql`` : sql`AND f."xmlFormId"=${body.xmlFormId}`}
        ORDER BY s.id,cv.ordinal DESC)
        SELECT *,count(*) OVER() AS total FROM versions ORDER BY "createdAt" DESC,id LIMIT 100 OFFSET ${body.offset ?? 0}`);
      const sourceIds = sql.array(sources.map(source => source.id), 'uuid');
      const answers = !sources.length ? [] : await tx.db.any(sql`SELECT cv.id AS "claimVersionId",f."xmlFormId",s."instanceId",ff.path,x.value,x.position,
          (SELECT p."integrityHash"=encode(sha256(convert_to(sd.xml,'UTF8')),'hex') FROM field_data_submission_provenance p WHERE p."submissionDefId"=sd.id) AS verified
        FROM field_data_claim_versions cv JOIN submission_defs sd ON sd.id=cv."submissionDefId" JOIN submissions s ON s.id=sd."submissionId" JOIN forms f ON f.id=s."formId"
        JOIN form_defs fd ON fd.id=sd."formDefId"
        CROSS JOIN LATERAL (SELECT ff.* FROM form_fields ff WHERE ff."formId"=f.id AND ff."schemaId"=fd."schemaId" AND COALESCE(ff.binary,FALSE)=FALSE
          AND ff.type NOT IN ('structure','repeat','group') AND ff.path !~ '^/meta/' AND ff.path ~ '^(/[A-Za-z_][A-Za-z0-9_.-]*)+$'
          ${body.paths?.length ? sql`AND ff.path=ANY(${sql.array(body.paths, 'text')})` : sql``} ORDER BY ff."order",ff.path LIMIT 30) ff
        CROSS JOIN LATERAL XMLTABLE(('/*'||regexp_replace(ff.path,'/([A-Za-z_][A-Za-z0-9_.-]*)','/*[local-name()="\\1"]','g')) PASSING (CASE WHEN octet_length(sd.xml)<=262144 AND EXISTS(SELECT 1 FROM field_data_submission_provenance p WHERE p."submissionDefId"=sd.id AND p."integrityHash"=encode(sha256(convert_to(sd.xml,'UTF8')),'hex')) THEN sd.xml::xml ELSE '<withheld/>'::xml END) COLUMNS value text PATH 'text()[1]',position FOR ORDINALITY) x
        WHERE cv.id=ANY(${sourceIds}) AND fd."keyId" IS NULL AND sd."localKey" IS NULL AND octet_length(sd.xml)<=262144 AND x.position<=8 AND x.value IS NOT NULL
        ORDER BY cv.id,ff."order",x.position LIMIT 1000`);
      const facts = snapshot.assets.length ? await tx.db.any(sql`WITH owners AS (${data.ownersSql(new Date(snapshot.knownAt))}) SELECT DISTINCT ON (ow."assetId",o.predicate)
        o.id,o.predicate,o.state,o.value,o."claimVersionId",o."validFrom",o."recordedAt",o."validityDays",o."graceDays",ow."assetId",sf."xmlFormId",s."instanceId",a.name,
        EXISTS(SELECT 1 FROM field_data_submission_provenance p WHERE p."submissionDefId"=sd.id AND p."integrityHash"=o."sourceHash" AND p."integrityHash"=encode(sha256(convert_to(sd.xml,'UTF8')),'hex')) AS verified
        FROM owners ow JOIN field_data_assets a ON a.id=ow."assetId" JOIN field_data_asset_observations o ON o.id=ow."observationId"
        JOIN field_data_claim_versions cv ON cv.id=o."claimVersionId" JOIN submission_defs sd ON sd.id=cv."submissionDefId"
        JOIN submissions s ON s.id=sd."submissionId" JOIN forms sf ON sf.id=s."formId"
        WHERE ow."assetId"=ANY(${sql.array(snapshot.assets.map(asset => asset.id), 'uuid')}) AND o."validFrom"<=${snapshot.at}
          ${body.xmlFormId == null ? sql`` : sql`AND sf."xmlFormId"=${body.xmlFormId}`}
        ORDER BY ow."assetId",o.predicate,o."validFrom" DESC,o."recordedAt" DESC,o.sequence DESC LIMIT 256`) : [];
      const docs = [
        ...snapshot.assets.filter(asset => body.xmlFormId == null || asset.xmlFormId === body.xmlFormId).slice(0, 256).map(asset => ({ id: `asset:${asset.id}`, kind: 'asset', text: `${asset.name} ${asset.externalId} ${asset.assetType}`, assetId: asset.id, assetXmlFormId: asset.xmlFormId, source: { xmlFormId: asset.xmlFormId } })),
        ...facts.filter(fact => fact.verified).map(fact => ({ id: `fact:${fact.id}`, kind: 'fact', assetXmlFormId: snapshot.assets.find(asset => asset.id === fact.assetId)?.xmlFormId, integrityStatus: 'verified', freshness: freshness({ ...fact, integrityStatus: 'verified' }, new Date(snapshot.at)), validFrom: fact.validFrom, recordedAt: fact.recordedAt, text: `${fact.name} ${fact.predicate} ${fact.state} ${fact.value ?? ''}`.slice(0, 2400), assetId: fact.assetId,
          source: { claimVersionId: fact.claimVersionId, observationId: fact.id, xmlFormId: fact.xmlFormId, instanceId: fact.instanceId, url: `/v1/field-data/claim-versions/${fact.claimVersionId}` } })),
        ...answers.map(answer => ({ id: `answer:${answer.claimVersionId}:${answer.path}:${answer.position}`, kind: 'answer', text: `${answer.xmlFormId} ${answer.path} ${answer.value.slice(0, 2000)}`, integrityStatus: answer.verified ? 'verified' : 'unverified',
          source: { claimVersionId: answer.claimVersionId, xmlFormId: answer.xmlFormId, instanceId: answer.instanceId, path: answer.path, repeatIndex: answer.position, valueTruncated: answer.value.length > 2000, url: `/v1/field-data/claim-versions/${answer.claimVersionId}` } }))
      ];
      docs.sort((a, b) => Number(b.text.toLowerCase().includes(body.q.toLowerCase())) - Number(a.text.toLowerCase().includes(body.q.toLowerCase())) || a.id.localeCompare(b.id));
      return { projectId, ...scoreCorpus(docs, body.q, body.mode), q: body.q, mode: body.mode, at: snapshot.at, knownAt: snapshot.knownAt, corpusFingerprint: hash(docs.slice(0, 768)), request: { q: body.q, mode: body.mode, ...(body.xmlFormId == null ? {} : { xmlFormId: body.xmlFormId }), ...(body.paths == null ? {} : { paths: body.paths }), offset: body.offset ?? 0, at: snapshot.at, knownAt: snapshot.knownAt },
        corpus: { sources: sources.length, totalSources: sources.length ? Number(sources[0].total) : 0, offset: body.offset ?? 0, nextOffset: sources.length === 100 && Number(sources[0].total) > (body.offset ?? 0) + 100 ? (body.offset ?? 0) + 100 : null,
          documentsBeforeModelBound: docs.length, documentLimit: 768, fieldsPerSource: 30, repeatValuesPerField: 8, answerCharacterLimit: 2000, sourceXmlByteLimit: 262144, sourcePermissions: 'current', snapshotAssetsTruncated: snapshot.truncated } };
    });
    response.set('Cache-Control', 'private, no-store'); return result;
  }));
};
