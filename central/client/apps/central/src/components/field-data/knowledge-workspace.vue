<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="knowledge-workspace" aria-label="Knowledge workspace">
    <h2>Knowledge workspace</h2>
    <p>Cited maps, answer retrieval, review priorities and declared causal contracts. Every run rebuilds readable evidence; definitions contain shared project specifications, not cached respondent answers.</p>
    <button type="button" class="btn btn-default" :disabled="busy" @click="loadCatalogue(true)">{{ catalogue ? 'Refresh workspace and discard unsaved changes' : 'Open Knowledge workspace' }}</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="catalogue">
      <p>{{ catalogue.visibleAssets }} readable assets · {{ catalogue.withheldAssets }} withheld because source evidence is unavailable. {{ catalogue.truncated ? 'The asset catalogue is capped; narrow the project or use source passports for omitted records.' : '' }}</p>
      <nav aria-label="Knowledge tools" class="knowledge-tabs"><button v-for="tool of tools" :key="tool.kind" type="button" class="btn btn-default" :aria-pressed="tab === tool.kind" :disabled="busy || pending != null" @click="start(tool.kind)">{{ tool.label }}</button></nav>
      <p>Image identity review can compare any two readable assets, including pairs not found by duplicate-name rules. Perceptual differences support human review and never merge assets automatically.</p>
      <fieldset v-if="tab !== 'images'" :disabled="busy || pending != null"><legend>Evidence time cutoffs (UTC)</legend><label>Facts valid at<input v-model="at" type="datetime-local" class="form-control" @input="clearResults"></label><label>Evidence known at<input v-model="knownAt" type="datetime-local" class="form-control" @input="clearResults"></label><p>Leave blank for now. Historical runs rebuild ownership at the knowledge cutoff, including later undo, while enforcing today's source permissions.</p></fieldset>
      <datalist :id="`knowledge-facts-${projectId}`"><option v-for="predicate of catalogue.availablePredicates" :key="predicate" :value="predicate"></option></datalist>
      <template v-if="tab === 'retrieval'">
        <form @submit.prevent="search(false)">
<fieldset :disabled="busy">
<legend>Cited answer and semantic retrieval</legend>
          <label>Knowledge query<input v-model="query" class="form-control" minlength="2" maxlength="200" required @input="clearResults"></label>
          <label>Retrieval method<select v-model="mode" class="form-control" @change="clearResults"><option value="literal">Literal phrase</option><option value="semantic">Corpus-derived semantic association</option></select></label>
          <label>Source form ID (optional)<input v-model="sourceForm" class="form-control" maxlength="255" @input="clearResults"></label>
          <label>Answer field paths (optional, comma separated)<input v-model="paths" class="form-control" placeholder="/water, /household/member/name" @input="clearResults"></label>
          <button type="submit" class="btn btn-primary" :disabled="query.trim().length < 2">Search cited knowledge</button>
        </fieldset>
</form>
        <template v-if="retrieval">
          <p role="status">{{ retrieval.method }} · {{ retrieval.corpusDocuments }} corpus documents · {{ retrieval.latentDimensions }} latent dimensions · {{ retrieval.matched }} matches in this window.</p>
          <p>{{ retrieval.limitations }}</p><p>Sources {{ retrieval.corpus.offset + 1 }}–{{ retrieval.corpus.offset + retrieval.corpus.sources }} of {{ retrieval.corpus.totalSources }}. Limits: {{ retrieval.corpus.fieldsPerSource }} fields per source, {{ retrieval.corpus.repeatValuesPerField }} values per repeated field, {{ retrieval.corpus.documentLimit }} model documents; source XML up to {{ retrieval.corpus.sourceXmlByteLimit }} bytes. Specify field paths or a form to narrow coverage.</p>
          <p v-if="retrieval.queryTermsOutsideCorpus.length">No learned corpus meaning for: {{ retrieval.queryTermsOutsideCorpus.join(', ') }}.</p>
          <ol><li v-for="item of retrieval.results" :key="item.id"><strong>{{ item.kind }}</strong> · {{ item.literalMatch ? 'literal phrase match' : 'latent semantic association' }}<p>{{ item.excerpt }}</p><p v-if="item.semanticCosine != null">Corpus cosine: {{ item.semanticCosine.toFixed(3) }} (not confidence).</p><a v-if="safeSource(item.source?.url)" :href="item.source.url" target="_blank" rel="noopener">Source claim</a><span v-if="item.source?.path"> · {{ item.source.path }} · repeat position {{ item.source.repeatIndex }}</span><span v-if="item.integrityStatus"> · {{ item.integrityStatus }}</span><span v-if="item.freshness"> · {{ item.freshness.status }} · valid from {{ item.validFrom }}</span><button v-if="item.assetId && item.assetXmlFormId" type="button" class="btn btn-link" @click="emit('open', { assetId: item.assetId, xmlFormId: item.assetXmlFormId })">Open asset passport</button></li></ol>
          <button v-if="retrieval.corpus.nextOffset != null" type="button" class="btn btn-default" :disabled="busy" @click="search(true)">Search next corpus window</button>
          <button type="button" class="btn btn-default" @click="download(retrieval, 'knowledge-retrieval.json')">Download cited retrieval snapshot</button>
        </template>
      </template>
      <template v-else-if="tab === 'images'">
        <fieldset :disabled="busy"><legend>Choose any two readable asset identities</legend>
          <label>First asset<select v-model="imageA" class="form-control" @change="clearPhotoReview"><option value="">Choose first asset</option><option v-for="asset of catalogue.assets ?? []" :key="asset.id" :value="asset.id">{{ asset.name }} · {{ asset.externalId }}</option></select></label>
          <label>Second asset<select v-model="imageB" class="form-control" @change="clearPhotoReview"><option value="">Choose second asset</option><option v-for="asset of catalogue.assets ?? []" :key="asset.id" :value="asset.id">{{ asset.name }} · {{ asset.externalId }}</option></select></label>
          <p v-if="imageA && imageB && imageA === imageB">Choose two different assets.</p>
          <template v-if="firstImageAsset && secondImageAsset && imageA !== imageB">
            <asset-photo-comparison :key="`${imageA}:${imageB}`" :project-id="projectId" :a-id="imageA" :b-id="imageB" :a-name="firstImageAsset.name" :b-name="secondImageAsset.name" @ready="photoReady = $event; reviewedPhotos = false"/>
            <button type="button" class="btn btn-link" @click="emit('open', { assetId: imageA, xmlFormId: firstImageAsset.xmlFormId })">Open first asset passport</button><button type="button" class="btn btn-link" @click="emit('open', { assetId: imageB, xmlFormId: secondImageAsset.xmlFormId })">Open second asset passport</button>
            <p>To merge, open the keeper's passport and review the existing merge form and reason. Source permissions are checked again when an identity operation is saved.</p>
            <template v-if="catalogue.canManage"><label><input v-model="reviewedPhotos" type="checkbox" :disabled="!photoReady"> I reviewed both cited photos and their source context.</label><label>Reason these assets are distinct<textarea v-model="distinctReason" class="form-control" maxlength="2000"/></label><button type="button" class="btn btn-default" :disabled="distinctSaved || !photoReady || !reviewedPhotos || distinctReason.trim().length < 10" @click="markDistinct">Record distinct asset identities</button><p v-if="distinctSaved" role="status">Distinct-asset decision recorded. Its reason and withdrawal history are available under Possible duplicate assets.</p></template>
          </template>
        </fieldset>
      </template>
      <template v-else>
        <fieldset :disabled="busy || pending != null">
<legend>Saved shared definitions</legend>
          <label>Saved Knowledge definition<select v-model="selectedId" class="form-control" @change="selectDefinition"><option value="">Unsaved new definition</option><option v-for="item of catalogue.definitions" :key="item.id" :value="item.id">{{ item.title }} · {{ item.definition.kind }} · revision {{ item.revision }}{{ item.archived ? ' · archived' : '' }}</option></select></label>
          <p v-if="selectedId">Loaded revision {{ loadedRevision }}; current revision at selection {{ expectedRevision }}. {{ unchanged ? 'Running the pinned saved definition.' : 'Edits are an unsaved draft until explicitly saved.' }}</p>
          <label>Definition title<input v-model="title" class="form-control" maxlength="200"></label>
        </fieldset>
        <fieldset v-if="tab === 'geography'" :disabled="busy || pending != null">
<legend>Asset maps and location areas</legend>
          <label>Location fact name<input v-model="locationPredicate" class="form-control" :list="`knowledge-facts-${projectId}`" maxlength="100" @input="clearResults"></label>
          <label>Area label property<input v-model="areaLabel" class="form-control" maxlength="100"></label>
          <label>Import named area GeoJSON<input type="file" accept=".json,.geojson,application/geo+json" @change="readAreas"></label>
          <p>Use a WGS84 FeatureCollection of Polygon/MultiPolygon features with a unique label property. Up to 20 areas, 2,000 vertices and 64 KiB. Self-intersections and antimeridian-crossing polygons are refused.</p>
          <ul><li v-for="(area, index) of areas" :key="index"><label>Area {{ index + 1 }} name<input v-model="area.value" class="form-control" maxlength="200" @input="clearResults"></label></li></ul>
          <button v-if="areas.length" type="button" class="btn btn-default" @click="areas = []; clearResults()">Clear location areas</button>
        </fieldset>
        <fieldset v-if="tab === 'decision'" :disabled="busy || pending != null">
<legend>Explainable decision projection</legend>
          <p>Rules propose review actions from fresh source-verified facts. Unknown evidence does not become a negative answer, and no field task or decision is created automatically. Priority 1 is highest.</p>
          <div v-for="(rule, index) of rules" :key="index" class="knowledge-rule">
            <label>Rule {{ index + 1 }} fact<input v-model="rule.predicate" class="form-control" :list="`knowledge-facts-${projectId}`" maxlength="100" @input="clearResults"></label>
            <label>Rule {{ index + 1 }} comparison<select v-model="rule.operator" class="form-control" @change="clearResults"><option value="eq">equals</option><option value="neq">does not equal</option><option value="gt">greater than</option><option value="gte">at least</option><option value="lt">less than</option><option value="lte">at most</option></select></label>
            <label>Rule {{ index + 1 }} value<input v-model="rule.value" class="form-control" maxlength="200" @input="clearResults"></label>
            <label>Rule {{ index + 1 }} priority<input v-model.number="rule.priority" type="number" min="1" max="5" class="form-control" @input="clearResults"></label>
            <label>Rule {{ index + 1 }} review action<input v-model="rule.action" class="form-control" maxlength="500" @input="clearResults"></label>
            <button type="button" class="btn btn-link" :disabled="rules.length === 1" @click="rules.splice(index, 1); clearResults()">Remove rule {{ index + 1 }}</button>
          </div><button type="button" class="btn btn-default" :disabled="rules.length >= 20" @click="rules.push(newRule()); clearResults()">Add decision rule</button>
        </fieldset>
        <fieldset v-if="tab === 'causal'" :disabled="busy || pending != null">
<legend>Declared causal contract</legend>
          <p>Binary treatment facts must be coded 0/1; outcomes must be numeric. Adjustments are categorical strata. Confounder valid-from times must not follow treatment, and treatment must precede outcome. These are recorded time claims, not proof of ordering.</p>
          <label>Treatment fact<input v-model="treatment" class="form-control" :list="`knowledge-facts-${projectId}`" maxlength="100" @input="clearResults"></label><label>Outcome fact<input v-model="outcome" class="form-control" :list="`knowledge-facts-${projectId}`" maxlength="100" @input="clearResults"></label>
          <label>Adjustment facts (comma separated, up to five)<input v-model="adjustmentText" class="form-control" @input="clearResults"></label><label>Other graph variables (comma separated)<input v-model="otherNodes" class="form-control" @input="clearResults"></label>
          <button type="button" class="btn btn-default" @click="buildGraph">Propose confounder arrows for review</button>
          <p>Arrows are declared hypotheses, not relationships discovered from the data. Edit each direction before saving. An open backdoor path, descendant adjustment or missing treatment-to-outcome path withholds the estimate.</p>
          <div v-for="(edge, index) of edges" :key="index" class="knowledge-edge"><label>Arrow {{ index + 1 }} from<select v-model="edge[0]" class="form-control" @change="clearResults"><option v-for="node of nodes" :key="node" :value="node">{{ node }}</option></select></label><label>Arrow {{ index + 1 }} to<select v-model="edge[1]" class="form-control" @change="clearResults"><option v-for="node of nodes" :key="node" :value="node">{{ node }}</option></select></label><button type="button" class="btn btn-link" @click="edges.splice(index, 1); clearResults()">Remove arrow {{ index + 1 }}</button></div>
          <button type="button" class="btn btn-default" :disabled="edges.length >= 40" @click="edges.push([treatment, outcome]); clearResults()">Add causal arrow</button>
          <p>Required identification assumptions are declarations that software cannot certify:</p><label v-for="assumption of assumptionLabels" :key="assumption.key"><input v-model="assumptions[assumption.key]" type="checkbox" @change="clearResults"> {{ assumption.label }}</label>
          <label>Assumption rationale<textarea v-model="rationale" class="form-control" minlength="20" maxlength="2000" rows="3" @input="clearResults"></textarea></label>
        </fieldset>
        <button type="button" class="btn btn-primary" :disabled="busy || pending != null" @click="run">Rebuild cited evaluation</button>
        <template v-if="catalogue.canManage">
          <fieldset :disabled="busy || pending != null"><legend>Save a versioned project specification</legend><p>Titles, rules, areas, assumptions and change reasons are shared project metadata. Do not put private respondent data into them.</p><label>Reason for this definition revision<textarea v-model="reason" class="form-control" maxlength="2000"></textarea></label><label><input v-model="shared" type="checkbox"> I intend to share this specification with project readers.</label><label><input v-model="archived" type="checkbox"> Archive this definition (history remains available)</label></fieldset>
          <button type="button" class="btn btn-default" :disabled="busy || (!pending && (!title.trim() || !reason.trim() || !shared))" @click="save">{{ pending ? 'Retry same definition save' : selectedId ? 'Save definition revision' : 'Save shared definition' }}</button>
        </template>
        <button v-if="selectedId" type="button" class="btn btn-default" :disabled="busy || pending != null" @click="loadHistory(false)">Inspect definition history</button>
        <template v-if="history"><ol><li v-for="event of history.items" :key="event.revision">Revision {{ event.revision }} · {{ event.createdAt }} · account #{{ event.actorId }} · {{ event.reason }} <button type="button" class="btn btn-link" :disabled="busy || pending != null" @click="loadDefinition(event.snapshot)">Load revision as draft</button></li></ol><button v-if="history.nextBefore" type="button" class="btn btn-default" :disabled="busy" @click="loadHistory(true)">Load earlier definition history</button></template>
        <template v-if="evaluation">
          <p role="status">{{ evaluation.evaluation.method }} · valid at {{ evaluation.snapshot.at }} · known at {{ evaluation.snapshot.knownAt }} · rebuilt {{ evaluation.snapshot.rebuiltAt }}.</p>
          <p v-if="evaluation.snapshot.truncated">The 1,000-asset bound was reached; this is a partial project snapshot.</p><p>{{ evaluation.snapshot.withheldAssets }} assets withheld because of current source availability.</p>
          <knowledge-map v-if="tab === 'geography'" :key="evaluation.snapshot.rebuiltAt" :geography="evaluation.evaluation" @open="emit('open', $event)"/>
          <template v-if="tab === 'decision'"><div class="fd-table-scroll" tabindex="0" role="region" aria-label="Decision projection table"><table class="table"><thead><tr><th>Asset</th><th>Priority</th><th>Evidence status</th><th>Review actions and citations</th></tr></thead><tbody><tr v-for="row of evaluation.evaluation.rows" :key="row.assetId"><th>{{ row.name }}</th><td>{{ row.priority ?? '—' }}</td><td>{{ row.status }}<span v-if="row.unavailable.length"> · unavailable: {{ row.unavailable.join(', ') }}</span></td><td><p v-for="(match, index) of row.matched" :key="index">{{ match.action }} · {{ match.predicate }} {{ match.operator }} {{ match.value }} · <a v-if="safeSource(match.source.url)" :href="match.source.url" target="_blank" rel="noopener">Source claim</a></p></td></tr></tbody></table></div></template>
          <template v-if="tab === 'causal'">
            <p v-if="evaluation.evaluation.estimate" role="status">Conditional adjusted ATE: {{ evaluation.evaluation.estimate.effect.toFixed(4) }} · conditional normal 95% interval [{{ evaluation.evaluation.estimate.conditional95.map(value => value.toFixed(4)).join(', ') }}].</p>
            <p v-else role="status">Causal estimate withheld.</p><ul><li v-for="item of evaluation.evaluation.withheldReasons" :key="item">{{ item }}</li></ul>
            <p>{{ evaluation.evaluation.targetPopulation }}</p><p>Shared outcome-source groups: {{ evaluation.evaluation.sharedOutcomeSourceGroups }}. Shared sources can violate the declared independent-unit assumption; inspect input provenance.</p><p>{{ evaluation.evaluation.limitations }}</p><p>Eligible: {{ evaluation.evaluation.eligible }}; excluded for unavailable facts {{ evaluation.evaluation.excluded.unavailable }}, invalid values {{ evaluation.evaluation.excluded.invalidValue }}, or timing {{ evaluation.evaluation.excluded.timing }}.</p>
            <p v-for="(path, index) of evaluation.evaluation.graph.openBackdoorPaths" :key="index">Open backdoor path: {{ path.join(' — ') }}</p>
            <div class="fd-table-scroll" tabindex="0" role="region" aria-label="Causal overlap diagnostics"><table class="table"><thead><tr><th>Adjustment values</th><th>Treated</th><th>Control</th><th>Observed mean difference</th></tr></thead><tbody><tr v-for="(cell, index) of evaluation.evaluation.strata" :key="index"><td>{{ cell.values.length ? cell.values.join(' · ') : 'No adjustment variables' }}</td><td>{{ cell.treated }}</td><td>{{ cell.control }}</td><td>{{ cell.difference ?? 'withheld' }}</td></tr></tbody></table></div>
          </template>
          <button type="button" class="btn btn-default" @click="download(evaluation, 'knowledge-evaluation.json')">Download definition, diagnostics and cited inputs</button>
          <button v-if="tab === 'geography'" type="button" class="btn btn-default" @click="download({ type: 'FeatureCollection', features: evaluation.evaluation.features, knowledge: { at: evaluation.snapshot.at, knownAt: evaluation.snapshot.knownAt, rebuiltAt: evaluation.snapshot.rebuiltAt, definition: evaluation.definition, method: evaluation.evaluation.method, unavailable: evaluation.evaluation.unavailable, withheldAssets: evaluation.snapshot.withheldAssets, truncated: evaluation.snapshot.truncated } }, 'cited-assets.geojson')">Download cited asset GeoJSON</button>
          <details><summary>Input facts and provenance (first 100 assets; complete inputs in download)</summary><div v-for="asset of evaluation.snapshot.assets.slice(0, 100)" :key="asset.id"><h4>{{ asset.name }}</h4><p v-for="(fact, predicate) of asset.facts" :key="predicate">{{ predicate }}: {{ fact.state === 'known' ? fact.value : fact.state }} · {{ fact.freshness.status }} · {{ fact.integrityStatus }} · observation {{ fact.id }} · <a v-if="safeSource(fact.source.url)" :href="fact.source.url" target="_blank" rel="noopener">Source claim</a></p></div></details>
        </template>
      </template>
    </template>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import useRequest from '../../composables/request';
import KnowledgeMap from './knowledge-map.vue';
import AssetPhotoComparison from './asset-photo-comparison.vue';

defineOptions({ name: 'FieldDataKnowledgeWorkspace' });
const emit = defineEmits(['open']);
const props = defineProps({ projectId: { type: [String, Number], required: true } });
const { request } = useRequest(); const catalogue = ref(null); const busy = ref(false); const error = ref(''); const tab = ref('geography');
const tools = [{ kind: 'geography', label: 'Maps and location areas' }, { kind: 'images', label: 'Image identity review' }, { kind: 'retrieval', label: 'Answer and semantic retrieval' }, { kind: 'decision', label: 'Decision projections' }, { kind: 'causal', label: 'Causal contracts' }];
const assumptionLabels = [{ key: 'exchangeability', label: 'The adjustment set suffices for exchangeability (no remaining unmeasured confounding).' }, { key: 'consistency', label: 'Treatment and outcome have consistent definitions across these assets.' }, { key: 'positivity', label: 'Both treatment levels are possible in each adjustment stratum.' }, { key: 'noInterference', label: 'One asset’s treatment does not change another asset’s outcome.' }, { key: 'temporalOrder', label: 'Recorded valid-from times represent the required temporal ordering.' }, { key: 'independentUnits', label: 'Assets are independent analysis units for the sampling-variance calculation.' }];
const emptyAssumptions = () => Object.fromEntries(assumptionLabels.map(item => [item.key, false]));
const newRule = () => ({ predicate: 'condition', operator: 'eq', value: 'broken', priority: 1, action: 'Inspect evidence before planning repair.' });
const at = ref(''); const knownAt = ref(''); const selectedId = ref(''); const loadedRevision = ref(0); const expectedRevision = ref(0); const loadedDefinition = ref('');
const title = ref(''); const reason = ref(''); const shared = ref(false); const archived = ref(false); const pending = ref(null); const history = ref(null); const evaluation = ref(null); const retrieval = ref(null);
const locationPredicate = ref('location'); const areas = ref([]); const areaLabel = ref('name'); const rules = ref([newRule()]);
const treatment = ref('treatment'); const outcome = ref('outcome'); const adjustmentText = ref(''); const otherNodes = ref(''); const edges = ref([]); const assumptions = ref(emptyAssumptions()); const rationale = ref('');
const imageA = ref(''); const imageB = ref(''); const photoReady = ref(false); const reviewedPhotos = ref(false); const distinctReason = ref(''); const distinctSaved = ref(false);
const firstImageAsset = computed(() => catalogue.value?.assets?.find(asset => asset.id === imageA.value));
const secondImageAsset = computed(() => catalogue.value?.assets?.find(asset => asset.id === imageB.value));
const clearPhotoReview = () => { photoReady.value = false; reviewedPhotos.value = false; distinctReason.value = ''; distinctSaved.value = false; };
const query = ref(''); const mode = ref('literal'); const sourceForm = ref(''); const paths = ref(''); let generation = 0;
const base = () => `/v1/projects/${encodeURIComponent(props.projectId)}/knowledge`;
const split = value => value.split(',').map(item => item.trim()).filter(Boolean);
const nodes = computed(() => [...new Set([treatment.value.trim(), outcome.value.trim(), ...split(adjustmentText.value), ...split(otherNodes.value)].filter(Boolean))]);
const definition = () => (tab.value === 'geography' ? { kind: 'geography', locationPredicate: locationPredicate.value.trim(), areas: areas.value }
  : tab.value === 'decision' ? { kind: 'decision', rules: rules.value.map(rule => ({ ...rule, predicate: rule.predicate.trim(), value: rule.value.trim(), action: rule.action.trim() })) }
    : { kind: 'causal', nodes: nodes.value, edges: edges.value.map(edge => [...edge]), treatment: treatment.value.trim(), outcome: outcome.value.trim(), adjustments: split(adjustmentText.value), assumptions: { ...assumptions.value }, rationale: rationale.value.trim() });
const unchanged = computed(() => !['retrieval', 'images'].includes(tab.value) && loadedDefinition.value === JSON.stringify(definition()));
const safeSource = url => typeof url === 'string' && /^\/v1\/field-data\/claim-versions\/[0-9a-f-]{36}$/i.test(url);
const clearResults = () => { generation += 1; evaluation.value = null; retrieval.value = null; error.value = ''; };
const cutoffs = () => ({ ...(at.value ? { at: new Date(`${at.value}:00Z`).toISOString() } : {}), ...(knownAt.value ? { knownAt: new Date(`${knownAt.value}:00Z`).toISOString() } : {}) });
const failure = (errorValue, fallback) => {
  error.value = errorValue.response?.status === 412 ? 'The saved definition changed. Refresh the workspace before saving another revision.' : fallback;
  if ([403, 404].includes(errorValue.response?.status)) { catalogue.value = null; selectedId.value = ''; history.value = null; pending.value = null; }
  evaluation.value = null; retrieval.value = null;
};
const start = kind => {
  clearResults(); tab.value = kind; selectedId.value = ''; loadedRevision.value = 0; expectedRevision.value = 0; loadedDefinition.value = ''; title.value = ''; reason.value = ''; shared.value = false; archived.value = false; history.value = null;
  if (kind === 'images') { imageA.value = ''; imageB.value = ''; clearPhotoReview(); }
  else if (kind === 'geography') { locationPredicate.value = 'location'; areas.value = []; } else if (kind === 'decision') rules.value = [newRule()];
  else if (kind === 'causal') { treatment.value = 'treatment'; outcome.value = 'outcome'; adjustmentText.value = ''; otherNodes.value = ''; edges.value = []; assumptions.value = emptyAssumptions(); rationale.value = ''; }
};
const loadCatalogue = async discard => {
  if (busy.value) return; if (discard) { pending.value = null; start(tab.value); }
  generation += 1; const current = generation; busy.value = true; error.value = '';
  try { const { data } = await request({ method: 'GET', url: base(), alert: false }); if (data?.method !== 'knowledge-workspace@1' || !Array.isArray(data.definitions) || !Array.isArray(data.availablePredicates)) throw new Error(); if (current === generation) catalogue.value = data; } catch (caught) { if (current === generation) { catalogue.value = null; failure(caught, 'Knowledge workspace could not be loaded. Retry to check permissions and current evidence.'); } } finally { if (current === generation) busy.value = false; }
};
const applyDefinition = input => {
  const value = JSON.parse(JSON.stringify(input));
  if (value.kind === 'geography') { locationPredicate.value = value.locationPredicate; areas.value = value.areas; } else if (value.kind === 'decision') rules.value = value.rules;
  else { treatment.value = value.treatment; outcome.value = value.outcome; adjustmentText.value = value.adjustments.join(', '); otherNodes.value = value.nodes.filter(node => ![value.treatment, value.outcome, ...value.adjustments].includes(node)).join(', '); edges.value = value.edges; assumptions.value = value.assumptions; rationale.value = value.rationale; }
  loadedDefinition.value = JSON.stringify(definition());
};
const loadDefinition = row => {
  clearResults(); selectedId.value = row.id; loadedRevision.value = row.revision; expectedRevision.value = catalogue.value.definitions.find(item => item.id === row.id)?.revision ?? row.revision;
  title.value = row.title; archived.value = row.archived; reason.value = ''; shared.value = false; tab.value = row.definition.kind;
  applyDefinition(row.definition);
};
const selectDefinition = () => { const row = catalogue.value.definitions.find(item => item.id === selectedId.value); if (row) loadDefinition(row); else start(tab.value); };
const run = async () => {
  if (busy.value || pending.value) return; clearResults(); const current = generation; busy.value = true;
  try {
    const body = { ...(selectedId.value && unchanged.value ? { definitionId: selectedId.value, definitionRevision: loadedRevision.value } : { definition: definition() }), ...cutoffs() };
    const { data } = await request({ method: 'POST', url: `${base()}/evaluate`, data: body, alert: false });
    if (data?.method !== 'knowledge-evaluation@1' || !Array.isArray(data.snapshot?.assets) || !data.evaluation?.method) throw new Error();
    if (current === generation) evaluation.value = data;
  } catch (caught) { if (current === generation) failure(caught, `Evaluation could not be rebuilt. ${caught.response?.data?.message ?? 'Check the definition, source permissions and evidence cutoffs.'}`); } finally { if (current === generation) busy.value = false; }
};
const save = async () => {
  if (busy.value) return;
  pending.value ??= { id: selectedId.value || crypto.randomUUID(), body: { requestId: crypto.randomUUID(), expectedRevision: expectedRevision.value, title: title.value.trim(), definition: JSON.parse(JSON.stringify(definition())), reason: reason.value.trim(), archived: archived.value, shared: shared.value } };
  const current = generation; let committed = false; busy.value = true; error.value = '';
  try {
    const { data } = await request({ method: 'POST', url: `${base()}/definitions/${pending.value.id}`, data: pending.value.body, alert: false });
    if (current !== generation) return;
    committed = true; applyDefinition(data.definition); title.value = data.title; archived.value = data.archived; pending.value = null; selectedId.value = data.id; expectedRevision.value = data.revision; loadedRevision.value = data.revision; loadedDefinition.value = JSON.stringify(data.definition); reason.value = ''; shared.value = false;
    const list = await request({ method: 'GET', url: base(), alert: false }); if (current === generation) catalogue.value = list.data;
  } catch (caught) {
    if (current === generation) {
      if ([400, 412].includes(caught.response?.status)) pending.value = null;
      failure(caught, committed ? 'Definition was saved, but the workspace could not refresh. Reopen it to check access and the saved revision.' : `Definition save could not be confirmed. ${caught.response?.data?.message ?? 'Retry the same save, or refresh the workspace to check history before changing it.'}`);
    }
  } finally { if (current === generation) busy.value = false; }
};
const loadHistory = async earlier => {
  if (busy.value) return; const current = generation; busy.value = true; error.value = '';
  try { const { data } = await request({ method: 'GET', url: `${base()}/definitions/${selectedId.value}/history`, params: earlier ? { before: history.value.nextBefore } : {}, alert: false }); if (!Array.isArray(data.items)) throw new Error(); if (current === generation) history.value = { ...data, items: earlier ? [...history.value.items, ...data.items] : data.items }; } catch (caught) { if (current === generation) failure(caught, 'Definition history could not be loaded. Refresh before relying on this definition.'); } finally { if (current === generation) busy.value = false; }
};
const search = async next => {
  if (busy.value) return; const prior = retrieval.value; const body = { q: query.value.trim(), mode: mode.value, ...(sourceForm.value.trim() ? { xmlFormId: sourceForm.value.trim() } : {}), ...(paths.value.trim() ? { paths: split(paths.value) } : {}), ...cutoffs(), ...(next && prior ? { offset: prior.corpus.nextOffset, knownAt: prior.knownAt } : {}) };
  clearResults(); const current = generation; busy.value = true;
  try { const { data } = await request({ method: 'POST', url: `${base()}/retrieval`, data: body, alert: false }); if (!Array.isArray(data.results) || !data.corpus || typeof data.method !== 'string') throw new Error(); if (current === generation) retrieval.value = data; } catch (caught) { if (current === generation) failure(caught, 'Cited retrieval could not be completed. Check source access and narrow the corpus before retrying.'); } finally { if (current === generation) busy.value = false; }
};
const buildGraph = () => { const adjusted = split(adjustmentText.value); edges.value = [[treatment.value.trim(), outcome.value.trim()], ...adjusted.flatMap(node => [[node, treatment.value.trim()], [node, outcome.value.trim()]])]; clearResults(); };
const markDistinct = async () => {
  if (busy.value || distinctSaved.value || !photoReady.value || !reviewedPhotos.value || distinctReason.value.trim().length < 10) return;
  const current = generation; busy.value = true; error.value = ''; distinctSaved.value = false;
  try {
    await request({ method: 'POST', url: `/v1/field-data/projects/${encodeURIComponent(props.projectId)}/assets/duplicates/dismissals`, data: { assetIds: [imageA.value, imageB.value], reason: distinctReason.value.trim() }, alert: false });
    if (current === generation) distinctSaved.value = true;
  } catch (caught) { if (current === generation) failure(caught, 'The distinct-asset decision could not be confirmed. Check the existing identity history before retrying; a prior decision may already exist.'); }
  finally { if (current === generation) busy.value = false; }
};
const readAreas = async event => {
  clearResults(); const current = generation; busy.value = true;
  try {
    const file = event.target.files?.[0]; if (!file) return;
    if (file.size > 65536) throw new Error(); const json = JSON.parse(await file.text());
    if (json.type !== 'FeatureCollection' || !Array.isArray(json.features) || json.features.length > 20) throw new Error();
    const next = json.features.map(feature => ({ value: String(feature.properties?.[areaLabel.value] ?? '').trim(), geometry: feature.geometry }));
    if (next.some(area => !area.value)) throw new Error(); if (current === generation) areas.value = next;
  } catch { if (current === generation) error.value = 'Area file could not be read. Use a named Polygon/MultiPolygon FeatureCollection within 64 KiB.'; }
  finally { if (current === generation) busy.value = false; }
};
const download = (value, filename) => { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: filename.endsWith('.geojson') ? 'application/geo+json' : 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); };
onBeforeUnmount(() => { generation += 1; catalogue.value = null; evaluation.value = null; retrieval.value = null; });
</script>
<style scoped>
.knowledge-workspace { margin: 24px 0; border-top: 1px solid #bcccdc; padding-top: 16px; overflow-wrap: anywhere; }
.fd-table-scroll { overflow-x: auto; max-width: 100%; }
.fd-table-scroll table { min-width: 640px; }
input, select, textarea { max-width: 100%; }
input[type='file'] { width: 100%; }
.knowledge-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
label { display: block; margin: 8px 0; } fieldset { margin: 16px 0; }
.knowledge-rule, .knowledge-edge { padding: 10px; margin: 8px 0; border: 1px solid #d9e2ec; }
input[type='datetime-local'] { max-width: 100%; }
.btn { white-space: normal; }
</style>
