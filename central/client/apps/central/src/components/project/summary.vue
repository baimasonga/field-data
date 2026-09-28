<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

How a whole project is going, rather than one form at a time.

The form summary answers the same questions about a single form. Somebody
running a round of data collection has to add those up in their head to know
whether the round is on track, so the adding up happens here instead.
-->
<template>
  <div id="project-summary">
    <loading :state="loading"/>

    <template v-if="!loading && data != null">
      <p v-if="data.submissions === 0" class="empty-table-message">
        {{ $t('noSubmissions') }}
      </p>

      <template v-else>
        <div class="summary-kpis">
          <div class="kpi-card">
            <div class="kpi-value">{{ $n(data.submissions, 'default') }}</div>
            <div class="kpi-label">{{ $t('kpi.submissions') }}</div>
          </div>
          <div class="kpi-card">
            <!-- Forms that have been used, out of forms that exist: a project
            with nine forms and two in use is a different situation from one
            with two forms, and the second number is what says which. -->
            <div class="kpi-value">
              {{ $t('kpi.formsValue', {
                used: $n(data.formsWithSubmissions, 'default'),
                total: $n(data.forms, 'default')
              }) }}
            </div>
            <div class="kpi-label">{{ $t('kpi.formsInUse') }}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-value">{{ $n(data.submitters, 'default') }}</div>
            <div class="kpi-label">{{ $t('kpi.submitters') }}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-value kpi-date">
              <date-time :iso="data.lastSubmission"/>
            </div>
            <div class="kpi-label">{{ $t('kpi.lastSubmission') }}</div>
          </div>
        </div>

        <chart-trend v-if="trend.length > 1" :points="trend"
          :title="$t('chart.overTime')" :description="$t('chart.overTimeDescription')"/>

        <chart-bars :data="formRows" :title="$t('chart.byForm')"
          :label-header="$t('header.form')"/>

        <chart-bars :data="reviewRows" :title="$t('chart.reviewStates')"
          :label-header="$t('header.reviewState')"/>
      </template>
    </template>
  </div>
</template>

<script setup>
import { DateTime as Luxon } from 'luxon';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import ChartBars from '../chart/bars.vue';
import ChartTrend from '../chart/trend.vue';
import DateTime from '../date-time.vue';
import Loading from '../loading.vue';

import useRequest from '../../composables/request';
import useReviewState from '../../composables/review-state';
import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';

defineOptions({ name: 'ProjectSummary' });

const props = defineProps({
  projectId: { type: String, required: true }
});

const { t } = useI18n();
const { reviewStateIcon } = useReviewState();
const { request } = useRequest();

const data = ref(null);
const loading = ref(true);

request({ method: 'GET', url: apiPaths.projectSummary(props.projectId) })
  .then((response) => { data.value = response.data; })
  .catch(noop)
  .finally(() => { loading.value = false; });

const REVIEW_COLORS = {
  approved: '#1f7a4c',   // gradient --success-text
  hasIssues: '#a86f14',  // gradient --warning-text
  rejected: '#b42a2f',   // gradient --danger-text
  edited: '#2c66bf',     // gradient --blue-700
  received: '#8a8a9c'    // gradient --gray-500
};

const reviewRows = computed(() => data.value.reviewStates.map((row) => ({
  key: row.state,
  label: t(`reviewState.${row.state}`),
  count: row.count,
  color: REVIEW_COLORS[row.state] ?? REVIEW_COLORS.received,
  icon: reviewStateIcon(row.state === 'received' ? null : row.state)
})));

// Forms are names, not an ordered scale, so they take one hue and sort by
// count: the busiest form is the top bar and the eye has nothing to do.
//
// Sorted here as well as in the query. A bar chart that claims to be ordered
// and is not is worse than one that never claimed it, and the chart should not
// depend on an ordering decision made in another file to keep that promise.
const formRows = computed(() => [...data.value.byForm]
  .sort((a, b) => b.count - a.count)
  .map((row) => ({
    key: row.xmlFormId,
    label: row.name,
    count: row.count
  })));

const trend = computed(() => {
  const given = data.value.overTime;
  if (given.length === 0) return [];
  const byDate = new Map(given.map((row) => [row.date, row.count]));
  const points = [];
  let cursor = Luxon.fromISO(given[0].date);
  const last = Luxon.fromISO(given[given.length - 1].date);
  const MAX_DAYS = 400;
  while (cursor <= last && points.length < MAX_DAYS) {
    const date = cursor.toISODate();
    points.push({ date, count: byDate.get(date) ?? 0 });
    cursor = cursor.plus({ days: 1 });
  }
  return points;
});
</script>

<i18n lang="json5">
{
  "en": {
    "noSubmissions": "No Submissions have been received in this Project yet.",
    "kpi": {
      "submissions": "Submissions",
      "formsInUse": "Forms in Use",
      // {used} is how many Forms have Submissions; {total} is how many exist.
      "formsValue": "{used} of {total}",
      "submitters": "Submitters",
      "lastSubmission": "Latest Submission"
    },
    "chart": {
      "overTime": "Submissions over time",
      "overTimeDescription": "A line chart of Submissions received per day across the Project.",
      "byForm": "Submissions by Form",
      "reviewStates": "Review state"
    },
    "header": {
      "form": "Form",
      "reviewState": "Review state"
    }
  }
}
</i18n>

<style lang="scss">
@import '../../assets/scss/variables';

#project-summary {
  padding-top: 20px;

  .summary-kpis {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    margin-bottom: 30px;
  }

  .kpi-card {
    background-color: #f8f8fb;          // gradient --gray-50
    border: 1px solid #e9e9f1;          // gradient --gray-150
    border-radius: 8px;
    flex: 1 1 160px;
    padding: 16px 18px;
  }
  .kpi-value {
    color: $color-text;
    font-size: 28px;
    font-weight: 600;
    line-height: 1.1;
  }
  .kpi-date { font-size: 15px; font-weight: 500; padding-block: 6px; }
  .kpi-label {
    color: $color-text-muted;
    font-size: 11px;
    letter-spacing: 0.06em;
    margin-top: 6px;
    text-transform: uppercase;
  }
}
</style>
