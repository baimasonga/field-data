<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

What a form's submissions add up to. The counts come from the server, over
every live submission, so the summary describes the form rather than whatever
the browser managed to download.
-->
<template>
  <div id="submission-summary">
    <loading :state="summary.initiallyLoading"/>

    <template v-if="summary.dataExists">
      <p v-if="summary.data.submissions === 0" class="empty-table-message">
        {{ $t('noSubmissions') }}
      </p>

      <template v-else>
        <!-- A handful of headline numbers is a KPI row, not a chart. -->
        <div class="summary-kpis">
          <div class="kpi-card">
            <div class="kpi-value">{{ $n(summary.data.submissions, 'default') }}</div>
            <div class="kpi-label">{{ $t('kpi.submissions') }}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-value">{{ $n(summary.data.submitters, 'default') }}</div>
            <div class="kpi-label">{{ $t('kpi.submitters') }}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-value">{{ $n(days, 'default') }}</div>
            <div class="kpi-label">{{ $t('kpi.days') }}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-value kpi-date">
              <date-time :iso="summary.data.lastSubmission"/>
            </div>
            <div class="kpi-label">{{ $t('kpi.lastSubmission') }}</div>
          </div>
        </div>

        <chart-trend v-if="trend.length > 1" :points="trend"
          :title="$t('chart.overTime')" :description="$t('chart.overTimeDescription')"/>

        <chart-bars :data="reviewRows" :title="$t('chart.reviewStates')"
          :label-header="$t('header.reviewState')"/>

        <chart-bars v-for="field of summary.data.fields" :key="field.path"
          :data="fieldRows(field)" :title="field.name"
          :subtitle="fieldSubtitle(field)" :label-header="$t('header.answer')"/>

        <p v-if="summary.data.truncated" class="summary-note">
          {{ $t('truncated') }}
        </p>
      </template>

      <submission-share v-if="project.dataExists && project.permits('form.update')"
        :project-id="projectId" :xml-form-id="xmlFormId"/>
    </template>
  </div>
</template>

<script setup>
import { DateTime as Luxon } from 'luxon';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import ChartBars from '../chart/bars.vue';
import ChartTrend from '../chart/trend.vue';
import DateTime from '../date-time.vue';
import Loading from '../loading.vue';
import SubmissionShare from './share.vue';

import useReviewState from '../../composables/review-state';
import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';
import { useRequestData } from '../../request-data';

defineOptions({ name: 'SubmissionSummary' });

const props = defineProps({
  projectId: { type: String, required: true },
  xmlFormId: { type: String, required: true }
});

const { t, n } = useI18n();
const { reviewStateIcon } = useReviewState();
const { project, createResource } = useRequestData();

const summary = createResource('formSummary');
summary.request({ url: apiPaths.formSummary(props.projectId, props.xmlFormId) }).catch(noop);

// Review states are the one place a colour here means a state rather than an
// identity, so they take the reserved status steps and always arrive with
// their own icon and label. Every step clears 3:1 against the panel:
// 5.32, 4.24, 6.34, 5.59. "Received" is deliberately the neutral -- nobody
// has reviewed it, so it is the absence of a state rather than one more.
const REVIEW_COLORS = {
  approved: '#1f7a4c',   // gradient --success-text
  hasIssues: '#a86f14',  // gradient --warning-text
  rejected: '#b42a2f',   // gradient --danger-text
  edited: '#2c66bf',     // gradient --blue-700
  received: '#8a8a9c'    // gradient --gray-500
};

const reviewRows = computed(() => summary.data.reviewStates.map((row) => ({
  key: row.state,
  label: t(`reviewState.${row.state}`),
  count: row.count,
  color: REVIEW_COLORS[row.state] ?? REVIEW_COLORS.received,
  icon: reviewStateIcon(row.state === 'received' ? null : row.state)
})));

// A gap in the dates is information: nothing came in that day. Drawing the
// line straight across the gap would invent submissions that never arrived.
const trend = computed(() => {
  const given = summary.data.overTime;
  if (given.length === 0) return [];
  const byDate = new Map(given.map((row) => [row.date, row.count]));
  const points = [];
  let cursor = Luxon.fromISO(given[0].date);
  const last = Luxon.fromISO(given[given.length - 1].date);
  // A form running for years would be a chart of thousands of points; stop
  // well before that rather than render something nobody can read.
  const MAX_DAYS = 400;
  while (cursor <= last && points.length < MAX_DAYS) {
    const date = cursor.toISODate();
    points.push({ date, count: byDate.get(date) ?? 0 });
    cursor = cursor.plus({ days: 1 });
  }
  return points;
});

const days = computed(() => summary.data.overTime.length);

// Swapping the order of household sizes, ages or dates would change what the
// chart says, so those go in value order. Answers with no natural order --
// districts, water sources -- stay in count order, where the longest bar is
// also the top one and the eye has nothing to do.
const ORDERED_TYPES = new Set(['int', 'decimal', 'date', 'time', 'dateTime']);

const fieldRows = (field) => {
  const rows = field.values.map((row) => ({
    value: row.value,
    key: row.value ?? '__other__',
    label: row.value ?? t('other', row.other),
    count: row.count
  }));
  if (!ORDERED_TYPES.has(field.type)) return rows;

  // "Other" is the tail of the distribution and has no position in it, so it
  // stays at the end wherever its values would have sorted.
  const named = rows.filter((row) => row.value != null);
  const other = rows.filter((row) => row.value == null);
  const numeric = field.type === 'int' || field.type === 'decimal';
  named.sort((a, b) => (numeric
    ? Number(a.value) - Number(b.value)
    : a.value.localeCompare(b.value)));
  return [...named, ...other];
};

const fieldSubtitle = (field) => {
  const unanswered = summary.data.submissions - field.answered;
  return unanswered > 0
    ? t('unanswered', { count: n(unanswered, 'default') })
    : null;
};
</script>

<i18n lang="json5">
{
  "en": {
    "noSubmissions": "There are no Submissions yet, so there is nothing to summarize.",
    "kpi": {
      "submissions": "Submissions",
      "submitters": "Submitters",
      "days": "Days with Submissions",
      "lastSubmission": "Latest Submission"
    },
    "chart": {
      "overTime": "Submissions over time",
      "overTimeDescription": "A line chart of Submissions received per day.",
      "reviewStates": "Review state"
    },
    "header": {
      "reviewState": "Review state",
      "answer": "Answer"
    },
    // {count} is a number of answers not shown individually.
    "other": "Other ({count} answer) | Other ({count} answers)",
    // {count} is a number of Submissions that left the question blank.
    "unanswered": "{count} blank",
    "truncated": "Only the first questions with repeating answers are charted. Questions whose answers are nearly all different, like names and notes, are left out because a chart of them says nothing."
  }
}
</i18n>

<style lang="scss">
@import '../../assets/scss/variables';

#submission-summary {
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

  // Proportional figures: tabular widths make a standalone number look loose
  // at this size.
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

  .summary-note {
    border-top: 1px solid #e9e9f1;      // gradient --gray-150
    color: $color-text-muted;
    font-size: 12px;
    max-width: 60ch;
    padding-top: 14px;
  }
}
</style>
