<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.

Asset status across a project (K3): one fact for every asset, chosen as its
passport chooses it, with a count by value of knowledge still current.
Contract: docs/field-intelligence/K3-asset-status-projection.md -->
<template>
  <section class="asset-status" aria-labelledby="asset-status-title">
    <h2 id="asset-status-title">Asset status across the project</h2>
    <p class="section-lead">
      One recorded fact for every asset, chosen as its passport chooses it. Only facts that are still fresh or due for
      review count towards each value; expired, unknown and unverified facts are counted separately, so stale knowledge
      is never counted as current.
    </p>
    <p v-if="predicates != null && predicates.length === 0" class="asset-status-empty">No asset in this project has a recorded fact yet.</p>
    <form v-else-if="predicates != null" class="asset-status-form" @submit.prevent="load">
      <label>Fact
        <select v-model="predicate" class="form-control" required>
          <option v-for="p of predicates" :key="p" :value="p">{{ p }}</option>
        </select>
      </label>
      <label>Asset type (optional)
        <input v-model="assetType" type="text" maxlength="100" class="form-control">
      </label>
      <label>As of (optional)
        <input v-model="asOf" type="date" class="form-control">
      </label>
      <button type="submit" class="btn btn-primary" :aria-disabled="busy">Show <spinner :state="busy"/></button>
    </form>
    <p v-if="error" role="alert" class="asset-status-error">{{ error }}</p>

    <template v-if="result != null && result.predicate != null">
      <p class="asset-status-summary">
        <template v-if="result.summary.byValue.length > 0">
          Current: {{ result.summary.byValue.map((v) => `${v.count} ${v.value}`).join(', ') }}.
        </template>
        <template v-else>No asset has a current “{{ result.predicate }}”.</template>
        {{ statusLine }}
      </p>
      <p v-if="excludedLine" class="asset-status-excluded">{{ excludedLine }}</p>
      <p v-if="result.assets.length === 0" class="asset-status-empty">No asset matches.</p>
      <table v-else class="table asset-status-table">
        <thead><tr><th>Asset</th><th>{{ result.predicate }}</th><th>Status</th><th>Valid from</th><th><span class="sr-only">Open</span></th></tr></thead>
        <tbody>
          <tr v-for="a of result.assets" :key="a.id">
            <td>{{ a.name }} <span class="asset-status-id">{{ a.externalId }} · {{ a.assetType }}</span></td>
            <td>{{ a.fact == null ? '—' : a.fact.state === 'known' ? a.fact.value : a.fact.state }}</td>
            <td>{{ STATUS[a.fact?.freshness.status ?? 'none'] }}</td>
            <td>{{ a.fact == null ? '' : a.fact.validFrom.slice(0, 10) }}</td>
            <td><button type="button" class="btn btn-link" @click="$emit('open', { assetId: a.id, xmlFormId: a.xmlFormId })">Open asset</button></td>
          </tr>
        </tbody>
      </table>
      <p v-if="result.truncated" class="asset-status-more">Only the first {{ result.assets.length }} assets by name are shown.</p>
    </template>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue';

import Spinner from '../spinner.vue';
import useRequest from '../../composables/request';

defineOptions({ name: 'FieldDataAssetStatus' });
const props = defineProps({ projectId: { type: [String, Number], required: true } });
defineEmits(['open']);
const { request, awaitingResponse: busy } = useRequest();

const STATUS = {
  fresh: 'Fresh', 'review-due': 'Review due', expired: 'Expired', unknown: 'Unknown',
  'source-unverified': 'Source unverified', 'not-yet-valid': 'Not yet valid', none: 'No fact'
};
const predicates = ref(null); const predicate = ref(''); const assetType = ref(''); const asOf = ref('');
const result = ref(null); const error = ref('');
const url = (params) => `/v1/field-data/projects/${props.projectId}/assets/projection${params.toString() === '' ? '' : `?${params}`}`;

const get = (params) => request({ method: 'GET', url: url(params), alert: false })
  .then(({ data }) => {
    if (!Array.isArray(data?.predicates) || !Array.isArray(data.assets)) throw new Error('Unexpected response');
    predicates.value = data.predicates;
    if (predicate.value === '' && data.predicates.length > 0) [predicate.value] = data.predicates;
    return data;
  });

const load = () => {
  error.value = '';
  const params = new URLSearchParams({ predicate: predicate.value });
  if (assetType.value.trim() !== '') params.set('assetType', assetType.value.trim());
  // The end of the chosen day.
  if (asOf.value !== '') params.set('at', `${asOf.value}T23:59:59Z`);
  return get(params).then((data) => { result.value = data; })
    .catch(() => { result.value = null; error.value = 'Asset status could not be loaded. Try again.'; });
};
get(new URLSearchParams())
  .then(() => (predicate.value === '' ? null : load()))
  .catch(() => { error.value = 'Asset status could not be loaded. Try again.'; });

const statusLine = computed(() => {
  const s = result.value.summary.byStatus;
  const parts = [['review-due', 'due for review'], ['expired', 'expired'], ['unknown', 'unknown'],
    ['source-unverified', 'with an unverified source'], ['none', 'with no fact']]
    .filter(([key]) => s[key] > 0).map(([key, label]) => `${s[key]} ${label}`);
  return parts.length === 0 ? '' : `Also: ${parts.join(', ')}.`;
});
const excludedLine = computed(() => {
  const { notReadable, sourceDeleted } = result.value.excluded;
  const parts = [];
  if (sourceDeleted > 0) parts.push(`${sourceDeleted} resting on a deleted Submission`);
  if (notReadable > 0) parts.push(`${notReadable} resting on a Form you may not read`);
  return parts.length === 0 ? '' : `Not shown: ${parts.join(', ')}.`;
});
</script>

<style lang="scss">
@import '../../assets/scss/variables';

.asset-status {
  margin: 24px 0;
  overflow-wrap: anywhere;
  .asset-status-form { align-items: flex-end; display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px;
    label { display: flex; flex-direction: column; font-weight: normal; max-width: 240px; } }
  .asset-status-empty, .asset-status-id, .asset-status-excluded, .asset-status-more { color: $color-text-secondary; }
  .asset-status-error { color: $color-danger; }
  table { display: block; max-width: 100%; overflow-x: auto; }
  .btn-link { padding: 0; }
}
</style>
