<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <article class="media-extraction-record">
    <h3>{{ item.name }} · {{ item.kind === 'photo' ? 'Photo text' : 'Voice transcript' }}</h3>
    <p>{{ item.provider }} · {{ item.model }} · Requested by {{ item.actorName }} <record-date-time :iso="item.requestedAt"/></p>
    <p v-if="!item.bindingCurrent" class="outdated" role="status">Outdated source: the attachment or submission version changed. Earlier approvals are historical.</p>
    <p v-if="item.status === 'processing'" role="status">Extraction in progress. Refresh to check the result; retrying the same request will not resend the media.</p>
    <p v-else-if="item.status === 'interrupted'" role="status">Extraction interrupted; its outcome is unknown. It will not be sent again automatically. A new attempt may incur provider cost.</p>
    <p v-else-if="item.status === 'failed'" role="status">Extraction failed ({{ item.failure }}). No text was approved. You may explicitly request another attempt.</p>
    <p>
<button type="button" class="btn btn-default" :disabled="busy" @click="downloadSource">Download original media</button>
      <button type="button" class="btn btn-link" @click="downloadHistory">Download extraction history</button>
</p>
    <figure v-if="previewUrl">
      <img v-if="item.kind === 'photo'" :src="previewUrl" alt="Original source photo for this extraction">
      <!-- Audio-only media has its proposed and corrected text alternatives below. -->
      <!-- eslint-disable-next-line vuejs-accessibility/media-has-caption -->
      <audio v-else :src="previewUrl" controls preload="metadata" aria-label="Original voice recording; proposed and reviewed transcripts follow">Use the downloaded original to listen to this recording.</audio>
      <figcaption>Original media bound to this extraction.</figcaption>
    </figure>
    <details><summary>Source fingerprint</summary><code>{{ item.contentHash }}</code></details>
    <template v-if="item.status === 'ready'">
      <h4>Original model proposal · unverified</h4><pre>{{ item.proposal }}</pre>
      <p role="status">{{ decisionLabel }}</p>
      <template v-if="latest?.action === 'approve'"><h4>{{ item.bindingCurrent ? 'Reviewed text' : 'Historical reviewed text' }}</h4><pre>{{ latest.text }}</pre></template>
      <details v-if="item.reviews.length">
<summary>Review history ({{ item.reviews.length }})</summary>
        <ol>
<li v-for="review in item.reviews" :key="review.id">
<strong>{{ review.action === 'approve' ? 'Approved' : 'Rejected' }}</strong> by {{ review.actorName }} · <record-date-time :iso="review.reviewedAt"/>
          <pre v-if="review.text">{{ review.text }}</pre><p>{{ review.reason }}</p>
</li>
</ol>
      </details>
      <form v-if="canReview && item.revision < 20" @submit.prevent="save">
        <h4>{{ item.revision ? 'Revise the review' : 'Review this extraction' }}</h4>
        <fieldset :disabled="busy || pending != null">
          <label>Decision <select v-model="action" class="form-control" required><option value="approve" :disabled="!item.bindingCurrent">Approve reviewed text</option><option value="reject">Reject extraction</option></select></label>
          <label v-if="action === 'approve'">Reviewed text <textarea v-model="text" class="form-control" rows="5" required maxlength="12000"></textarea></label>
          <label>Review reason <textarea v-model="reason" class="form-control" required minlength="10" maxlength="2000" rows="2"></textarea></label>
          <label class="attestation"><input v-model="confirmed" type="checkbox" required :disabled="!downloaded"> I reviewed the original media and checked this decision. Download the original first.</label>
        </fieldset>
        <p>Only the reviewed text is approved. Collected answers and submission review status stay unchanged.</p>
        <button class="btn btn-primary" type="submit" :disabled="busy || !confirmed || !downloaded">{{ pending ? 'Retry same review' : 'Save review decision' }}</button>
      </form>
    </template>
    <p v-if="error" role="alert">{{ error }}</p>
  </article>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import RecordDateTime from '../date-time.vue';
import useRequest from '../../composables/request';

defineOptions({ name: 'SubmissionMediaExtractionReview' });
const props = defineProps({ item: { type: Object, required: true }, base: { type: String, required: true }, canReview: Boolean });
const emit = defineEmits(['updated']); const { request } = useRequest();
const action = ref('approve'); const text = ref(''); const reason = ref(''); const confirmed = ref(false); const downloaded = ref(false);
const previewUrl = ref(null);
const clearPreview = () => { if (previewUrl.value) URL.revokeObjectURL(previewUrl.value); previewUrl.value = null; };
const busy = ref(false); const error = ref(''); const pending = ref(null); let generation = 0;
const latest = computed(() => props.item.reviews.at(-1));
const decisionLabel = computed(() => (!props.item.bindingCurrent ? 'No current approval: source changed.'
  : latest.value?.action === 'approve' ? 'Approved by a reviewer; model accuracy and scene truth are not certified.'
    : latest.value?.action === 'reject' ? 'Rejected by a reviewer.' : 'Awaiting human review.'));
const download = (bytes, name) => {
  const url = URL.createObjectURL(bytes); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const downloadHistory = () => download(new Blob([JSON.stringify({ format: 'field-data.media-extraction@1', ...props.item }, null, 2)], { type: 'application/json' }), `extraction-${props.item.id}.json`);
const downloadSource = async () => {
  if (busy.value) return; const current = generation; busy.value = true; error.value = '';
  try {
    const response = await request({ method: 'GET', url: `${props.base}/${props.item.id}/source`, responseType: 'blob', alert: false });
    if (current !== generation) return;
    clearPreview(); previewUrl.value = URL.createObjectURL(response.data);
    download(response.data, props.item.name); downloaded.value = true;
  } catch { if (current === generation) error.value = 'Original media could not be downloaded. Refresh to check your access.'; } finally { if (current === generation) busy.value = false; }
};
const save = async () => {
  if (busy.value || !confirmed.value || !downloaded.value) return;
  const current = generation; busy.value = true; error.value = '';
  pending.value ??= {
    requestId: crypto.randomUUID(), revision: props.item.revision, action: action.value,
    text: action.value === 'approve' ? text.value.trim() : null, reason: reason.value.trim(), reviewedOriginal: true
  };
  try {
    const response = await request({ method: 'POST', url: `${props.base}/${props.item.id}/reviews`, data: pending.value, alert: false });
    if (current === generation) { pending.value = null; emit('updated', response.data.item); }
  } catch (failure) {
    if (current === generation) error.value = failure.response?.status === 409 ? 'Source or review changed. Refresh extraction history before reviewing again.' : 'Review could not be confirmed. Retry the same decision or refresh the history.';
  } finally { if (current === generation) busy.value = false; }
};
watch(() => [props.base, props.item.id, props.item.revision, props.item.bindingCurrent], () => {
  generation += 1; clearPreview(); pending.value = null; busy.value = false; confirmed.value = false; downloaded.value = false; error.value = ''; reason.value = '';
  action.value = props.item.bindingCurrent ? 'approve' : 'reject'; text.value = latest.value?.text ?? props.item.proposal ?? '';
}, { immediate: true });
onBeforeUnmount(() => { generation += 1; clearPreview(); pending.value = null; });
</script>
<style scoped>
.media-extraction-record { border-top: 1px solid #dae3e7; padding: 18px 0; } h3 { font-size: 17px; } h4 { font-size: 15px; }
img { max-width: 100%; max-height: 480px; object-fit: contain; } audio { width: 100%; } figure { margin: 12px 0; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 320px; overflow: auto; background: #f6f8f9; }
p, code, h3 { overflow-wrap: anywhere; } label { display: block; margin: 12px 0; } .attestation { font-weight: normal; } summary { cursor: pointer; padding: 8px 0; }
button { white-space: normal; margin: 3px; } .outdated { color: #805300; }
</style>
