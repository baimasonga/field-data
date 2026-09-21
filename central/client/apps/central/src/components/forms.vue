<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

Every Form in the deployment, from every Project. The rest of the application
can only show one Project's Forms at a time, which is no use to somebody who
wants to know which Form across the whole programme has stopped receiving data.
-->
<template>
  <div id="cross-project-forms">
    <div class="cross-head">
      <div>
        <h1>{{ $t('title') }}</h1>
        <p class="cross-sub">{{ subtitle }}</p>
      </div>
    </div>

    <loading :state="pending"/>

    <template v-if="!pending">
      <div class="cross-filters">
        <label class="cross-field">
          <span>{{ $t('filter.search') }}</span>
          <input v-model="search" type="search" class="form-control"
            :placeholder="$t('filter.searchPlaceholder')">
        </label>
        <label class="cross-field">
          <span>{{ $t('resource.project') }}</span>
          <select v-model="projectFilter" class="form-control">
            <option value="">{{ $t('filter.allProjects') }}</option>
            <option v-for="name in projectNames" :key="name" :value="name">{{ name }}</option>
          </select>
        </label>
        <label class="cross-field">
          <span>{{ $t('filter.state') }}</span>
          <select v-model="stateFilter" class="form-control">
            <option value="">{{ $t('filter.anyState') }}</option>
            <option value="published">{{ $t('state.published') }}</option>
            <option value="draft">{{ $t('state.draft') }}</option>
            <option value="quiet">{{ $t('filter.quiet') }}</option>
          </select>
        </label>
        <p class="cross-count">
          {{ $t('count', { shown: $n(visible.length, 'default'), total: $n(forms.length, 'default') }) }}
        </p>
      </div>

      <div v-if="forms.length === 0" class="cross-empty">
        <p>{{ $t('empty.none') }}</p>
      </div>
      <div v-else-if="visible.length === 0" class="cross-empty">
        <p>{{ $t('empty.filtered') }}</p>
      </div>
      <div v-else class="cross-table-wrap">
        <table class="cross-table">
          <thead>
            <tr>
              <th>{{ $t('header.form') }}</th>
              <th>{{ $t('resource.project') }}</th>
              <th>{{ $t('filter.state') }}</th>
              <th class="num">{{ $t('header.submissions') }}</th>
              <th>{{ $t('header.lastSubmission') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="form in visible" :key="`${form.projectId}/${form.xmlFormId}`">
              <td>
                <router-link :to="formPath(form)">{{ form.name }}</router-link>
                <span class="cross-id">{{ form.xmlFormId }}</span>
              </td>
              <td><router-link :to="`/projects/${form.projectId}`">{{ form.projectName }}</router-link></td>
              <td><span class="cross-chip" :class="`chip-${stateOf(form)}`">{{ $t(`state.${stateOf(form)}`) }}</span></td>
              <td class="num">{{ $n(form.submissions, 'default') }}</td>
              <td>
                <template v-if="form.lastSubmission == null">&mdash;</template>
                <template v-else>
                  {{ formatDate(form.lastSubmission) }}
                  <span v-if="isQuiet(form)" class="cross-chip chip-quiet">{{ $t('state.quiet') }}</span>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup>
import { DateTime } from 'luxon';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import Loading from './loading.vue';

import useRequest from '../composables/request';
import { apiPaths } from '../util/request';

defineOptions({ name: 'FormsPage' });

// A Form nobody has submitted to in this long is worth surfacing on its own.
const QUIET_DAYS = 14;

const { locale, t } = useI18n();
const { request } = useRequest();
const forms = ref([]);
const pending = ref(true);
const search = ref('');
const projectFilter = ref('');
const stateFilter = ref('');

request({ method: 'GET', url: apiPaths.fieldDataForms() })
  .then(({ data }) => { forms.value = data.forms; })
  .catch(() => {})
  .finally(() => { pending.value = false; });

const isQuiet = (form) => form.submissions > 0 && form.lastSubmission != null &&
  DateTime.fromISO(form.lastSubmission) < DateTime.now().minus({ days: QUIET_DAYS });
const stateOf = (form) => {
  if (!form.published) return 'draft';
  return form.state === 'closed' ? 'closed' : 'published';
};

const projectNames = computed(() =>
  [...new Set(forms.value.map(form => form.projectName))].sort());

const visible = computed(() => {
  const term = search.value.trim().toLowerCase();
  return forms.value.filter((form) => {
    if (projectFilter.value !== '' && form.projectName !== projectFilter.value) return false;
    if (stateFilter.value === 'quiet' && !isQuiet(form)) return false;
    if (stateFilter.value !== '' && stateFilter.value !== 'quiet' &&
      stateOf(form) !== stateFilter.value) return false;
    if (term === '') return true;
    return form.name.toLowerCase().includes(term) ||
      form.xmlFormId.toLowerCase().includes(term) ||
      form.projectName.toLowerCase().includes(term);
  });
});

const subtitle = computed(() => t('subtitle', {
  forms: t('countForms', forms.value.length),
  projects: t('countProjects', projectNames.value.length)
}));

const formPath = (form) =>
  `/projects/${form.projectId}/forms/${encodeURIComponent(form.xmlFormId)}`;
const formatDate = iso =>
  DateTime.fromISO(iso).setLocale(locale.value).toLocaleString(DateTime.DATE_MED);
</script>

<style lang="scss">
@import '../assets/scss/cross-project';
</style>

<i18n lang="json5">
{
  "en": {
    "title": "Forms",
    "subtitle": "{forms} across {projects}",
    "countForms": "no Forms | 1 Form | {count} Forms",
    "countProjects": "no Projects | 1 Project | {count} Projects",
    "count": "Showing {shown} of {total}",
    "filter": {
      "search": "Search",
      "searchPlaceholder": "Form name, id or Project",
      "allProjects": "All Projects",
      "state": "State",
      "anyState": "Any state",
      "quiet": "No recent Submissions"
    },
    "state": {
      "published": "Published",
      "draft": "Draft",
      "closed": "Closed",
      "quiet": "Quiet"
    },
    "header": {
      "form": "Form",
      "submissions": "Submissions",
      "lastSubmission": "Last Submission"
    },
    "empty": {
      "none": "There are no Forms in any Project you can see.",
      "filtered": "No Form matches these filters."
    }
  }
}
</i18n>
