<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="geo-assessments panel panel-default" aria-label="Geospatial verification">
    <div class="panel-heading"><h2>Geospatial verification</h2></div>
    <div class="panel-body">
      <p>Compare reported location and visit dates with dated imagery references. Assessments are human interpretations; they do not prove presence or automatically change answers or review cases.</p>
      <button class="btn btn-default" type="button" :disabled="busy || loading" @click="load">Refresh geospatial history</button>
      <p v-if="loading" role="status">Loading geospatial evidence…</p><p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
      <template v-if="data">
        <h3>Current submission evidence</h3>
        <p v-if="data.source.encrypted">Encrypted source: its location and device time are not interpreted.</p>
        <p v-else-if="data.source.location">Reported location {{ data.source.location.latitude }}, {{ data.source.location.longitude }} · reported accuracy {{ data.source.location.accuracy == null || data.source.location.accuracy < 0 ? 'unknown or invalid' : `${data.source.location.accuracy} m` }}. This is not certified positional accuracy.</p>
        <p v-else>No usable reported location. Supporting or conflicting assessments are unavailable.</p>
        <p><record-date-time :iso="data.source.visitAt"/> · {{ data.source.visitBasis === 'receipt' ? 'Server receipt time; visit time unavailable.' : 'Device audit start; device time is not independently verified.' }}</p>
        <a :href="`${submissionBase}/versions/${encodeURIComponent(data.source.versionId)}.xml`" target="_blank" rel="noopener noreferrer">Download cited submission XML</a>
        <h3>Imagery catalogue references</h3>
        <p>Availability is for a {{ data.catalogue.cellDegrees }}° grid cell, not an exact location footprint. Cloud cover is a scene estimate. Metadata alone does not show what an image depicts.</p>
        <p v-if="!data.catalogue.enabled">Live catalogue checks are off. You can still cite cached metadata or a dated imagery reference.</p>
        <p v-if="data.catalogue.status !== 'complete'" role="status">Catalogue status: {{ catalogueLabel(data.catalogue.status) }}.</p>
        <template v-else>
          <p>Checked <record-date-time :iso="data.catalogue.checkedAt"/><template v-if="data.catalogue.stale"> · cache older than seven days</template> · {{ data.catalogue.scenes.length }} candidates shown<template v-if="data.catalogue.omitted">; {{ data.catalogue.omitted }} further scenes omitted</template>.</p>
          <p v-if="!data.catalogue.scenes.length">The complete cached search contains no scene within {{ data.catalogue.windowDays }} days. This does not establish what happened on the ground.</p>
          <details v-else>
<summary>Inspect candidate dates and cloud cover</summary><ul>
            <li v-for="scene in data.catalogue.scenes" :key="scene.id"><a :href="scene.metadataUrl" target="_blank" rel="noopener noreferrer">{{ scene.id }} metadata</a> · <record-date-time :iso="scene.at"/> · {{ offset(scene.at, data.source.visitAt) }} · {{ scene.cloud == null ? 'cloud cover unknown' : `${scene.cloud}% scene cloud` }}</li>
          </ul>
</details>
        </template>
        <p v-if="data.canCheck">A check sends only the cell centre and whole-day window to the configured catalogue.</p>
        <button v-if="data.canCheck" type="button" class="btn btn-default" :disabled="busy || pending != null" @click="checkCatalogue">Check this location's imagery availability</button>
        <p v-if="!data.items.length">No geospatial assessment has been recorded.</p>
        <p v-else-if="data.items[0].state === 'outdated'" class="outdated" role="status">Latest assessment outdated: submission evidence or cited catalogue metadata changed. Record a new assessment.</p>
        <button v-if="data.items.length" class="btn btn-default" type="button" @click="download">Download geospatial assessment history</button>
        <ol class="geo-history">
<li v-for="item in data.items" :key="item.id">
          <h3>{{ outcomeLabel(item.outcome) }} · {{ item.state === 'current' ? 'Latest assessment for current evidence' : item.state === 'outdated' ? 'Outdated assessment' : 'Superseded assessment' }}</h3>
          <p>{{ item.actorName }} · <record-date-time :iso="item.reviewedAt"/></p>
          <h4>Claim assessed</h4><p>{{ item.claim }}</p><h4>Reasoning</h4><p>{{ item.reason }}</p><h4>Limitations</h4><p>{{ item.limitations }}</p>
          <p>Source version: {{ item.source.versionId }} · {{ item.source.visitBasis === 'receipt' ? 'receipt time, visit unknown' : 'device-reported visit time' }} <record-date-time :iso="item.source.visitAt"/></p>
          <template v-if="item.citation">
            <p v-if="item.citation.kind === 'catalogue'">
Catalogue scene {{ item.citation.sceneId }} · <record-date-time :iso="item.citation.at"/> · {{ offset(item.citation.at, item.source.visitAt, item.source.visitBasis) }} · {{ item.citation.cloud == null ? 'cloud cover unknown' : `${item.citation.cloud}% scene cloud` }}<template v-if="item.citation.staleAtReview"> · cache was older than seven days at review</template>.
              <a :href="item.citation.metadataUrl" target="_blank" rel="noopener noreferrer">Cited scene metadata</a>
</p>
            <p v-else>Reviewer reference: {{ item.citation.title }} · image dated {{ item.citation.date }} · {{ offset(item.citation.date, item.source.visitAt, item.source.visitBasis) }}. Image content and date are reviewer assertions; external changes are not monitored.</p>
            <p v-if="item.citation.url"><a :href="item.citation.url" target="_blank" rel="noopener noreferrer">Open cited image reference</a> · reviewer attested to inspecting the image.</p>
            <p v-else>Metadata-only assessment; no image inspection recorded.</p>
          </template><p v-else>No imagery citation; evidence was unclear or unavailable.</p>
          <p v-if="item.citationStatus === 'catalogue-changed'" class="outdated">Cited catalogue metadata changed or is no longer available.</p>
          <details><summary>Recorded source fingerprints</summary><code>{{ item.sourceFingerprint }}</code><p>XML: <code>{{ item.source.xmlHash }}</code></p><p>Attachments: <code>{{ item.source.attachmentsHash }}</code></p></details>
        </li>
</ol>
        <form v-if="data.canAssess" @submit.prevent="save">
          <h3>{{ data.items.length ? 'Add a revised assessment' : 'Record a geospatial assessment' }}</h3>
          <fieldset :disabled="busy || pending != null">
            <label>Claim being assessed <textarea v-model="claim" class="form-control" required minlength="10" maxlength="2000" rows="2"></textarea></label>
            <label>Evidence outcome <select v-model="outcome" class="form-control" required>
              <option value="unclear">Unclear</option><option value="unavailable">Unavailable</option><option value="supports" :disabled="!data.source.location">Supports the claim</option><option value="conflicts" :disabled="!data.source.location">Conflicts with the claim</option>
            </select></label>
            <label v-if="outcome !== 'unavailable'">Imagery citation <select v-model="citationKind" class="form-control"><option value="none" :disabled="positive">No citation</option><option value="reference">Dated image reference</option><option value="catalogue" :disabled="!data.catalogue.scenes.length">Cached catalogue scene</option></select></label>
            <template v-if="outcome !== 'unavailable' && citationKind === 'reference'">
              <label>Reference title <input v-model="title" class="form-control" required maxlength="300"></label>
              <label>Image date <input v-model="date" class="form-control" type="date" required :max="today"></label>
            </template>
            <label v-if="outcome !== 'unavailable' && citationKind === 'catalogue'">Catalogue scene <select v-model="sceneId" class="form-control" required><option disabled value="">Choose a scene…</option><option v-for="scene in data.catalogue.scenes" :key="scene.id" :value="scene.id">{{ scene.id }} · {{ scene.at.slice(0, 10) }} · {{ scene.cloud == null ? 'cloud unknown' : `${scene.cloud}% cloud` }}</option></select></label>
            <template v-if="outcome !== 'unavailable' && citationKind !== 'none'">
              <label>Image reference URL <input v-model="url" class="form-control" type="url" maxlength="2048" :required="positive || citationKind === 'reference'" placeholder="https://"></label>
              <p>Use a nonsecret HTTPS reference to imagery you can inspect. The server does not fetch or archive this URL. A scene metadata link alone is not an image inspection.</p>
              <label class="attestation"><input v-model="reviewedImage" type="checkbox" :required="positive || citationKind === 'reference' || !!url.trim()"> I inspected the cited image, its date and the reported location.</label>
            </template>
            <label>Assessment reasoning <textarea v-model="reason" class="form-control" required minlength="10" maxlength="2000" rows="3"></textarea></label>
            <label>Evidence limitations <textarea v-model="limitations" class="form-control" required minlength="10" maxlength="2000" rows="3" placeholder="Consider dates, seasons, viewpoint, cloud, resolution, reported position and visit-time uncertainty."></textarea></label>
          </fieldset>
          <button class="btn btn-primary" type="submit" :disabled="busy">{{ pending ? 'Retry same geospatial assessment' : 'Save geospatial assessment' }}</button>
        </form>
        <p v-else>New assessments are unavailable with your current permissions, for an archived/encrypted source, or after the 50-assessment limit.</p>
      </template>
    </div>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import RecordDateTime from '../date-time.vue';
import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';

defineOptions({ name: 'SubmissionGeoAssessments' });
const props = defineProps({ projectId: { type: String, required: true }, xmlFormId: { type: String, required: true }, instanceId: { type: String, required: true } });
const { request } = useRequest(); const data = ref(null); const loading = ref(false); const busy = ref(false); const error = ref(''); const notice = ref('');
const claim = ref(''); const outcome = ref('unclear'); const reason = ref(''); const limitations = ref(''); const citationKind = ref('none');
const title = ref(''); const date = ref(''); const url = ref(''); const sceneId = ref(''); const reviewedImage = ref(false); const pending = ref(null); let generation = 0;
const today = new Date().toISOString().slice(0, 10); const positive = computed(() => ['supports', 'conflicts'].includes(outcome.value));
const submissionBase = computed(() => apiPaths.submission(props.projectId, props.xmlFormId, props.instanceId)); const base = computed(() => `${submissionBase.value}/geo-assessments`);
const safeLink = value => { try { const link = new URL(value); return typeof value === 'string' && link.protocol === 'https:' && !link.username && !link.password; } catch { return false; } };
const validHash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const validSource = source => source && validHash(source.fingerprint) && typeof source.versionId === 'string' && Number.isFinite(Date.parse(source.visitAt)) && ['receipt', 'device-audit-log'].includes(source.visitBasis) &&
  (source.location == null || (Number.isFinite(source.location.latitude) && Math.abs(source.location.latitude) <= 90 && Number.isFinite(source.location.longitude) && Math.abs(source.location.longitude) <= 180));
const validItem = item => item && typeof item.id === 'string' && Number.isInteger(item.sequence) && item.sequence >= 1 && item.sequence <= 50 && validSource(item.source) &&
  validHash(item.sourceFingerprint) && item.source.fingerprint === item.sourceFingerprint && ['current', 'outdated', 'superseded'].includes(item.state) && ['supports', 'conflicts', 'unclear', 'unavailable'].includes(item.outcome) &&
  typeof item.claim === 'string' && typeof item.reason === 'string' && typeof item.limitations === 'string' && typeof item.bindingCurrent === 'boolean' &&
  (item.citation == null || ((item.citation.url == null || safeLink(item.citation.url)) && (item.citation.kind === 'reference' ? /^\d{4}-\d{2}-\d{2}$/.test(item.citation.date) && Number.isFinite(Date.parse(item.citation.date)) && new Date(item.citation.date).toISOString().slice(0, 10) === item.citation.date
    : item.citation.kind === 'catalogue' && safeLink(item.citation.metadataUrl) && Number.isFinite(Date.parse(item.citation.at)))));
const outcomeLabel = value => ({ supports: 'Supports the claim', conflicts: 'Conflicts with the claim', unclear: 'Unclear', unavailable: 'Unavailable' }[value]);
const catalogueLabel = value => ({ 'not-checked': 'not checked', 'no-location': 'no usable location', encrypted: 'encrypted source', incomplete: 'incomplete cached result', 'invalid-cache': 'invalid cached result', 'not-configured': 'catalogue configuration unavailable' }[value] ?? value);
const offset = (at, visit, basis = data.value?.source.visitBasis) => {
  const day = value => Date.parse(new Date(value).toISOString().slice(0, 10));
  const days = (day(at) - day(visit)) / 86400000;
  return days === 0 ? 'same UTC day' : `${Math.abs(days)} days ${days < 0 ? 'before' : 'after'} the ${basis === 'receipt' ? 'receipt' : 'reported visit'}`;
};
const reset = () => { pending.value = null; claim.value = ''; outcome.value = 'unclear'; reason.value = ''; limitations.value = ''; citationKind.value = 'none'; title.value = ''; date.value = ''; url.value = ''; sceneId.value = ''; reviewedImage.value = false; };
const load = async () => {
  generation += 1; const current = generation; data.value = null; reset(); busy.value = false; loading.value = true; error.value = ''; notice.value = '';
  try {
    const answer = (await request({ method: 'GET', url: base.value, alert: false })).data;
    if (!answer || !validSource(answer.source) || typeof answer.canAssess !== 'boolean' || typeof answer.canCheck !== 'boolean' || !Number.isInteger(answer.revision) || answer.revision < 0 || answer.revision > 50 ||
      !answer.catalogue || !Array.isArray(answer.catalogue.scenes) || answer.catalogue.scenes.length > 50 || answer.catalogue.scenes.some(s => !s || typeof s.id !== 'string' || !validHash(s.fingerprint) || !Number.isFinite(Date.parse(s.at)) || !safeLink(s.metadataUrl)) ||
      !Array.isArray(answer.items) || answer.items.length > 50 || !answer.items.every(validItem)) throw new Error('Invalid geospatial history');
    if (current === generation) { data.value = answer; claim.value = answer.items[0]?.claim ?? ''; }
  } catch { if (current === generation) error.value = 'Geospatial history could not be loaded. Refresh to check your access and source evidence.'; } finally { if (current === generation) loading.value = false; }
};
const save = async () => {
  if (busy.value || !data.value?.canAssess) return; const current = generation; error.value = ''; notice.value = '';
  if (!pending.value) {
    let citation = null;
    if (outcome.value !== 'unavailable' && citationKind.value === 'reference') citation = { kind: 'reference', title: title.value.trim(), url: url.value.trim(), date: date.value };
    if (outcome.value !== 'unavailable' && citationKind.value === 'catalogue') {
      const selected = data.value.catalogue.scenes.find(s => s.id === sceneId.value); if (!selected) { error.value = 'Choose a catalogue scene.'; return; }
      citation = { kind: 'catalogue', sceneId: selected.id, sceneFingerprint: selected.fingerprint, url: url.value.trim() || null };
    }
    if ((positive.value && (!citation?.url || !reviewedImage.value)) || (citation?.url && (!safeLink(citation.url) || !reviewedImage.value))) { error.value = 'Cite a nonsecret HTTPS image reference and confirm that you inspected it.'; return; }
    pending.value = {
      requestId: crypto.randomUUID(), revision: data.value.revision, sourceFingerprint: data.value.source.fingerprint, outcome: outcome.value,
      claim: claim.value.trim(), reason: reason.value.trim(), limitations: limitations.value.trim(), citation, reviewedImage: citation?.url ? reviewedImage.value : false
    };
  }
  busy.value = true;
  try {
    await request({ method: 'POST', url: base.value, data: pending.value, alert: false });
    if (current === generation) { const next = generation + 1; await load(); if (next === generation) notice.value = 'Geospatial assessment recorded. Answers and submission review status were not changed.'; }
  } catch (failure) {
    if (current === generation) error.value = [400, 409].includes(failure.response?.status) ? 'Source, citation or revision changed, or the assessment is invalid. Refresh before recording another assessment.'
      : 'Assessment could not be confirmed. Retry the same assessment or refresh to check its history.';
  } finally { if (current === generation) busy.value = false; }
};
const checkCatalogue = async () => {
  if (busy.value || pending.value || !data.value?.canCheck) return; const current = generation; busy.value = true; error.value = ''; notice.value = '';
  try {
    const answer = (await request({ method: 'POST', url: `${base.value}/catalogue/check`, data: { sourceFingerprint: data.value.source.fingerprint }, alert: false, timeout: 25000 })).data;
    if (current === generation) { const next = generation + 1; await load(); if (next === generation) notice.value = answer.ok ? 'Catalogue availability updated. Inspect imagery separately before assessing the claim.' : 'Catalogue unavailable. No empty imagery result was substituted; cached references may be older.'; }
  } catch { if (current === generation) error.value = 'Catalogue check could not be completed or the source changed. Refresh to check current evidence.'; } finally { if (current === generation) busy.value = false; }
};
const download = () => {
  const blob = new Blob([JSON.stringify({
    format: 'field-data.geo-assessments@1', source: data.value.source, items: data.value.items,
    limitation: 'Authenticated review history; external imagery is not archived or continuously verified. No scene-truth or presence certification.'
  }, null, 2)], { type: 'application/json' });
  const href = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = href; anchor.download = 'geospatial-assessments.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
};
watch(outcome, value => { if (['supports', 'conflicts'].includes(value) && citationKind.value === 'none') citationKind.value = 'reference'; });
watch(() => [props.projectId, props.xmlFormId, props.instanceId], load, { immediate: true });
onBeforeUnmount(() => { generation += 1; pending.value = null; });
</script>
<style scoped>
.geo-assessments { margin-top: 24px; } .panel-body { padding: 20px; } h2 { font-size: 20px; margin: 0; } h3 { font-size: 17px; margin-top: 20px; } h4 { font-size: 14px; font-weight: bold; }
p, li, a, code { overflow-wrap: anywhere; } code { white-space: normal; } label { display: block; margin: 12px 0; } .attestation { font-weight: normal; } button { white-space: normal; margin: 4px 0; }
.geo-history { padding-left: 20px; } .geo-history > li { border-top: 1px solid #dce5e9; padding: 12px 0; } summary { cursor: pointer; padding: 8px 0; } .outdated { color: #805300; }
</style>
