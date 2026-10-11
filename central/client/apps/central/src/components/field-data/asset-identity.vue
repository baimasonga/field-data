<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.

Reversible asset merges and splits (K4), on an asset passport. Observations are
never changed: an operation says which asset they now belong to, and undoing it
restores the previous ownership. Contract: docs/field-intelligence/K4-asset-merge-split.md -->
<template>
  <div class="asset-identity">
    <p v-if="asset.status === 'merged'" class="asset-identity-merged" role="status">
      This asset was merged into
      <template v-if="asset.mergedIntoAsset != null">
        <button type="button" class="btn btn-link" @click="$emit('open', asset.mergedIntoAsset.id)">{{ asset.mergedIntoAsset.name }} · {{ asset.mergedIntoAsset.externalId }}</button>.
      </template>
      <template v-else>another asset.</template>
      Its observations are shown there; record new ones there.
    </p>
    <p v-if="error" role="alert" class="asset-identity-error">{{ error }}</p>

    <template v-if="allowed && asset.status === 'active'">
      <details class="asset-identity-merge">
        <summary>Merge another asset into this one</summary>
        <form @submit.prevent="merge">
          <p>Use when the same physical asset was registered twice. The other asset's observations will belong to this one, and the other asset will no longer be listed. This can be undone.</p>
          <label>Asset to merge into this one
            <select v-model="mergeForm.assetId" class="form-control" required>
              <option value="">Choose an asset</option>
              <option v-for="item of others" :key="item.id" :value="item.id">{{ item.name }} · {{ item.externalId }}</option>
            </select>
          </label>
          <label>Reason <textarea v-model="mergeForm.reason" class="form-control" required maxlength="2000"></textarea></label>
          <button type="submit" class="btn btn-primary" :aria-disabled="busy">Merge</button>
        </form>
      </details>
      <details v-if="history.length > 1" class="asset-identity-split">
        <summary>Split observations into a new asset</summary>
        <form @submit.prevent="split">
          <p>Use when this record covers more than one physical asset. The chosen observations will belong to a new asset; the rest stay here. This can be undone.</p>
          <fieldset>
            <legend>Observations to move</legend>
            <label v-for="record of history" :key="record.id" class="asset-identity-choice">
              <input v-model="splitForm.observationIds" type="checkbox" :value="record.id">
              {{ record.predicate }}: {{ record.state === 'known' ? record.value : record.state }} · valid from {{ record.validFrom.slice(0, 10) }}
            </label>
          </fieldset>
          <label>New asset name <input v-model="splitForm.name" class="form-control" required maxlength="200"></label>
          <label>New asset type <input v-model="splitForm.assetType" class="form-control" required maxlength="100"></label>
          <label>New external identifier <input v-model="splitForm.externalId" class="form-control" required maxlength="200"></label>
          <label>Reason <textarea v-model="splitForm.reason" class="form-control" required maxlength="2000"></textarea></label>
          <button type="submit" class="btn btn-primary" :aria-disabled="busy">Split</button>
        </form>
      </details>
    </template>

    <details v-if="operations != null && operations.length > 0" class="asset-identity-history" open>
      <summary>Identity history</summary>
      <ol>
        <li v-for="op of operations" :key="op.id">
          <strong>{{ describe(op) }}</strong>
          · {{ op.actorName ?? 'unknown' }} · {{ op.createdAt.slice(0, 16).replace('T', ' ') }}
          <span class="asset-identity-reason">{{ op.reason }}</span>
          <span v-if="op.undoneAt != null" class="asset-identity-undone">
            Undone by {{ op.undoneByName ?? 'unknown' }} on {{ op.undoneAt.slice(0, 10) }}: {{ op.undoReason }}
          </span>
          <form v-else-if="allowed && op.undoable" class="asset-identity-undo" @submit.prevent="undo(op)">
            <label>Reason to undo <input v-model="undoReasons[op.id]" class="form-control" required maxlength="2000"></label>
            <button type="submit" class="btn btn-default" :aria-disabled="busy">Undo</button>
          </form>
        </li>
      </ol>
    </details>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';

import useRequest from '../../composables/request';

defineOptions({ name: 'FieldDataAssetIdentity' });
const props = defineProps({
  projectId: { type: String, required: true },
  asset: { type: Object, required: true },
  history: { type: Array, required: true },
  items: { type: Array, required: true },
  allowed: { type: Boolean, default: false }
});
const emit = defineEmits(['changed', 'open']);
const { request, awaitingResponse: busy } = useRequest();
const root = () => `/v1/field-data/projects/${encodeURIComponent(props.projectId)}/assets`;
const operations = ref(null); const error = ref('');
const mergeForm = reactive({ assetId: '', reason: '' });
const splitForm = reactive({ observationIds: [], name: '', assetType: '', externalId: '', reason: '' });
const undoReasons = reactive({});
const others = computed(() => props.items.filter((item) => item.id !== props.asset.id));

// A retried request keeps its request ID, so it cannot apply twice.
const requestIds = new Map();
const requestIdFor = (data) => {
  const key = JSON.stringify(data);
  if (!requestIds.has(key)) requestIds.set(key, crypto.randomUUID());
  return requestIds.get(key);
};
const failed = (e) => {
  error.value = e?.response?.status === 412 ? 'This asset was changed by someone else. It has been reloaded; check it and try again.'
    : e?.response?.status === 409 ? e.response.data?.message ?? 'That change is not possible.'
      : 'The change could not be saved. Check the details and try again.';
  if (e?.response?.status === 412) emit('changed');
};
const load = () => request({ method: 'GET', url: `${root()}/${props.asset.id}/operations`, alert: false })
  .then(({ data }) => { operations.value = data; })
  .catch(() => { operations.value = null; });
watch(() => [props.asset.id, props.asset.revision], load, { immediate: true });

const change = (path, data, etag) => {
  error.value = '';
  return request({
    method: 'POST', url: `${root()}/${path}`, data: { ...data, requestId: requestIdFor({ path, data }) },
    headers: { 'If-Match': etag }, alert: false
  });
};
const merge = () => change(`${props.asset.id}/merge`, { mergedAssetId: mergeForm.assetId, reason: mergeForm.reason }, `"asset-${props.asset.revision}"`)
  .then(() => { mergeForm.assetId = ''; mergeForm.reason = ''; emit('changed'); })
  .catch(failed);
const split = () => {
  if (splitForm.observationIds.length === 0) { error.value = 'Choose at least one observation to move.'; return Promise.resolve(); }
  const data = { ...splitForm, observationIds: [...splitForm.observationIds] };
  return change(`${props.asset.id}/split`, data, `"asset-${props.asset.revision}"`)
    .then(() => { Object.assign(splitForm, { observationIds: [], name: '', assetType: '', externalId: '', reason: '' }); emit('changed'); })
    .catch(failed);
};
const undo = (op) => {
  error.value = '';
  return request({ method: 'POST', url: `${root()}/operations/${op.id}/undo`, data: { reason: undoReasons[op.id] }, alert: false })
    .then(() => { delete undoReasons[op.id]; emit('changed'); })
    .catch(failed);
};

const label = (a) => `${a.name} · ${a.externalId}`;
const describe = (op) => {
  const here = op.asset.id === props.asset.id;
  if (op.kind === 'merge') return here ? `Merged ${label(op.otherAsset)} into this asset (${op.observations} observations)`
    : `Merged into ${label(op.asset)} (${op.observations} observations)`;
  return here ? `Split ${op.observations} observations into ${label(op.otherAsset)}`
    : `Created by splitting ${op.observations} observations out of ${label(op.asset)}`;
};
</script>

<style lang="scss">
@import '../../assets/scss/variables';

.asset-identity {
  .asset-identity-error { color: $color-danger; }
  .asset-identity-reason, .asset-identity-undone { display: block; }
  .asset-identity-undone { color: $color-text-secondary; }
  .asset-identity-choice { display: block; font-weight: normal; margin: 4px 0; }
  .asset-identity-undo { align-items: flex-end; display: flex; flex-wrap: wrap; gap: 8px; }
  .btn-link { padding: 0; vertical-align: baseline; }
}
</style>
