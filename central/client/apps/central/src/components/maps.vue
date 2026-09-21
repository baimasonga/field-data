<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

Where collection is happening, across every Project at once. A Form's own map
answers this one Form at a time, which is no help when the question is which
district has gone quiet.
-->
<template>
  <div id="cross-project-map">
    <div class="cross-head">
      <div>
        <h1>{{ $t('title') }}</h1>
        <p class="cross-sub">{{ subtitle }}</p>
      </div>
    </div>

    <div class="cross-filters">
      <label class="cross-field">
        <span>{{ $t('resource.project') }}</span>
        <select v-model="projectId" class="form-control">
          <option value="">{{ $t('filter.allProjects') }}</option>
          <option v-for="project in projectOptions" :key="project.id" :value="project.id">
            {{ project.name }}
          </option>
        </select>
      </label>
      <label class="cross-field">
        <span>{{ $t('filter.points') }}</span>
        <select v-model.number="limit" class="form-control">
          <option v-for="option in LIMITS" :key="option" :value="option">
            {{ $t('filter.upTo', { count: $n(option, 'default') }) }}
          </option>
        </select>
      </label>
      <p class="cross-count">{{ countLabel }}</p>
    </div>

    <loading :state="pending"/>

    <template v-if="!pending">
      <div v-if="collection == null || collection.features.length === 0" class="cross-empty">
        <p>{{ $t('empty') }}</p>
      </div>
      <template v-else>
        <div ref="mapEl" class="cross-map">
          <geojson-map :data="collection" :sizer="sizeMap"
            @selection-changed="selectionChanged"/>
        </div>
        <div v-if="selection != null" class="cross-selection">
          <div>
            <strong>{{ selection.formName }}</strong>
            <span>{{ selection.projectName }}</span>
          </div>
          <router-link class="btn btn-default" :to="selectionPath">
            {{ $t('action.openSubmission') }}
          </router-link>
        </div>

        <div class="cross-table-wrap">
          <table class="cross-table">
            <thead>
              <tr>
                <th>{{ $t('resource.form') }}</th>
                <th>{{ $t('resource.project') }}</th>
                <th class="num">{{ $t('header.submissions') }}</th>
                <th class="num">{{ $t('header.onMap') }}</th>
                <th>{{ $t('header.lastSubmission') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="form in forms" :key="`${form.projectId}/${form.xmlFormId}`">
                <td>
                  <router-link :to="formPath(form)">{{ form.formName }}</router-link>
                </td>
                <td>
                  <router-link :to="`/projects/${form.projectId}`">{{ form.projectName }}</router-link>
                </td>
                <td class="num">{{ $n(form.submissions, 'default') }}</td>
                <td class="num">{{ $n(drawn(form), 'default') }}</td>
                <td>{{ formatDate(form.lastSubmission) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup>
import { DateTime } from 'luxon';
import { computed, defineAsyncComponent, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import Loading from './loading.vue';

import useRequest from '../composables/request';
import { apiPaths } from '../util/request';
import { loadAsync } from '../util/load-async';

defineOptions({ name: 'MapsPage' });

const LIMITS = [500, 2000];

const GeojsonMap = defineAsyncComponent(loadAsync('GeojsonMap'));

const { locale, t, n } = useI18n();
const { request } = useRequest();

const collection = shallowRef(null);
const forms = ref([]);
const truncated = ref(false);
const pending = ref(true);
const projectId = ref('');
const limit = ref(LIMITS[0]);
const selection = shallowRef(null);
const mapEl = useTemplateRef('mapEl');

const load = () => {
  pending.value = true;
  selection.value = null;
  return request({
    method: 'GET',
    url: apiPaths.fieldDataMap({
      limit: limit.value,
      projectId: projectId.value === '' ? undefined : projectId.value
    }),
    alert: false
  })
    .then(({ data }) => {
      collection.value = { type: data.type, features: data.features };
      forms.value = data.forms;
      truncated.value = data.truncated;
    })
    .catch(() => {})
    .finally(() => { pending.value = false; });
};

const projectOptions = ref([]);

// The Project filter lists only Projects that have Forms the user can see.
request({ method: 'GET', url: apiPaths.fieldDataForms(), alert: false })
  .then(({ data }) => {
    const byId = new Map();
    for (const form of data.forms) byId.set(form.projectId, form.projectName);
    projectOptions.value = [...byId].map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  })
  .catch(() => {});

load();
watch([projectId, limit], load);

const drawnByForm = computed(() => {
  const counts = new Map();
  for (const feature of collection.value?.features ?? []) {
    const key = `${feature.properties.projectId}/${feature.properties.xmlFormId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
});
const drawn = form => drawnByForm.value.get(`${form.projectId}/${form.xmlFormId}`) ?? 0;

const countLabel = computed(() => {
  const count = collection.value?.features.length ?? 0;
  // Saying "the first 500" rather than a bare count, because a map that has
  // drawn part of the data looks exactly like one that has drawn all of it.
  return truncated.value
    ? t('countTruncated', { count: n(count, 'default') })
    : t('count', { count: n(count, 'default') });
});
const subtitle = computed(() => t('subtitle', {
  forms: t('countForms', forms.value.length)
}));

const selectionChanged = (feature) => {
  selection.value = feature == null ? null : feature.properties;
};
const formPath = (form) =>
  `/projects/${form.projectId}/forms/${encodeURIComponent(form.xmlFormId)}`;
const selectionPath = computed(() => (selection.value == null
  ? ''
  : `${formPath(selection.value)}/submissions`));

const sizeMap = () => {
  const rect = mapEl.value?.getBoundingClientRect();
  if (rect == null || rect.height === 0) return '';
  return Math.max(320, document.documentElement.clientHeight - rect.top - 220);
};

const formatDate = iso => (iso == null
  ? '—'
  : DateTime.fromISO(iso).setLocale(locale.value).toLocaleString(DateTime.DATE_MED));
</script>

<style lang="scss">
@import '../assets/scss/cross-project';

.cross-map {
  background: #fff;
  border: 1px solid #e0e0ea;
  border-radius: 10px;
  margin-bottom: 14px;
  overflow: hidden;
  padding: 4px;
}

.cross-selection {
  align-items: center;
  background: #fff;
  border: 1px solid #e0e0ea;
  border-radius: 10px;
  display: flex;
  gap: 12px;
  margin-bottom: 14px;
  padding: 12px 16px;

  strong { display: block; font-size: 14px; }
  span { color: #68687a; font-size: 12.5px; }
  .btn { margin-left: auto; }
}
</style>

<i18n lang="json5">
{
  "en": {
    "title": "Maps",
    "subtitle": "Where collection is happening, across {forms}",
    "countForms": "no Forms | 1 Form | {count} Forms",
    "count": "{count} located Submissions",
    "countTruncated": "Showing the first {count} located Submissions",
    "filter": {
      "allProjects": "All Projects",
      "points": "Points",
      "upTo": "Up to {count}"
    },
    "header": {
      "submissions": "Submissions",
      "onMap": "On this map",
      "lastSubmission": "Last Submission"
    },
    "action": {
      "openSubmission": "Open this Form's Submissions"
    },
    "empty": "No Submission in any Project you can see carries a location."
  }
}
</i18n>
