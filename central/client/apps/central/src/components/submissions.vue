<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

Every Submission the user can read, from every Form and Project, newest first.
Triage work -- "what came in flagged this week" -- crosses Forms, and until now
it meant opening each Form's Submission table one at a time.
-->
<template>
  <div id="cross-project-submissions">
    <div class="cross-head">
      <div>
        <h1>{{ $t('title') }}</h1>
        <p class="cross-sub">{{ $t('subtitle') }}</p>
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
        <span>{{ $t('filter.reviewState') }}</span>
        <select v-model="reviewState" class="form-control">
          <option value="">{{ $t('filter.anyState') }}</option>
          <option v-for="state in REVIEW_STATES" :key="state" :value="state">
            {{ $t(`reviewState.${state}`) }}
          </option>
        </select>
      </label>
      <label class="cross-field">
        <span>{{ $t('filter.since') }}</span>
        <select v-model="sinceDays" class="form-control">
          <option value="">{{ $t('filter.anyTime') }}</option>
          <option v-for="option in SINCE_OPTIONS" :key="option" :value="option">
            {{ $t('filter.lastDays', { count: option }) }}
          </option>
        </select>
      </label>
      <p class="cross-count">{{ $t('matching', { count: $n(total, 'default') }) }}</p>
    </div>

    <loading :state="pending"/>

    <template v-if="!pending">
      <div v-if="submissions.length === 0" class="cross-empty">
        <p>{{ total === 0 && !filtered ? $t('empty.none') : $t('empty.filtered') }}</p>
      </div>
      <template v-else>
        <div class="cross-table-wrap">
          <table class="cross-table">
            <thead>
              <tr>
                <th>{{ $t('header.submitted') }}</th>
                <th>{{ $t('resource.form') }}</th>
                <th>{{ $t('resource.project') }}</th>
                <th>{{ $t('header.submittedBy') }}</th>
                <th>{{ $t('filter.reviewState') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="submission in submissions" :key="submission.instanceId">
                <td>
                  <router-link :to="submissionPath(submission)">
                    {{ formatDateTime(submission.createdAt) }}
                  </router-link>
                  <span class="cross-id">{{ submission.instanceId }}</span>
                </td>
                <td>
                  <router-link :to="formPath(submission)">{{ submission.formName }}</router-link>
                </td>
                <td>
                  <router-link :to="`/projects/${submission.projectId}`">
                    {{ submission.projectName }}
                  </router-link>
                </td>
                <td>{{ submission.submitterName ?? $t('unknownSubmitter') }}</td>
                <td>
                  <span class="cross-chip" :class="`chip-${submission.reviewState}`">
                    {{ $t(`reviewState.${submission.reviewState}`) }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="cross-pager">
          <span class="cross-range">{{ $t('range', {
            from: $n(offset + 1, 'default'),
            to: $n(offset + submissions.length, 'default'),
            total: $n(total, 'default'),
          }) }}</span>
          <button type="button" class="btn btn-default" :disabled="offset === 0"
            @click="turn(-1)">
            {{ $t('pager.previous') }}
          </button>
          <button type="button" class="btn btn-default"
            :disabled="offset + submissions.length >= total" @click="turn(1)">
            {{ $t('pager.next') }}
          </button>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup>
import { DateTime } from 'luxon';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import Loading from './loading.vue';

import useRequest from '../composables/request';
import { apiPaths } from '../util/request';

defineOptions({ name: 'SubmissionsPage' });

const PAGE_SIZE = 50;
// The five states the server stores. 'received' is the absence of a review
// rather than a stored value, which the endpoint knows how to filter on.
const REVIEW_STATES = ['received', 'hasIssues', 'edited', 'approved', 'rejected'];
const SINCE_OPTIONS = [7, 30, 90];

const { locale } = useI18n();
const { request } = useRequest();

const submissions = ref([]);
const total = ref(0);
const offset = ref(0);
const pending = ref(true);
const projectId = ref('');
const reviewState = ref('');
const sinceDays = ref('');
const projectOptions = ref([]);

const filtered = computed(() => projectId.value !== '' || reviewState.value !== '' ||
  sinceDays.value !== '');

const load = () => {
  pending.value = true;
  const since = sinceDays.value === ''
    ? undefined
    : DateTime.now().minus({ days: Number(sinceDays.value) }).startOf('day').toISODate();
  return request({
    method: 'GET',
    url: apiPaths.fieldDataSubmissions({
      limit: PAGE_SIZE,
      offset: offset.value,
      projectId: projectId.value === '' ? undefined : projectId.value,
      reviewState: reviewState.value === '' ? undefined : reviewState.value,
      since
    }),
    alert: false
  })
    .then(({ data }) => {
      submissions.value = data.submissions;
      total.value = data.total;
    })
    .catch(() => {})
    .finally(() => { pending.value = false; });
};

// The Project filter lists only Projects that have Forms the user can see,
// which is what the cross-project Forms listing already answers.
request({ method: 'GET', url: apiPaths.fieldDataForms(), alert: false })
  .then(({ data }) => {
    const byId = new Map();
    for (const form of data.forms) byId.set(form.projectId, form.projectName);
    projectOptions.value = [...byId].map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  })
  .catch(() => {});

load();
// Changing a filter starts the results again from the top: staying on page 7
// of a result set that no longer has seven pages shows an empty table.
watch([projectId, reviewState, sinceDays], () => { offset.value = 0; load(); });

const turn = (direction) => {
  offset.value = Math.max(0, offset.value + direction * PAGE_SIZE);
  load();
};

const formPath = (submission) =>
  `/projects/${submission.projectId}/forms/${encodeURIComponent(submission.xmlFormId)}`;
const submissionPath = (submission) =>
  `${formPath(submission)}/submissions/${encodeURIComponent(submission.instanceId)}`;
const formatDateTime = iso =>
  DateTime.fromISO(iso).setLocale(locale.value).toLocaleString(DateTime.DATETIME_MED);
</script>

<style lang="scss">
@import '../assets/scss/cross-project';
</style>

<i18n lang="json5">
{
  "en": {
    "title": "Submissions",
    "subtitle": "Everything received across every Project, newest first",
    "matching": "{count} matching",
    "range": "{from}–{to} of {total}",
    "unknownSubmitter": "Unknown",
    "filter": {
      "allProjects": "All Projects",
      "reviewState": "Review state",
      "anyState": "Any state",
      "since": "Received",
      "anyTime": "Any time",
      "lastDays": "Last {count} days"
    },
    "header": {
      "submitted": "Submitted",
      "submittedBy": "Submitted by"
    },
    "pager": {
      "previous": "Previous",
      "next": "Next"
    },
    "empty": {
      "none": "No Submissions have been received in any Project you can see.",
      "filtered": "No Submission matches these filters."
    }
  }
}
</i18n>
