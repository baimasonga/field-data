<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <div class="capture-assessment">
    <a v-if="item.status === 'bound'" :href="`${base}/image`" target="_blank" rel="noopener noreferrer">Download originally challenged image</a>
    <p v-if="item.sceneReview === 'outdated'" class="outdated" role="status">Assessment outdated: the attachment or submission version changed. Previous decisions remain in history.</p>
    <p v-else-if="records.length">Human assessment recorded. It describes this image and does not certify location, device or capture time.</p>
    <ol v-if="records.length" class="assessment-history">
      <li v-for="record of records" :key="record.id">
        <strong>{{ record.reviewerName }}</strong> · <record-date-time :iso="record.reviewedAt"/>
        <p>Code: {{ codeLabel(record.codeAssessment) }} · Scene: {{ sceneLabel(record.sceneAssessment) }}</p>
        <p v-if="record.note">{{ record.note }}</p>
      </li>
    </ol>
    <button v-if="nextBefore != null" type="button" class="btn btn-default" :disabled="busy" @click="earlier">Load earlier assessments</button>
    <form v-if="item.canAssess" @submit.prevent="save">
      <h4>{{ records.length ? 'Add a revised assessment' : 'Assess the challenged photo' }}</h4>
      <fieldset :disabled="busy">
        <label>Code visibility <select v-model="codeAssessment" class="form-control" required>
          <option disabled value="">Choose…</option><option value="visible">Matching challenge code is visible</option><option value="not-visible">Matching code is absent or different</option><option value="unclear">Unable to assess the code</option>
        </select></label>
        <label>Scene supports the claim <select v-model="sceneAssessment" class="form-control" required>
          <option disabled value="">Choose…</option><option value="supports">Scene supports the claim</option><option value="does-not-support">Scene does not support the claim</option><option value="unclear">Unable to assess the scene</option>
        </select></label>
        <label>Assessment notes <textarea v-model="note" class="form-control" maxlength="2000" :required="codeAssessment !== 'visible' || sceneAssessment !== 'supports'" rows="3"></textarea></label>
        <label class="attestation"><input v-model="reviewedOriginal" type="checkbox" required> I reviewed the originally challenged image for this code and scene.</label>
        <button type="submit" class="btn btn-primary" :disabled="!codeAssessment || !sceneAssessment || !reviewedOriginal">Save photo assessment</button>
      </fieldset>
    </form>
    <p v-if="message" role="status">{{ message }}</p><p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import RecordDateTime from '../record-date-time.vue';
import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { codeLabel, sceneLabel, validHistory, validRecords } from '../../util/capture-assessment';

defineOptions({ name: 'SubmissionCaptureAssessment' });
const props = defineProps({ item: { type: Object, required: true }, projectId: { type: String, required: true }, xmlFormId: { type: String, required: true }, instanceId: { type: String, required: true } });
const emit = defineEmits(['saved', 'refresh']);
const { request } = useRequest(); const busy = ref(false); const error = ref(''); const message = ref(''); const records = ref([]); const nextBefore = ref(null);
const codeAssessment = ref(''); const sceneAssessment = ref(''); const note = ref(''); const reviewedOriginal = ref(false);
let generation = 0; let pending = null;
onBeforeUnmount(() => { generation += 1; });
const base = computed(() => `${apiPaths.submission(props.projectId, props.xmlFormId, props.instanceId)}/capture-challenges/${encodeURIComponent(props.item.id)}`);
watch(() => props.item, item => {
  generation += 1; pending = null; busy.value = false; error.value = ''; message.value = '';
  reviewedOriginal.value = false; records.value = item.assessments?.items ?? []; nextBefore.value = item.assessments?.nextBefore ?? null;
}, { immediate: true });
const save = async () => {
  if (busy.value || !props.item.canAssess || !codeAssessment.value || !sceneAssessment.value || !reviewedOriginal.value) return;
  const current = generation;
  const body = { codeAssessment: codeAssessment.value, sceneAssessment: sceneAssessment.value, note: note.value.trim(), reviewedOriginal: true };
  if ((body.codeAssessment !== 'visible' || body.sceneAssessment !== 'supports') && !body.note) { error.value = 'Add notes explaining the concern or uncertainty.'; return; }
  const signature = JSON.stringify(body);
  if (pending && pending.signature !== signature) { error.value = 'The earlier save was interrupted. Refresh capture challenges before changing that assessment.'; return; }
  pending ??= { signature, body: { ...body, requestId: crypto.randomUUID() }, revision: props.item.revision ?? 0 };
  busy.value = true; error.value = ''; message.value = '';
  try {
    const response = await request({
      method: 'POST', url: `${base.value}/assessments`, data: pending.body,
      headers: { 'If-Match': `"capture-${pending.revision}"` }, alert: false
    });
    if (current !== generation) return;
    if (!response.data.assessment || !validRecords([response.data.assessment])) throw new Error('Invalid assessment response');
    pending = null; codeAssessment.value = ''; sceneAssessment.value = ''; note.value = ''; reviewedOriginal.value = false; message.value = 'Photo assessment saved.'; emit('saved');
  } catch (failure) {
    if (current !== generation) return;
    const status = failure.response?.status;
    if ([409, 412].includes(status)) { pending = null; error.value = 'The attachment or assessment changed. Refresh capture challenges before reviewing again.'; emit('refresh'); } else error.value = 'Assessment could not be saved. Retry the same decision, or refresh before changing it.';
  } finally { if (current === generation) busy.value = false; }
};
const earlier = async () => {
  if (busy.value || nextBefore.value == null) return;
  const current = generation; busy.value = true; error.value = '';
  try {
    const response = await request({ method: 'GET', url: `${base.value}/assessments?before=${nextBefore.value}`, alert: false });
    if (current !== generation) return;
    if (!validHistory(response.data) || (response.data.nextBefore != null && (!Number.isInteger(response.data.nextBefore) || response.data.nextBefore < 1 || response.data.nextBefore >= nextBefore.value))) throw new Error('Invalid history');
    records.value.push(...response.data.items); nextBefore.value = response.data.nextBefore;
  } catch { if (current === generation) error.value = 'Earlier assessments could not be loaded. Try again.'; } finally { if (current === generation) busy.value = false; }
};
</script>
<style scoped>
.capture-assessment { padding-top: 12px; } a { font-weight: 600; } .outdated { color: #805619; background: #fff7e6; padding: 12px; border-radius: 6px; }
.assessment-history { padding-left: 20px; } .assessment-history li { padding: 12px 0; } form { background: #f6f9fa; padding: 16px; border-radius: 8px; margin-top: 16px; }
fieldset { display: grid; gap: 12px; } label { display: block; } .attestation { display: flex; align-items: flex-start; gap: 8px; }
h4 { font-size: 16px; font-weight: 700; } p, label { overflow-wrap: anywhere; } .btn { max-width: 100%; white-space: normal; }
</style>
