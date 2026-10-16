<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="media-extractions panel panel-default" aria-label="Media extraction">
    <div class="panel-heading"><h2>Media extraction</h2></div>
    <div class="panel-body">
      <p>Extract visible text from photos or transcribe voice recordings, then review the proposed text alongside the original. Suggestions may be wrong or incomplete.</p>
      <button class="btn btn-default" type="button" :disabled="busy || loading" @click="load">Refresh extraction history</button>
      <p v-if="loading" role="status">Loading extraction history…</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <template v-if="state">
        <p v-if="!state.enabled" role="status">External extraction is not configured. An operator must enable the provider before media can be sent.</p>
        <form v-if="state.enabled && state.canRequest && state.media.length" @submit.prevent="extract">
          <fieldset :disabled="busy || pending != null">
            <label>Source media <select v-model="name" class="form-control" required><option disabled value="">Choose a photo or recording…</option><option v-for="file of state.media" :key="file.name" :value="file.name">{{ file.name }} · {{ file.kind === 'photo' ? 'Photo text' : 'Voice transcription' }}</option></select></label>
            <p>The selected file will be sent to OpenAI. Media may contain personal data. Provider processing may incur cost. Only PNG/JPEG photos and WAV/MP3 audio up to 5 MiB are supported.</p>
            <label class="attestation"><input v-model="consent" type="checkbox" required> I am authorized to send this media to OpenAI for extraction.</label>
          </fieldset>
          <button class="btn btn-primary" type="submit" :disabled="busy || !name || !consent">{{ pending ? 'Retry same extraction request' : 'Request extraction' }}</button>
        </form>
        <p v-if="!state.media.length">No supported current media is available.</p>
        <p v-if="state.mediaOmitted">Additional attachments were omitted from this list.</p>
        <p v-if="!state.items.length">No extraction has been requested.</p>
        <submission-media-extraction-review v-for="item in state.items" :key="item.id" :item="item" :base="base" :can-review="state.canReview" @updated="updated"/>
      </template>
    </div>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import SubmissionMediaExtractionReview from './media-extraction-review.vue';
import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';

defineOptions({ name: 'SubmissionMediaExtractions' });
const props = defineProps({ projectId: { type: String, required: true }, xmlFormId: { type: String, required: true }, instanceId: { type: String, required: true } });
const base = computed(() => `${apiPaths.submission(props.projectId, props.xmlFormId, props.instanceId)}/media-extractions`);
const { request } = useRequest(); const state = ref(null); const loading = ref(false); const busy = ref(false); const error = ref('');
const name = ref(''); const consent = ref(false); const pending = ref(null); let generation = 0;
const validItem = item => item && typeof item.id === 'string' && typeof item.bindingCurrent === 'boolean' && typeof item.name === 'string' &&
  ['processing', 'ready', 'failed', 'interrupted'].includes(item.status) && ['photo', 'audio'].includes(item.kind) && /^[0-9a-f]{64}$/.test(item.contentHash) &&
  Number.isInteger(item.revision) && item.revision >= 0 && item.revision <= 20 && Array.isArray(item.reviews) && item.reviews.length === item.revision &&
  (item.status !== 'ready' || (typeof item.proposal === 'string' && item.proposal.length <= 12000)) &&
  item.reviews.every((r, i) => r && r.sequence === i + 1 && ['approve', 'reject'].includes(r.action) && typeof r.reason === 'string' &&
    (r.action === 'approve' ? typeof r.text === 'string' && r.text.length <= 12000 : r.text === null));
const updated = item => {
  if (!validItem(item)) { error.value = 'Extraction history could not be verified. Refresh to try again.'; return; }
  const index = state.value.items.findIndex(row => row.id === item.id);
  if (index >= 0) state.value.items.splice(index, 1, item);
};
const load = async () => {
  generation += 1; const current = generation; state.value = null; pending.value = null; name.value = ''; consent.value = false; error.value = ''; busy.value = false; loading.value = true;
  try {
    const { data } = await request({ method: 'GET', url: base.value, alert: false });
    if (!data || typeof data.enabled !== 'boolean' || typeof data.canRequest !== 'boolean' || typeof data.canReview !== 'boolean' || !Array.isArray(data.media) || data.media.length > 100 ||
      data.media.some(file => !file || typeof file.name !== 'string' || !['photo', 'audio'].includes(file.kind)) || !Array.isArray(data.items) || data.items.length > 20 || !data.items.every(validItem)) throw new Error('Invalid extraction history');
    if (current === generation) state.value = data;
  } catch { if (current === generation) error.value = 'Extraction history could not be loaded. Refresh to check your access.'; } finally { if (current === generation) loading.value = false; }
};
const extract = async () => {
  if (busy.value || !consent.value || !name.value) return;
  const current = generation; busy.value = true; error.value = '';
  pending.value ??= { requestId: crypto.randomUUID(), name: name.value, allowExternalProcessing: true };
  try {
    const response = await request({ method: 'POST', url: base.value, data: pending.value, alert: false, timeout: 70000 });
    if (!validItem(response.data.item)) throw new Error('Invalid extraction result');
    if (current === generation) await load();
  } catch (failure) {
    if (current === generation) error.value = [400, 409, 501].includes(failure.response?.status) ? 'Extraction is unavailable or the source changed. Refresh before trying again.'
      : 'Request could not be confirmed. Retry the same request or refresh history; media will not be resent for the same request.';
  } finally { if (current === generation) busy.value = false; }
};
watch(() => [props.projectId, props.xmlFormId, props.instanceId], load, { immediate: true });
onBeforeUnmount(() => { generation += 1; pending.value = null; });
</script>
<style scoped>
h2 { font-size: 20px; margin: 0; } .panel-body { padding: 20px; } label { display: block; margin: 12px 0; } .attestation { font-weight: normal; }
button { white-space: normal; } p { overflow-wrap: anywhere; } .media-extractions { margin-top: 24px; }
</style>
