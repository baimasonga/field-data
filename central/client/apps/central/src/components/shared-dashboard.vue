<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

A form's summary, shown to somebody who has no account and should not need
one -- a funder, a ministry, a district office.

The charts are the same components the Summary tab uses, drawn from the same
counts. What is different is everything around them: no navigation, nothing
to click through to, and a line saying plainly what this is, because a reader
arriving from a pasted link has no other context.
-->
<template>
  <div id="shared-dashboard">
    <header class="shared-head">
      <div class="shared-head-inner">
        <span class="shared-brand">{{ $t('common.appName') }}</span>
        <h1>{{ share?.name ?? $t('loading') }}</h1>
        <p v-if="share != null" class="shared-subject">
          {{ share.formName }} · {{ share.projectName }}
        </p>
      </div>
    </header>

    <div class="shared-body">
      <loading :state="loading"/>

      <p v-if="!loading && share == null" class="shared-gone">
        {{ $t('unavailable') }}
      </p>

      <template v-if="share != null">
        <p v-if="summary.submissions === 0" class="empty-table-message">
          {{ $t('noSubmissions') }}
        </p>

        <template v-else>
          <div class="summary-kpis">
            <div class="kpi-card">
              <div class="kpi-value">{{ $n(summary.submissions, 'default') }}</div>
              <div class="kpi-label">{{ $t('kpi.submissions') }}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-value">{{ $n(summary.submitters, 'default') }}</div>
              <div class="kpi-label">{{ $t('kpi.submitters') }}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-value">{{ $n(summary.overTime.length, 'default') }}</div>
              <div class="kpi-label">{{ $t('kpi.days') }}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-value kpi-date">
                <date-time :iso="summary.lastSubmission"/>
              </div>
              <div class="kpi-label">{{ $t('kpi.lastSubmission') }}</div>
            </div>
          </div>

          <chart-trend v-if="trend.length > 1" :points="trend"
            :title="$t('chart.overTime')" :description="$t('chart.overTimeDescription')"/>

          <chart-bars :data="reviewRows" :title="$t('chart.reviewStates')"
            :label-header="$t('header.reviewState')"/>

          <chart-bars v-for="field of summary.fields" :key="field.path"
            :data="fieldRows(field)" :title="field.name"
            :label-header="$t('header.answer')"/>
        </template>

        <footer class="shared-foot">
          <p>{{ $t('aggregatesOnly') }}</p>
          <p v-if="share.expiresAt != null">
            {{ $t('expires') }} <date-time :iso="share.expiresAt"/>
          </p>
        </footer>
      </template>
    </div>
  </div>
</template>

<script setup>
import { DateTime as Luxon } from 'luxon';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import ChartBars from './chart/bars.vue';
import ChartTrend from './chart/trend.vue';
import DateTime from './date-time.vue';
import Loading from './loading.vue';

import useRequest from '../composables/request';
import useReviewState from '../composables/review-state';
import { apiPaths } from '../util/request';
import { noop } from '../util/util';

defineOptions({ name: 'SharedDashboard' });

const props = defineProps({
  token: { type: String, required: true }
});

const { t } = useI18n();
const { reviewStateIcon } = useReviewState();
const { request } = useRequest();

const share = ref(null);
const loading = ref(true);

request({
  method: 'GET',
  url: apiPaths.sharedDashboard(props.token),
  // A bad token is an ordinary outcome here, not something to alert about:
  // the link has been revoked, or has expired, or was mistyped.
  problemToAlert: () => null
})
  .then(({ data }) => { share.value = data; })
  .catch(noop)
  .finally(() => { loading.value = false; });

const summary = computed(() => share.value.summary);

const REVIEW_COLORS = {
  approved: '#1f7a4c',   // gradient --success-text
  hasIssues: '#a86f14',  // gradient --warning-text
  rejected: '#b42a2f',   // gradient --danger-text
  edited: '#2c66bf',     // gradient --blue-700
  received: '#8a8a9c'    // gradient --gray-500
};

const reviewRows = computed(() => summary.value.reviewStates.map((row) => ({
  key: row.state,
  label: t(`reviewState.${row.state}`),
  count: row.count,
  color: REVIEW_COLORS[row.state] ?? REVIEW_COLORS.received,
  icon: reviewStateIcon(row.state === 'received' ? null : row.state)
})));

const trend = computed(() => {
  const given = summary.value.overTime;
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

const ORDERED_TYPES = new Set(['int', 'decimal', 'date', 'time', 'dateTime']);

const fieldRows = (field) => {
  const rows = field.values.map((row) => ({
    value: row.value,
    key: row.value ?? '__other__',
    label: row.value ?? t('other', row.other),
    count: row.count
  }));
  if (!ORDERED_TYPES.has(field.type)) return rows;
  const named = rows.filter((row) => row.value != null);
  const other = rows.filter((row) => row.value == null);
  const numeric = field.type === 'int' || field.type === 'decimal';
  named.sort((a, b) => (numeric
    ? Number(a.value) - Number(b.value)
    : a.value.localeCompare(b.value)));
  return [...named, ...other];
};
</script>

<i18n lang="json5">
{
  "en": {
    "loading": "Loading",
    "unavailable": "This link is no longer available. It may have been revoked, or it may have expired. Ask whoever shared it with you for a new one.",
    "noSubmissions": "There are no Submissions yet, so there is nothing to show.",
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
    "other": "Other ({count} answer) | Other ({count} answers)",
    "aggregatesOnly": "This page shows counts only. No individual Submission, photograph or contributor's name is reachable from this link.",
    "expires": "This link stops working on"
  }
}
</i18n>

<style lang="scss">
@import '../assets/scss/variables';

#shared-dashboard {
  background-color: #ffffff;
  min-height: 100vh;

  .shared-head {
    background: $color-page-background;
    border-bottom: 1px solid #e9e9f1;   // gradient --gray-150
    padding: 28px 16px 24px;
  }
  .shared-head-inner { margin: 0 auto; max-width: 1100px; }

  .shared-brand {
    color: $color-action-foreground;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  h1 {
    color: $color-text;
    font-size: 30px;
    font-weight: 700;
    margin: 6px 0 0;
  }

  .shared-subject {
    color: $color-text-muted;
    font-size: 14px;
    margin: 6px 0 0;
  }

  .shared-body {
    margin: 0 auto;
    max-width: 1100px;
    padding: 28px 16px 60px;
  }

  .shared-gone {
    color: $color-text-secondary;
    font-size: 15px;
    max-width: 52ch;
  }

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

  .shared-foot {
    border-top: 1px solid #e9e9f1;      // gradient --gray-150
    color: $color-text-muted;
    font-size: 12px;
    margin-top: 10px;
    max-width: 62ch;
    padding-top: 16px;

    p { margin: 0 0 4px; }
  }
}
</style>
