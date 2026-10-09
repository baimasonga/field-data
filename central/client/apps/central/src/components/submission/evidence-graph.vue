<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="evidence-graph">
    <h3>Evidence graph and survey replay</h3>
    <button type="button" class="btn btn-default" :disabled="loading" @click="load">
      {{ loading ? 'Loading replay…' : graph ? 'Refresh evidence graph' : 'Load evidence graph' }}
    </button>
    <p v-if="error" role="alert">Evidence graph could not be loaded. Retry using the load button.</p>
    <template v-if="graph">
      <p>Physical presence: {{ graph.presence.status }}</p>
      <p>{{ graph.presence.limitations }}</p>
      <p v-if="!graph.complete" role="status">This projection is incomplete. Some records or lineage are outside its limits.</p>
      <p>Scope: this claim version. Inspected at {{ graph.generatedAt }}.</p>
      <ul><li v-for="limitation of graph.limitations" :key="limitation">{{ limitation }}</li></ul>
      <h4>Sources and assessments</h4>
      <ul>
        <li v-for="node of graph.nodes" :id="anchor(node.id)" :key="node.id">
          <strong>{{ node.type }}</strong> · {{ node.name || node.kind || node.sourceKind || node.sourceId }}
          <span v-if="node.integrityStatus"> · Integrity: {{ node.integrityStatus }}</span>
          <span v-if="node.outcome"> · {{ node.outcome }}</span>
          <span v-if="node.algorithm"> · {{ node.algorithm }} {{ node.algorithmVersion }}</span>
          <span v-if="node.note"> · {{ node.note }}</span>
          <span v-if="node.evidenceSnapshotHash"> · Historical snapshot: {{ node.evidenceSnapshotHash }}</span>
          <a v-if="node.sourceUrl" :href="node.sourceUrl" target="_blank" rel="noopener noreferrer">Inspect source</a>
        </li>
      </ul>
      <h4>Relationships</h4>
      <p v-if="graph.edges.length === 0">No recorded relationships.</p>
      <ul v-else>
        <li v-for="edge of graph.edges" :key="edge.id">
          <a :href="`#${anchor(edge.from)}`">{{ edge.from }}</a>
          · {{ edge.relation }} ·
          <a :href="`#${anchor(edge.to)}`">{{ edge.to }}</a>
        </li>
      </ul>
      <h4>Recorded timeline</h4>
      <ol>
        <li v-for="event of graph.timeline" :key="event.id">
          {{ event.at || 'Time unknown' }} · {{ event.timeBasis }} · {{ event.kind }} ·
          <a :href="`#${anchor(event.nodeId)}`">{{ event.nodeId }}</a>
        </li>
      </ol>
    </template>
  </section>
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from 'vue';
import useRequest from '../../composables/request';

defineOptions({ name: 'SubmissionEvidenceGraph' });
const props = defineProps({ claimVersionId: { type: String, required: true } });
const { request } = useRequest();
const graph = ref(null);
const loading = ref(false);
const error = ref(false);
let generation = 0;
let disposed = false;
const anchor = id => `graph-${props.claimVersionId}-${id.replace(/[^a-zA-Z0-9-]/g, '-')}`;
const load = async () => {
  generation += 1;
  const current = generation;
  graph.value = null;
  loading.value = true;
  error.value = false;
  try {
    const { data } = await request({
      method: 'GET',
      url: `/v1/field-data/claim-versions/${encodeURIComponent(props.claimVersionId)}/graph`, alert: false
    });
    if (!disposed && current === generation) graph.value = data;
  } catch {
    if (!disposed && current === generation) error.value = true;
  } finally {
    if (!disposed && current === generation) loading.value = false;
  }
};
watch(() => props.claimVersionId, () => {
  generation += 1;
  graph.value = null;
  error.value = false;
  loading.value = false;
});
onBeforeUnmount(() => { disposed = true; generation += 1; });
</script>

<style scoped>
.evidence-graph { overflow-wrap: anywhere; }
</style>
