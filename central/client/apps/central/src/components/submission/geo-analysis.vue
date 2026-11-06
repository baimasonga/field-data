<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="geo-analysis panel panel-default" aria-label="Satellite pixel analysis">
    <div class="panel-heading"><h2>Satellite pixel analysis and change review</h2></div>
    <div class="panel-body">
      <p>Retrieve Sentinel-2 provider footprints and analyse a 320 m neighbourhood on a common 10 m grid. The method compares red/NIR reflectance and NDVI, excluding cloud, shadow, snow, defective and no-data pixels. Candidates are spectral changes for human review, not proof of fraud, construction or presence.</p>
      <button class="btn btn-default" type="button" :disabled="busy" @click="load">{{ data ? 'Refresh satellite analysis history' : 'Load satellite analysis' }}</button>
      <p v-if="busy" role="status">Working… Raster analysis can take up to two minutes. A lost response can be recovered from history without running the same job again.</p>
      <p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
      <template v-if="data">
        <p>Method: {{ data.method }}. Footprints are retrieved from the configured catalogue over HTTPS; this verifies the metadata source, not the truth of the scene. The catalogue receives a coarse cell; image range reads can reveal the approximate analysis area. Answers and attachments are not sent.</p>
        <template v-if="data.canRun">
          <label><input v-model="consent" type="checkbox" :disabled="busy || !!pending"> Allow catalogue and public imagery requests for this analysis area.</label>
          <button type="button" class="btn btn-default" :disabled="!consent || busy || !!pending" @click="findScenes">Find provider scenes</button>
          <p>{{ data.scenes.length }} cached scenes offered around the reported visit or receipt date. Catalogue status: {{ data.catalogueStatus }}. {{ data.remaining }} analysis records remain in this submission's bounded history.</p>
          <fieldset :disabled="busy || !!pending">
            <label>Satellite analysis mode <select v-model="mode" class="form-control"><option value="footprint">Verify one provider footprint</option><option value="change">Analyse pixels and detect changes</option></select></label>
            <label>Earlier or footprint scene <select v-model="beforeId" class="form-control"><option value="">Choose a scene</option><option v-for="scene in data.scenes" :key="scene.id" :value="scene.id">{{ scene.id }} · {{ scene.at }} · {{ scene.cloud == null ? 'unknown' : scene.cloud + '%' }} scene cloud</option></select></label>
            <label v-if="mode === 'change'">Later comparison scene <select v-model="afterId" class="form-control"><option value="">Choose a later scene</option><option v-for="scene in data.scenes" :key="scene.id" :value="scene.id">{{ scene.id }} · {{ scene.at }}</option></select></label>
          </fieldset>
          <button type="button" class="btn btn-primary" :disabled="busy || !consent || (!pending && (!beforeId || !data.remaining || (mode === 'change' && !afterId)))" @click="run">{{ pending ? 'Recover same satellite analysis' : 'Run satellite analysis' }}</button>
          <p>Automatic candidates use |NDVI change| ≥ 0.2 or reflectance change ≥ 0.15, at least four connected 10 m pixels, and at least 50% clear paired coverage. The reported-position neighbourhood must also be clear. These fixed thresholds are not calibrated probabilities; season, illumination and registration can cause apparent change.</p>
        </template><p v-else>New analysis is unavailable for this source, permissions, encryption, project state or operator configuration. Existing history remains read-only.</p>
        <p v-if="data.items.length === 0">No satellite analysis has been recorded.</p>
        <button v-if="data.items.length" type="button" class="btn btn-default" @click="download">Export satellite analysis evidence</button>
        <ol class="analysis-history">
          <li v-for="item in data.items" :key="item.id">
            <h3>{{ item.mode === 'footprint' ? 'Provider footprint check' : 'Pixel change analysis' }} · {{ item.status }} · {{ item.sourceCurrent ? 'current source binding' : 'outdated source binding' }}</h3>
            <p>{{ item.actorName }} · {{ item.createdAt }} · source version {{ item.source.versionId }}</p>
            <p v-if="['pending', 'expired'].includes(item.status)">{{ item.status === 'pending' ? 'Job is pending. Refresh history to recover its outcome.' : 'The job expired without a confirmed result. A new request may be made.' }}</p>
            <p v-if="item.failure">Failed: {{ item.failure }}. No empty or successful image result was substituted.</p>
            <template v-if="item.result">
              <p>Result: {{ item.result.status }}<span v-if="item.result.reason"> · withheld: {{ item.result.reason }}</span>.</p>
              <template v-for="side in ['before', 'after']" :key="side">
                <div v-if="item.result.provider?.[side]">
                  <p>{{ side }} provider scene: <a :href="item.result.provider[side].metadataUrl" target="_blank" rel="noopener noreferrer">{{ item.result.provider[side].id }}</a> · {{ item.result.provider[side].at }} · retrieved {{ item.result.provider[side].fetchedAt }}</p>
                  <p>Reported point {{ item.result.provider[side].coverage.relation }}; reported accuracy {{ item.result.provider[side].coverage.accuracyRelation }}. Metadata fingerprint: <code>{{ item.result.provider[side].fingerprint }}</code>.</p>
                </div>
                <figure v-if="item.result[side]?.previewPng">
                  <img :src="`data:image/png;base64,${item.result[side].previewPng}`" :alt="`${side} NDVI index preview: ${item.result[side].validPixels} usable pixels; mean NDVI ${item.result[side].meanNdvi}. Dark pixels are masked.`" width="256" height="256">
                  <figcaption>{{ side }} NDVI index, not natural-colour imagery. Green indicates higher NDVI; red lower NDVI; dark grey is masked. Mean {{ item.result[side].meanNdvi }} from {{ item.result[side].validPixels }}/1024 valid pixels. Raw sampled values and hashes are included in the evidence export.</figcaption>
                </figure>
              </template>
              <p v-if="item.result.status === 'analysed'">Clear paired coverage: {{ percent(item.result.pairedCoverage) }}. Changed-pixel fraction: {{ percent(item.result.changedPixelFraction) }}. Mean NDVI delta: {{ item.result.meanNdviDelta }}.</p>
              <p v-if="item.result.status === 'analysed' && !item.result.candidates.length">No candidate exceeded this method's thresholds. This is not proof of no real-world change.</p>
              <p v-if="item.result.omittedCandidates">{{ item.result.omittedCandidates }} smaller candidates omitted from the bounded list.</p>
              <div v-for="candidate in item.result.candidates || []" :key="candidate.id" class="change-candidate">
                <h4>Candidate {{ candidate.id }} · {{ candidate.kind }}</h4>
                <p>{{ candidate.pixels }} connected pixels · nominal area {{ candidate.areaM2 }} m². Candidate footprint: <code>{{ JSON.stringify(candidate.geometry) }}</code>.</p>
                <p>Latest human disposition: {{ latest(item, candidate.id)?.action || 'unreviewed' }}.</p>
                <form v-if="data.canRun && item.sourceCurrent && item.revision < 50" @submit.prevent="review(item, candidate)">
                  <fieldset :disabled="busy || !!pending || !!reviewPending">
                    <label>Candidate {{ candidate.id }} decision <select v-model="decision(item.id, candidate.id).action" class="form-control"><option value="unclear">Unclear</option><option value="approve">Approve as a reviewed change candidate</option><option value="reject">Reject candidate</option></select></label>
                    <label>Candidate {{ candidate.id }} reasoning <textarea v-model="decision(item.id, candidate.id).reason" class="form-control" minlength="10" maxlength="2000" required></textarea></label>
                    <label><input v-model="decision(item.id, candidate.id).inspected" type="checkbox" required> I inspected both dated index previews, quality masks, source location and limitations.</label>
                  </fieldset>
                  <button type="submit" class="btn btn-default" :disabled="busy || !!pending || (!!reviewPending && (reviewPending.analysisId !== item.id || reviewPending.body.candidateId !== candidate.id))">{{ reviewPending ? 'Retry same candidate review' : 'Save candidate review' }}</button>
                </form>
              </div>
              <details v-if="item.reviews.length"><summary>Candidate review history ({{ item.reviews.length }})</summary><ol><li v-for="entry in item.reviews" :key="entry.id">Candidate {{ entry.candidateId }} · {{ entry.action }} · {{ entry.actorName }} · {{ entry.reviewedAt }} · {{ entry.reason }}</li></ol></details>
            </template>
          </li>
        </ol>
      </template>
    </div>
  </section>
</template>
<script setup>
import { onBeforeUnmount, reactive, ref, watch } from 'vue';
import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';

const props = defineProps({ projectId: { type: String, required: true }, xmlFormId: { type: String, required: true }, instanceId: { type: String, required: true }, sourceFingerprint: { type: String, required: true } });
const { request } = useRequest(); const data = ref(null); const busy = ref(false); const error = ref(''); const notice = ref(''); const consent = ref(false);
const mode = ref('footprint'); const beforeId = ref(''); const afterId = ref(''); const pending = ref(null); const reviewPending = ref(null); const decisions = reactive({}); let generation = 0;
const base = () => `${apiPaths.submission(props.projectId, props.xmlFormId, props.instanceId)}/geo-assessments/analyses`;
const percent = value => (Number.isFinite(value) ? `${Math.round(value * 1000) / 10}%` : 'unknown');
const latest = (item, id) => item.reviews.find(entry => entry.candidateId === id);
const decision = (id, candidate) => { const key = `${id}:${candidate}`; if (!decisions[key]) decisions[key] = { action: 'unclear', reason: '', inspected: false }; return decisions[key]; };
const valid = answer => answer && typeof answer.canRun === 'boolean' && Array.isArray(answer.items) && answer.items.length <= 20 &&
  answer.source && /^[a-f0-9]{64}$/.test(answer.source.fingerprint) && Array.isArray(answer.scenes) && answer.scenes.length <= 50 &&
  answer.scenes.every(scene => scene && typeof scene.id === 'string' && /^[a-f0-9]{64}$/.test(scene.fingerprint)) &&
  answer.items.every(item => item && item.source && /^[a-f0-9]{64}$/.test(item.source.fingerprint) && item.source.fingerprint === item.sourceFingerprint && typeof item.sourceCurrent === 'boolean' && Number.isInteger(item.revision) && item.revision >= 0 && item.revision <= 50 && typeof item.id === 'string' && ['pending', 'expired', 'complete', 'failed'].includes(item.status) && Array.isArray(item.reviews) && item.reviews.length <= 50 &&
    (!item.result?.provider || ['before', 'after'].every(side => !item.result.provider[side] || /^https:\/\//.test(item.result.provider[side].metadataUrl))));
const refresh = async current => {
  const answer = (await request({ method: 'GET', url: base(), alert: false })).data;
  if (!valid(answer) || answer.source.fingerprint !== props.sourceFingerprint) throw new Error('Invalid analysis history');
  if (current === generation) data.value = answer;
};
const load = async () => {
  generation += 1; const current = generation; busy.value = true; error.value = ''; notice.value = ''; data.value = null; pending.value = null; reviewPending.value = null;
  try { await refresh(current); } catch { if (current === generation) error.value = 'Satellite analysis history could not be loaded. Check access and refresh.'; } finally { if (current === generation) busy.value = false; }
};
const findScenes = async () => {
  if (busy.value || !consent.value || !data.value?.canRun) return;
  const current = generation; busy.value = true; error.value = ''; notice.value = '';
  try {
    const answer = (await request({ method: 'POST', url: `${base()}/scenes`, data: { sourceFingerprint: data.value.source.fingerprint, allowExternalProcessing: true }, alert: false, timeout: 25000 })).data;
    await refresh(current); if (current === generation) notice.value = answer.ok ? 'Provider scene list updated.' : 'Catalogue unavailable; previous cached scenes were retained.';
  } catch { if (current === generation) error.value = 'Scene search failed or the source changed. Refresh before trying again.'; } finally { if (current === generation) busy.value = false; }
};
const run = async () => {
  if (busy.value || !consent.value || !data.value?.canRun) return;
  const current = generation;
  if (!pending.value) {
    const before = data.value.scenes.find(scene => scene.id === beforeId.value); const after = mode.value === 'change' ? data.value.scenes.find(scene => scene.id === afterId.value) : null;
    if (!before || (mode.value === 'change' && (!after || Date.parse(before.at) >= Date.parse(after.at)))) { error.value = 'Choose a strictly later comparison scene.'; return; }
    pending.value = {
      requestId: crypto.randomUUID(), sourceFingerprint: data.value.source.fingerprint, mode: mode.value, beforeId: before.id, beforeFingerprint: before.fingerprint,
      afterId: after?.id ?? null, afterFingerprint: after?.fingerprint ?? null, allowExternalProcessing: true
    };
  }
  busy.value = true; error.value = ''; notice.value = '';
  try {
    await request({ method: 'POST', url: base(), data: pending.value, alert: false, timeout: 140000 });
    if (current === generation) { pending.value = null; await refresh(current); notice.value = 'Analysis outcome recorded. Review its status and any withheld reasons.'; }
  } catch { if (current === generation) error.value = 'Analysis response was not confirmed. Recover the same request or refresh history; a recovery never repeats its external reads.'; } finally { if (current === generation) busy.value = false; }
};
const review = async (item, candidate) => {
  if (busy.value || !data.value?.canRun) return; const current = generation; const draft = decision(item.id, candidate.id);
  if (!reviewPending.value) reviewPending.value = { analysisId: item.id, body: { requestId: crypto.randomUUID(), revision: item.revision, candidateId: candidate.id, action: draft.action, reason: draft.reason.trim(), reviewedImages: draft.inspected } };
  if (reviewPending.value.analysisId !== item.id || reviewPending.value.body.candidateId !== candidate.id) return;
  busy.value = true; error.value = '';
  try {
    await request({ method: 'POST', url: `${base()}/${item.id}/reviews`, data: reviewPending.value.body, alert: false });
    if (current === generation) { reviewPending.value = null; await refresh(current); notice.value = 'Candidate review recorded. Submission answers and review cases were unchanged.'; }
  } catch { if (current === generation) error.value = 'Candidate review was not confirmed. Retry the same review, or refresh after a source or revision change.'; } finally { if (current === generation) busy.value = false; }
};
const download = () => {
  const bytes = new Blob([JSON.stringify({
    format: 'field-data.geospatial-analysis@1', ...data.value,
    limitations: 'Provider metadata and sampled pixels are point-in-time snapshots. Spectral candidates are not calibrated ground-truth, fraud or presence determinations.'
  }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(bytes); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'satellite-analysis-evidence.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
watch(() => [props.projectId, props.xmlFormId, props.instanceId, props.sourceFingerprint], () => { generation += 1; data.value = null; busy.value = false; error.value = ''; consent.value = false; beforeId.value = ''; afterId.value = ''; pending.value = null; reviewPending.value = null; });
onBeforeUnmount(() => { generation += 1; pending.value = null; reviewPending.value = null; });
</script>
<style scoped>
.geo-analysis { margin-top: 24px; } .panel-body { padding: 20px; } h2 { font-size: 20px; margin: 0; } h3 { font-size: 17px; } h4 { font-size: 15px; }
label { display: block; margin-block: 12px; } button { white-space: normal; margin: 4px 0; } fieldset { min-width: 0; } p, a, code { overflow-wrap: anywhere; } code { white-space: normal; }
figure { display: inline-block; max-width: 100%; vertical-align: top; margin: 12px 16px 12px 0; width: 270px; } img { max-width: 100%; height: auto; image-rendering: pixelated; } figcaption { margin-top: 8px; }
.analysis-history { padding-left: 20px; } .analysis-history > li { border-top: 1px solid #ddd; padding-block: 12px; } .change-candidate { border-left: 3px solid #789; padding-left: 12px; margin-block: 16px; }
</style>
