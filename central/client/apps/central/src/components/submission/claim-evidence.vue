<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="claim-evidence panel panel-default" aria-labelledby="claim-evidence-title">
    <div class="panel-heading"><h2 id="claim-evidence-title" class="panel-title">Claim and evidence</h2></div>
    <div class="panel-body">
      <p v-if="loading">Loading claim evidence…</p>
      <p v-else-if="error" role="alert">Claim evidence could not be loaded. Please try again.</p>
      <template v-else-if="current != null">
        <p>
          Version {{ current.ordinal }} · {{ current.current ? 'Current' : 'Superseded' }}
          · Source: {{ current.provenance?.origin ?? 'unknown' }}
        </p>
        <p v-if="current.provenance?.degraded != null || current.degraded != null"
          class="text-warning">
          Some provenance details were inferred or are unavailable.
        </p>
        <h3>Original evidence</h3>
        <p v-if="items.length === 0">No evidence records are linked to this version.</p>
        <ul v-else class="list-unstyled">
          <li v-for="item of items" :key="item.id">
            <strong>{{ item.sourceKind === 'submission-xml' && (!item.name || item.name === 'submission-xml') ? 'Original submission XML' : item.name || item.sourceKind }}</strong>
            <span class="evidence-integrity">Stored bytes: {{ item.integrityStatus }}</span>
            <a v-if="item.integrityStatus === 'verified'" :href="item.downloadUrl"
              target="_blank" rel="noopener noreferrer">Download original</a>
            <span v-else> · Original unavailable or unverified</span>
          </li>
        </ul>
        <details class="evidence-technical">
<summary>Integrity details</summary>        <p v-if="current.provenance?.receivedAt != null">
          Received: <record-date-time :iso="current.provenance.receivedAt"/>
        </p>
        <p v-if="current.provenance?.integrityHash != null">
          Integrity hash: <code>{{ current.provenance.integrityHash }}</code>
        </p>
</details>
        <p class="text-muted">Integrity status describes stored bytes; it does not verify the field claim.</p>
      </template>
    </div>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import RecordDateTime from '../record-date-time.vue';
import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';

defineOptions({ name: 'SubmissionClaimEvidence' });
const props = defineProps({
  projectId: { type: String, required: true },
  xmlFormId: { type: String, required: true },
  instanceId: { type: String, required: true }
});
const { request } = useRequest();
const claim = ref(null);
const items = ref([]);
const loading = ref(true);
const error = ref(false);
const current = computed(() => claim.value?.versions?.find(
  (version) => version.id === claim.value.currentVersionId
) ?? null);

watch(() => [props.projectId, props.xmlFormId, props.instanceId], async () => {
  claim.value = null;
  items.value = [];
  loading.value = true;
  error.value = false;
  try {
    const result = await request({
      method: 'GET',
      url: apiPaths.submissionClaim(props.projectId, props.xmlFormId, props.instanceId),
      alert: false
    });
    claim.value = result.data;
    if (result.data.currentVersionId != null) {
      const evidence = await request({
        method: 'GET',
        url: apiPaths.claimEvidence(result.data.currentVersionId),
        alert: false
      });
      items.value = evidence.data.items;
    }
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
}, { immediate: true });
</script>

<style lang="scss">
.claim-evidence {
  margin-top: 0;
  .panel-body { padding: 20px; font-size: 14px; }
  h3 { font-size: 16px; font-weight: 700; }
  .text-warning { background: #fff7e6; border: 1px solid #f1dfb9; border-radius: 6px; padding: 10px 12px; color: #805619; }
  li { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 12px 0; border-bottom: 1px solid #e8eef0; }
  li a { margin-left: auto; font-weight: 600; }
  .evidence-integrity { font-size: 12px; color: #5a6b71; }
  summary { padding: 14px 0; cursor: pointer; font-weight: 600; }
  code { overflow-wrap: anywhere; white-space: normal; }
  .text-muted { margin-top: 10px; font-size: 12px; }
}
</style>
