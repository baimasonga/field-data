<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="capture-history panel panel-default" aria-labelledby="capture-history-title">
    <div class="panel-heading"><h2 id="capture-history-title" class="panel-title">Capture challenges</h2></div>
    <div class="panel-body">
      <p>Challenge binding links a server-issued code to stored image bytes. Review the original photo for the paper code and scene; location, device and capture time have not been assessed.</p>
      <button v-if="!error" type="button" class="btn btn-default" :disabled="loading" @click="load">Refresh capture challenges</button>
      <p v-if="notice" role="status">{{ notice }}</p>
      <p v-if="loading" role="status">Loading capture challenges…</p>
      <template v-else-if="error"><p role="alert">Capture challenges could not be loaded.</p><button type="button" class="btn btn-default" @click="load">Retry capture challenges</button></template>
      <p v-else-if="!items.length">No capture challenges are recorded for this submission.</p>
      <ul v-else>
        <li v-for="item of items" :key="item.id">
          <h3>{{ item.name }} · Code {{ item.code }}</h3>
          <p>{{ item.status === 'bound' ? item.sceneReview === 'assessed' ? 'Challenge linked; human assessment recorded' : item.sceneReview === 'outdated' ? 'Challenge linked; assessment outdated' : 'Challenge linked; scene review required' : item.status === 'cancelled' ? 'Cancelled' : 'Awaiting upload or expired' }}</p>
          <p>Issued <record-date-time :iso="item.issuedAt"/> · Expires <record-date-time :iso="item.expiresAt"/></p>
          <p v-if="item.boundAt">Linked <record-date-time :iso="item.boundAt"/> · {{ item.bindingCurrent ? 'References the current attachment' : 'Current attachment changed or is unavailable' }}</p>
          <submission-capture-assessment :item="item" :project-id="projectId" :xml-form-id="xmlFormId" :instance-id="instanceId" @saved="reload('Photo assessment saved.')" @refresh="reload('The attachment or assessment changed. Review the refreshed history before saving again.')"/>
          <details v-if="item.contentHash"><summary>Bound image fingerprint</summary><code>{{ item.contentHash }}</code></details>
        </li>
      </ul>
    </div>
  </section>
</template>
<script setup>
import { onBeforeUnmount, ref, watch } from 'vue';
import RecordDateTime from '../record-date-time.vue';
import SubmissionCaptureAssessment from './capture-assessment.vue';
import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { validHistory } from '../../util/capture-assessment';

defineOptions({ name: 'SubmissionCaptureChallenges' });
const props = defineProps({ projectId: { type: String, required: true }, xmlFormId: { type: String, required: true }, instanceId: { type: String, required: true } });
const { request } = useRequest(); const items = ref([]); const loading = ref(false); const error = ref(false); const notice = ref('');
let generation = 0;
onBeforeUnmount(() => { generation += 1; });
const load = async () => {
  generation += 1; const current = generation; items.value = []; loading.value = true; error.value = false;
  try {
    const response = await request({ method: 'GET', url: `${apiPaths.submission(props.projectId, props.xmlFormId, props.instanceId)}/capture-challenges`, alert: false });
    if (!Array.isArray(response.data.items) || response.data.items.length > 20 || response.data.items.some(item => !item || !['issued', 'bound', 'cancelled'].includes(item.status) ||
      !/^[0-9A-F]{8}$/.test(item.code ?? '') || typeof item.name !== 'string' || !Number.isFinite(Date.parse(item.issuedAt)) || !Number.isFinite(Date.parse(item.expiresAt)) ||
      typeof item.bindingCurrent !== 'boolean' || !['not-assessed', 'assessed', 'outdated'].includes(item.sceneReview) || (item.contentHash != null && !/^[0-9a-f]{64}$/.test(item.contentHash)) || (item.revision != null && (!Number.isInteger(item.revision) || item.revision < 0)) ||
      (item.canAssess != null && typeof item.canAssess !== 'boolean') || (item.assessments != null && !validHistory(item.assessments)))) throw new Error('Invalid capture history');
    if (current === generation) items.value = response.data.items;
  } catch { if (current === generation) error.value = true; } finally { if (current === generation) loading.value = false; }
};
const reload = async text => { const current = generation + 1; await load(); if (current === generation) notice.value = text; };
watch(() => [props.projectId, props.xmlFormId, props.instanceId], () => { notice.value = ''; load(); }, { immediate: true });
</script>
<style scoped>
.capture-history { margin-top: 20px; } .panel-body { padding: 20px; font-size: 14px; }
ul { list-style: none; padding: 0; } li { padding: 16px 0; border-top: 1px solid #e8eef0; } h3 { font-size: 16px; font-weight: 700; }
p, h3, code { overflow-wrap: anywhere; } code { white-space: normal; } summary { cursor: pointer; padding: 8px 0; }
</style>
