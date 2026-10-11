<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.

Suggested duplicate assets (K5): pairs that may be the same physical thing,
with their reasons. Nothing is merged here; a person opens the assets and
decides. Contract: docs/field-intelligence/K5-duplicate-assets.md -->
<template>
  <section class="duplicate-assets" aria-labelledby="duplicate-assets-title">
    <h2 id="duplicate-assets-title">Possible duplicate assets</h2>
    <p class="section-lead">
      Pairs of assets that may be the same physical thing, with the reasons. Nothing is merged automatically: open the
      assets to compare them and merge one into the other from its passport, or mark the pair as not the same.
    </p>
    <button type="button" class="btn btn-default" :aria-disabled="busy" @click="load">Refresh</button>
    <p v-if="error" role="alert" class="duplicate-assets-error">{{ error }}</p>
    <template v-if="result != null">
      <p v-if="result.pairs.length === 0" class="duplicate-assets-empty">No possible duplicates among the assets you can see.</p>
      <ul v-else class="duplicate-assets-list">
        <li v-for="pair of result.pairs" :key="`${pair.a.id}|${pair.b.id}`" class="duplicate-pair">
          <p class="duplicate-pair-assets">
            <button type="button" class="btn btn-link" @click="open(pair.a)">{{ pair.a.name }} · {{ pair.a.externalId }}</button>
            and
            <button type="button" class="btn btn-link" @click="open(pair.b)">{{ pair.b.name }} · {{ pair.b.externalId }}</button>
          </p>
          <ul class="duplicate-pair-reasons">
            <li v-for="reason of pair.reasons" :key="reason">{{ REASONS[reason] }}</li>
          </ul>
          <form v-if="canManage" class="duplicate-pair-dismiss" @submit.prevent="dismiss(pair)">
            <label>Why they are not the same
              <input v-model="reasons[keyOf(pair)]" type="text" class="form-control" maxlength="2000" required>
            </label>
            <button type="submit" class="btn btn-default" :aria-disabled="busy">Not the same</button>
          </form>
        </li>
      </ul>
      <p v-if="result.total > result.pairs.length" class="duplicate-assets-more">
        Showing {{ result.pairs.length }} of {{ result.total }} pairs.
      </p>
      <p v-if="result.truncated" class="duplicate-assets-more">Only the first 2000 assets by name were compared.</p>
      <details v-if="result.dismissed.length > 0" class="duplicate-assets-dismissed">
        <summary>Marked as not the same ({{ result.dismissed.length }})</summary>
        <ul>
          <li v-for="d of result.dismissed" :key="d.id">
            {{ d.a.name }} · {{ d.a.externalId }} and {{ d.b.name }} · {{ d.b.externalId }}: {{ d.reason }}
            ({{ d.actorName ?? 'unknown' }})
            <button v-if="canManage" type="button" class="btn btn-link" :aria-disabled="busy" @click="withdraw(d)">Suggest again</button>
          </li>
        </ul>
      </details>
    </template>
  </section>
</template>

<script setup>
import { reactive, ref } from 'vue';

import useRequest from '../../composables/request';

defineOptions({ name: 'FieldDataDuplicateAssets' });
const props = defineProps({
  projectId: { type: [String, Number], required: true },
  canManage: { type: Boolean, default: false }
});
const emit = defineEmits(['open']);
const { request, awaitingResponse: busy } = useRequest();

const REASONS = {
  'external-id': 'External IDs match apart from case, spaces or punctuation',
  'same-source': 'Facts recorded from the same submission',
  'same-name': 'Same name and type',
  'similar-name': 'Similar names, same type and the same numbers'
};
const result = ref(null); const error = ref(''); const reasons = reactive({});
const base = () => `/v1/field-data/projects/${encodeURIComponent(props.projectId)}/assets/duplicates`;
const keyOf = (pair) => `${pair.a.id}|${pair.b.id}`;

const load = () => {
  error.value = '';
  return request({ method: 'GET', url: base(), alert: false })
    .then(({ data }) => {
      if (!Array.isArray(data?.pairs) || !Array.isArray(data.dismissed)) throw new Error('Unexpected response');
      result.value = data;
    })
    .catch(() => { result.value = null; error.value = 'Possible duplicates could not be loaded. Try again.'; });
};
load();

const open = (asset) => emit('open', { assetId: asset.id, xmlFormId: asset.xmlFormId });
const dismiss = (pair) => {
  error.value = '';
  return request({ method: 'POST', url: `${base()}/dismissals`, data: { assetIds: [pair.a.id, pair.b.id], reason: reasons[keyOf(pair)] }, alert: false })
    .then(() => { delete reasons[keyOf(pair)]; return load(); })
    .catch(() => { error.value = 'The pair could not be marked. Reload and try again.'; });
};
const withdraw = (dismissal) => {
  error.value = '';
  return request({ method: 'POST', url: `${base()}/dismissals/${dismissal.id}/withdraw`, alert: false })
    .then(load)
    .catch(() => { error.value = 'The pair could not be suggested again. Reload and try again.'; });
};
</script>

<style lang="scss">
@import '../../assets/scss/variables';

.duplicate-assets {
  margin: 24px 0;
  overflow-wrap: anywhere;
  .duplicate-assets-error { color: $color-danger; }
  .duplicate-assets-empty, .duplicate-assets-more { color: $color-text-secondary; }
  .duplicate-assets-list { padding-left: 18px; }
  .duplicate-pair { margin-bottom: 12px; }
  .duplicate-pair-reasons { margin: 4px 0; padding-left: 18px; }
  .duplicate-pair-dismiss { align-items: flex-end; display: flex; flex-wrap: wrap; gap: 8px;
    label { display: flex; flex: 1 1 220px; flex-direction: column; font-weight: normal; max-width: 420px; } }
  .btn-link { padding: 0; vertical-align: baseline; }
}
</style>
