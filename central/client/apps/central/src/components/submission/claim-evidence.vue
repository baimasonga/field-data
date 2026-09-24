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
        <p v-if="current.provenance?.receivedAt != null">
          Received: {{ current.provenance.receivedAt }}
        </p>
        <p v-if="current.provenance?.integrityHash != null">
          Integrity hash: <code>{{ current.provenance.integrityHash }}</code>
        </p>
        <h3>Original evidence</h3>
        <p v-if="items.length === 0">No evidence records are linked to this version.</p>
        <ul v-else class="list-unstyled">
          <li v-for="item of items" :key="item.id">
            <strong>{{ item.name || item.sourceKind }}</strong>
            — {{ item.integrityStatus }}
            <a v-if="item.integrityStatus === 'verified'" :href="item.downloadUrl"
              target="_blank" rel="noopener noreferrer">Download original</a>
            <span v-else> · Original unavailable or unverified</span>
          </li>
        </ul>
        <p class="text-muted">Integrity status describes stored bytes; it does not verify the field claim.</p>
      </template>
    </div>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import useRequest from '../../composables/request';

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
  const base = `/v1/projects/${encodeURIComponent(props.projectId)}/forms/` +
    `${encodeURIComponent(props.xmlFormId)}/submissions/${encodeURIComponent(props.instanceId)}`;
  try {
    const result = await request({ method: 'GET', url: `${base}/claim`, alert: false });
    claim.value = result.data;
    if (result.data.currentVersionId != null) {
      const evidence = await request({
        method: 'GET',
        url: `/v1/field-data/claim-versions/${result.data.currentVersionId}/evidence`,
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
