<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.

Cited search (K2): one search across a project's assets, asset facts,
integrity findings and review decisions, each result citing the submission it
rests on. Contract: docs/field-intelligence/K2-cited-search.md -->
<template>
  <section class="project-search" aria-labelledby="project-search-title">
    <h2 id="project-search-title">Search the project's records</h2>
    <p class="section-lead">
      Find an asset, a recorded fact, a finding or a review decision by the words in it.
      Each result links to the submission it rests on, so it can be checked there. Submission answers are not searched.
    </p>
    <form class="project-search-form" role="search" @submit.prevent="search">
      <label>Search for
        <input v-model="query" type="search" class="form-control" minlength="2" maxlength="100"
          placeholder="For example a place, an asset or a reason" required>
      </label>
      <button type="submit" class="btn btn-primary" :aria-disabled="busy">Search <spinner :state="busy"/></button>
    </form>
    <p v-if="error" role="alert" class="project-search-error">{{ error }}</p>

    <template v-if="result != null">
      <p v-if="total === 0" class="project-search-empty">Nothing in this project's records matches “{{ result.q }}”.</p>
      <template v-else>
        <section v-for="kind of KINDS" v-show="result.results[kind.key].length > 0" :key="kind.key"
          class="project-search-kind" :class="`project-search-${kind.key}`">
          <h3>{{ kind.title }} ({{ result.results[kind.key].length + result.more[kind.key] }})</h3>
          <ul>
            <li v-for="item of result.results[kind.key]" :key="item.id">
              <template v-if="kind.key === 'assets'">
                <strong>{{ item.name }}</strong> · {{ item.assetType }} · {{ item.externalId }}
                <button type="button" class="btn btn-link" @click="$emit('open', { assetId: item.id, xmlFormId: item.source.xmlFormId })">Open asset</button>
              </template>
              <template v-else-if="kind.key === 'facts'">
                <strong>{{ item.assetName }}</strong>: {{ item.predicate }} {{ item.state === 'known' ? item.value : `(${item.state})` }}
                · recorded from <router-link :to="submissionPath(item.source.xmlFormId, item.source.instanceId)">{{ item.source.instanceId }}</router-link>
                <button type="button" class="btn btn-link" @click="$emit('open', { assetId: item.assetId, xmlFormId: item.assetXmlFormId })">Open asset</button>
              </template>
              <template v-else-if="kind.key === 'findings'">
                <strong>{{ item.title ?? item.rule }}</strong> · {{ item.outcome }}<template v-if="item.status !== 'open'">, {{ item.status }}</template>
                · <router-link :to="submissionPath(item.source.xmlFormId, item.source.instanceId)">{{ item.source.instanceId }}</router-link>
                <template v-if="item.source.relatedInstanceId != null">
                  and <router-link :to="submissionPath(item.source.xmlFormId, item.source.relatedInstanceId)">{{ item.source.relatedInstanceId }}</router-link>
                </template>
                · <router-link :to="`${formPath(item.source.xmlFormId)}/verification`">Verification</router-link>
              </template>
              <template v-else>
                <strong>{{ item.outcome }}</strong> · {{ item.reasonCode }}
                · <router-link :to="submissionPath(item.source.xmlFormId, item.source.instanceId)">{{ item.source.instanceId }}</router-link>
              </template>
              <span v-if="item.match != null" class="project-search-match">
                Matched in {{ FIELDS[item.match.field] ?? item.match.field }}: “{{ item.match.excerpt }}”
              </span>
            </li>
          </ul>
          <p v-if="result.more[kind.key] > 0" class="project-search-more">
            {{ result.more[kind.key] }} more not shown, newest first. Add words to narrow the search.
          </p>
        </section>
      </template>
    </template>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue';

import Spinner from '../spinner.vue';
import useRequest from '../../composables/request';

defineOptions({ name: 'FieldDataProjectSearch' });
const props = defineProps({ projectId: { type: [String, Number], required: true } });
defineEmits(['open']);
const { request, awaitingResponse: busy } = useRequest();

const KINDS = [
  { key: 'assets', title: 'Assets' },
  { key: 'facts', title: 'Asset facts' },
  { key: 'findings', title: 'Findings' },
  { key: 'decisions', title: 'Review decisions' }
];
const FIELDS = { name: 'name', externalId: 'external ID', assetType: 'type', predicate: 'fact', value: 'value',
  title: 'title', explanation: 'explanation', note: 'note', reasonCode: 'reason' };
const query = ref(''); const result = ref(null); const error = ref('');
const total = computed(() => KINDS.reduce((n, { key }) => n + result.value.results[key].length, 0));

const search = () => {
  const q = query.value.trim();
  error.value = '';
  if (q.length < 2 || q.length > 100) {
    error.value = 'Enter 2 to 100 characters to search for.';
    return Promise.resolve();
  }
  return request({ method: 'GET', url: `/v1/projects/${props.projectId}/search?q=${encodeURIComponent(q)}`, alert: false })
    .then(({ data }) => {
      if (data?.results == null || KINDS.some(({ key }) => !Array.isArray(data.results[key]))) throw new Error('Unexpected response');
      result.value = data;
    })
    .catch(() => { result.value = null; error.value = 'The search could not be completed. Try again.'; });
};

const formPath = (xmlFormId) => `/projects/${props.projectId}/forms/${encodeURIComponent(xmlFormId)}`;
const submissionPath = (xmlFormId, instanceId) => `${formPath(xmlFormId)}/submissions/${encodeURIComponent(instanceId)}`;
</script>

<style lang="scss">
@import '../../assets/scss/variables';

.project-search {
  margin: 24px 0;
  overflow-wrap: anywhere;
  .project-search-form { align-items: flex-end; display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px;
    label { display: flex; flex: 1 1 240px; flex-direction: column; font-weight: normal; max-width: 420px; } }
  .project-search-empty, .project-search-more, .project-search-match { color: $color-text-secondary; }
  .project-search-match { display: block; }
  .project-search-error { color: $color-danger; }
  .project-search-kind ul { padding-left: 18px; }
  .project-search-kind li { margin-bottom: 6px; }
  .btn-link { padding: 0 4px; vertical-align: baseline; }
}
</style>
