<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

The home page is an operational overview. Every number comes from the Project
and Project summary endpoints; no sample targets or synthetic activity are
shown when the server has no data for them.
-->
<template>
  <div id="programme-dashboard">
    <aside class="programme-sidebar" aria-label="Dashboard navigation">
      <router-link class="sidebar-link" :class="{ active: $route.path === '/' }" to="/">
        <span class="icon-bar-chart" aria-hidden="true"></span>
        <span>{{ $t('nav.dashboard') }}</span>
      </router-link>
      <router-link class="sidebar-link" to="/projects">
        <span class="icon-folder-open" aria-hidden="true"></span>
        <span>{{ $t('resource.projects') }}</span>
      </router-link>
      <router-link v-if="reportsPath != null" class="sidebar-link"
        :to="reportsPath">
        <span class="icon-bar-chart" aria-hidden="true"></span>
        <span>{{ $t('nav.reports') }}</span>
      </router-link>
      <router-link v-if="canRoute('/field-data/media')" class="sidebar-link"
        to="/field-data/media">
        <span class="icon-image" aria-hidden="true"></span>
        <span>{{ $t('nav.media') }}</span>
      </router-link>
      <router-link v-if="canRoute('/field-data/integrations')" class="sidebar-link"
        to="/field-data/integrations">
        <span class="icon-exchange" aria-hidden="true"></span>
        <span>{{ $t('nav.integrations') }}</span>
      </router-link>
      <router-link v-if="canRoute('/users')" class="sidebar-link"
        to="/users">
        <span class="icon-user-circle" aria-hidden="true"></span>
        <span>{{ $t('resource.users') }}</span>
      </router-link>
      <router-link v-if="canRoute('/system/audits')" class="sidebar-link sidebar-admin"
        to="/system/audits">
        <span class="icon-cog" aria-hidden="true"></span>
        <span>{{ $t('nav.administration') }}</span>
      </router-link>
    </aside>

    <main class="programme-main">
      <header class="dashboard-header">
        <div>
          <p class="dashboard-date">{{ todayLabel }}</p>
          <h1>{{ $t('title') }}</h1>
          <p class="dashboard-intro">{{ $t('intro') }}</p>
        </div>
        <div class="dashboard-actions">
          <label class="date-range">
            <span class="icon-calendar" aria-hidden="true"></span>
            <span class="sr-only">{{ $t('action.period') }}</span>
            <select v-model.number="days">
              <option v-for="option in PERIODS" :key="option" :value="option">
                {{ $t('action.lastDays', { count: option }) }}
              </option>
            </select>
            <span class="date-range-label">{{ periodLabel }}</span>
          </label>
          <button type="button" class="btn btn-default" :disabled="!hasData"
            @click="exportSummary">
            <span class="icon-download" aria-hidden="true"></span>
            {{ $t('action.export') }}
          </button>
          <router-link v-if="reviewPath != null" class="btn btn-primary" :to="reviewPath">
            <span class="icon-check-circle" aria-hidden="true"></span>
            {{ $t('action.review') }}
          </router-link>
          <button v-else type="button" class="btn btn-primary" disabled>
            <span class="icon-check-circle" aria-hidden="true"></span>
            {{ $t('action.review') }}
          </button>
        </div>
      </header>

      <loading :state="projects.initiallyLoading"/>
      <template v-if="projects.dataExists">
        <section class="dashboard-kpis" :aria-label="$t('section.keyMetrics')">
          <article class="kpi">
            <span class="icon-folder-open kpi-icon" aria-hidden="true"></span>
            <div><strong>{{ $n(activeProjects.length, 'default') }}</strong><span>{{ $t('kpi.activeProjects') }}</span></div>
          </article>
          <article class="kpi">
            <span class="icon-file kpi-icon" aria-hidden="true"></span>
            <div><strong>{{ $n(deployedForms, 'default') }}</strong><span>{{ $t('kpi.formsDeployed') }}</span></div>
          </article>
          <article class="kpi">
            <span class="icon-bar-chart kpi-icon" aria-hidden="true"></span>
            <div>
              <strong>{{ $n(totalSubmissions, 'default') }}</strong>
              <span>{{ $t('kpi.submissions') }}</span>
              <small v-if="submissionChange != null"
                :class="submissionChange < 0 ? 'kpi-down' : 'kpi-up'">
                {{ $t('kpi.change', { value: $n(Math.abs(submissionChange), 'default') }) }}
              </small>
            </div>
          </article>
          <article class="kpi kpi-success">
            <span class="icon-check-circle kpi-icon" aria-hidden="true"></span>
            <div>
              <strong>{{ approvalRate == null ? '—' : `${approvalRate}%` }}</strong>
              <span>{{ $t('kpi.approvalRate') }}</span>
            </div>
          </article>
        </section>

        <div class="dashboard-grid dashboard-grid-primary">
          <section id="submission-trend" class="dashboard-card trend-card">
            <div class="card-heading">
              <div><h2>{{ $t('trend.title') }}</h2><p>{{ $t('trend.subtitle') }}</p></div>
            </div>
            <loading :state="summaryLoading"/>
            <div v-if="!summaryLoading && totalSubmissions === 0" class="dashboard-empty">
              <span class="icon-bar-chart" aria-hidden="true"></span>
              <p>{{ $t('trend.empty') }}</p>
            </div>
            <template v-else-if="!summaryLoading">
              <div class="chart-legend">
                <span v-for="(project, index) in chartProjects" :key="project.id">
                  <i :class="`series-${index}`"></i>{{ project.name }}
                </span>
              </div>
              <div class="stacked-chart" role="img" :aria-label="chartDescription">
                <div class="chart-axis" aria-hidden="true">
                  <span v-for="tick in yTicks" :key="tick.value"
                    :style="{ bottom: `${tick.offset}%` }">{{ $n(tick.value, 'default') }}</span>
                </div>
                <div v-for="point in trendPoints" :key="point.date" class="chart-column">
                  <div class="chart-bar" :title="`${formatShortDate(point.date)}: ${point.total}`">
                    <i v-for="(value, index) in point.values" :key="index"
                      :class="`series-${index}`" :style="segmentStyle(value)"></i>
                  </div>
                  <span v-if="point.showLabel">{{ formatChartDate(point.date) }}</span>
                </div>
              </div>
            </template>
          </section>

          <section id="project-health" class="dashboard-card health-card">
            <div class="card-heading">
              <div><h2>{{ $t('health.title') }}</h2><p>{{ $t('health.subtitle') }}</p></div>
            </div>
            <div v-if="activeProjects.length === 0" class="dashboard-empty compact">
              <p>{{ $t('health.empty') }}</p>
            </div>
            <div v-else class="health-table-wrap">
              <table class="health-table">
                <thead>
                  <tr>
                    <th>{{ $t('header.project') }}</th>
                    <th>{{ $t('header.health') }}</th>
                    <th>{{ $t('header.forms') }}</th>
                    <th>{{ $t('header.submissions') }}</th>
                    <th>{{ $t('header.lastActivity') }}</th>
                    <th><span class="sr-only">{{ $t('header.action') }}</span></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in projectRows" :key="row.id">
                    <td><router-link :to="`/projects/${row.id}`">{{ row.name }}</router-link></td>
                    <td><span class="health-status" :class="`health-${row.health}`"><i></i>{{ $t(`health.${row.health}`) }}</span></td>
                    <td>{{ row.deployedForms }}/{{ row.forms }}</td>
                    <td>{{ $n(row.submissions, 'default') }}</td>
                    <td>{{ row.lastActivity == null ? '—' : formatShortDate(row.lastActivity) }}</td>
                    <td><router-link class="row-action" :to="`/projects/${row.id}/summary`">{{ $t('action.open') }}</router-link></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div class="dashboard-grid dashboard-grid-secondary">
          <section id="data-quality" class="dashboard-card quality-card">
            <div class="card-heading">
              <div><h2>{{ $t('quality.title') }}</h2><p>{{ $t('quality.subtitle') }}</p></div>
            </div>
            <div class="quality-grid">
              <article v-for="item in qualityItems" :key="item.key" :class="`quality-${item.key}`">
                <span :class="item.icon" aria-hidden="true"></span>
                <strong>{{ $n(item.count, 'default') }}</strong>
                <span>{{ $t(`quality.${item.key}`) }}</span>
                <small>{{ percentage(item.count) }}</small>
              </article>
            </div>
          </section>

          <section class="dashboard-card activity-card">
            <div class="card-heading">
              <div><h2>{{ $t('activity.title') }}</h2><p>{{ $t('activity.subtitle') }}</p></div>
            </div>
            <div v-if="actionItems.length === 0" class="dashboard-empty compact">
              <span class="icon-check-circle" aria-hidden="true"></span>
              <p>{{ $t('activity.empty') }}</p>
            </div>
            <ul v-else class="activity-list">
              <li v-for="item in actionItems" :key="item.key">
                <span :class="[item.icon, 'activity-icon']" aria-hidden="true"></span>
                <div><strong>{{ item.title }}</strong><span>{{ item.project }}</span></div>
                <router-link :to="item.path" :aria-label="$t('action.openItem', { item: item.title })">
                  <span class="icon-chevron-right" aria-hidden="true"></span>
                </router-link>
              </li>
            </ul>
          </section>
        </div>
      </template>
    </main>
  </div>
</template>

<script setup>
import { DateTime } from 'luxon';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import Loading from '../loading.vue';

import useRequest from '../../composables/request';
import useRoutes from '../../composables/routes';
import { useRequestData } from '../../request-data';
import { apiPaths } from '../../util/request';

defineOptions({ name: 'ProgrammeDashboard' });

const PERIODS = [7, 21, 90];
const days = ref(21);
const { locale, n, t } = useI18n();
const { request } = useRequest();
const { canRoute } = useRoutes();
const { projects } = useRequestData();
const summaries = reactive(new Map());
const summaryLoading = ref(true);

const activeProjects = computed(() => (projects.dataExists
  ? projects.filter(project => !project.archived)
  : []));

watch(activeProjects, async (list) => {
  summaryLoading.value = true;
  summaries.clear();
  // Avoid turning a large programme into a burst of simultaneous requests.
  // Four workers keep the dashboard responsive without overwhelming Central.
  const queue = [...list];
  const loadNext = async () => {
    for (let project = queue.shift(); project != null; project = queue.shift()) {
      // Deliberately serial within each worker; the workers provide concurrency.
      // eslint-disable-next-line no-await-in-loop
      await request({
        method: 'GET', url: apiPaths.projectSummary(project.id), alert: false
      }).then(({ data }) => { summaries.set(project.id, data); }).catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, loadNext));
  summaryLoading.value = false;
}, { immediate: true });

const now = computed(() => DateTime.now().setLocale(locale.value));
const periodStart = computed(() => now.value.minus({ days: days.value - 1 }).startOf('day'));
const todayLabel = computed(() => now.value.toLocaleString(DateTime.DATE_HUGE));
// Both ends carry their month: "1 – September 21, 2026" read as a single date
// rather than a range. Medium format keeps it short in every locale.
const periodLabel = computed(() =>
  `${periodStart.value.toLocaleString(DateTime.DATE_MED)} – ${now.value.toLocaleString(DateTime.DATE_MED)}`);

const deployedForms = computed(() => activeProjects.value.reduce((total, project) =>
  total + project.formList.filter(form => form.publishedAt != null && form.state !== 'closed').length, 0));
const totalSubmissions = computed(() => activeProjects.value.reduce((total, project) => {
  const summary = summaries.get(project.id);
  return total + (summary?.submissions ?? project.formList
    .reduce((sum, form) => sum + (form.submissions ?? 0), 0));
}, 0));

const reviewCounts = computed(() => {
  const result = { approved: 0, hasIssues: 0, rejected: 0, received: 0, edited: 0 };
  for (const summary of summaries.values()) {
    for (const row of summary.reviewStates)
      result[row.state] = (result[row.state] ?? 0) + row.count;
  }
  return result;
});
const reviewTotal = computed(() => Object.values(reviewCounts.value).reduce((a, b) => a + b, 0));
const approvalRate = computed(() => (reviewTotal.value === 0 ? null
  : Math.round((reviewCounts.value.approved / reviewTotal.value) * 100)));
const qualityItems = computed(() => [
  { key: 'approved', count: reviewCounts.value.approved, icon: 'icon-check' },
  { key: 'issues', count: reviewCounts.value.hasIssues, icon: 'icon-exclamation-triangle' },
  { key: 'rejected', count: reviewCounts.value.rejected, icon: 'icon-times-circle' },
  { key: 'other', count: reviewCounts.value.received + reviewCounts.value.edited, icon: 'icon-clock-o' }
]);
const percentage = count => (reviewTotal.value === 0 ? '—'
  : t('quality.percent', { value: Math.round((count / reviewTotal.value) * 100) }));

const chartProjects = computed(() => activeProjects.value.slice(0, 6));
const trendPoints = computed(() => {
  const projectMaps = chartProjects.value.map(project => new Map(
    (summaries.get(project.id)?.overTime ?? []).map(point => [point.date, point.count])
  ));
  const step = Math.max(1, Math.round(days.value / 6));
  return Array.from({ length: days.value }, (_, index) => {
    const date = periodStart.value.plus({ days: index }).toISODate();
    const values = projectMaps.map(map => map.get(date) ?? 0);
    return {
      date,
      values,
      total: values.reduce((a, b) => a + b, 0),
      showLabel: index % step === 0 || index === days.value - 1
    };
  });
});
// Round the top of the scale up to something a reader can divide in their head,
// so the three gridlines land on numbers worth printing.
const niceCeiling = (value) => {
  if (value <= 5) return 5;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
};
const chartMax = computed(() => niceCeiling(
  Math.max(1, ...trendPoints.value.map(point => point.total))
));
const yTicks = computed(() => [0, 0.5, 1]
  .map(fraction => ({ value: Math.round(chartMax.value * fraction), offset: fraction * 100 })));
const segmentStyle = value => ({ height: `${(value / chartMax.value) * 100}%` });
const chartDescription = computed(() => t('trend.description', {
  days: days.value,
  max: n(Math.max(0, ...trendPoints.value.map(point => point.total)), 'default')
}));

const formatShortDate = iso => DateTime.fromISO(iso).setLocale(locale.value).toLocaleString(DateTime.DATE_MED);
const formatChartDate = iso => DateTime.fromISO(iso).setLocale(locale.value).toFormat('d LLL');

const projectRows = computed(() => activeProjects.value.map((project) => {
  const summary = summaries.get(project.id);
  const issues = summary?.reviewStates.find(row => row.state === 'hasIssues')?.count ?? 0;
  const submissions = summary?.submissions ?? project.formList.reduce((sum, form) => sum + (form.submissions ?? 0), 0);
  const lastActivity = summary?.lastSubmission ?? project.lastSubmission ?? project.updatedAt ?? project.createdAt;
  const stale = lastActivity != null && DateTime.fromISO(lastActivity) < now.value.minus({ days: 14 });
  // A flagged submission is normal; a high proportion of them is not. Grading
  // on the rate keeps "Needs attention" meaning something, where any issue at
  // all marked every project in the programme.
  const issueRate = submissions === 0 ? 0 : issues / submissions;
  let health;
  if (submissions === 0 || stale) health = 'inactive';
  else if (issueRate >= 0.1) health = 'attention';
  else if (issueRate >= 0.03) health = 'fair';
  else health = 'onTrack';
  return {
    id: project.id,
    name: project.name,
    forms: project.formList.length,
    deployedForms: project.formList.filter(form => form.publishedAt != null && form.state !== 'closed').length,
    submissions,
    lastActivity,
    health,
    issues
  };
}));

const reviewPath = computed(() => {
  for (const project of activeProjects.value) {
    const form = project.formList.find(item => item.reviewStates?.hasIssues > 0);
    if (form != null)
      return `/projects/${project.id}/forms/${encodeURIComponent(form.xmlFormId)}/submissions?reviewState=%27hasIssues%27`;
  }
  return null;
});

const reportsPath = computed(() => {
  const project = activeProjects.value.find(item => item.permits([
    'submission.list', 'submission.read'
  ]));
  return project == null ? null : `/projects/${project.id}/reports`;
});

const actionItems = computed(() => {
  const items = [];
  for (const row of projectRows.value) {
    if (row.issues > 0) items.push({
      key: `issues-${row.id}`,
      icon: 'icon-exclamation-circle',
      title: t('activity.reviewIssues', { count: row.issues }),
      project: row.name,
      path: `/projects/${row.id}/summary`
    });
  }
  for (const project of activeProjects.value) {
    const drafts = project.formList.filter(form => form.publishedAt == null).length;
    if (drafts > 0) items.push({
      key: `drafts-${project.id}`,
      icon: 'icon-edit',
      title: t('activity.unpublishedForms', { count: drafts }),
      project: project.name,
      path: `/projects/${project.id}`
    });
  }
  return items.slice(0, 4);
});

// The same window again, immediately before this one. Two equal periods are
// the only comparison the summary endpoint can support honestly.
const submissionsInWindow = (start, end) => {
  let total = 0;
  for (const summary of summaries.values()) {
    for (const point of summary.overTime ?? []) {
      if (point.date >= start && point.date <= end) total += point.count;
    }
  }
  return total;
};
const periodTotals = computed(() => {
  const end = now.value.toISODate();
  const start = periodStart.value.toISODate();
  const previousEnd = periodStart.value.minus({ days: 1 }).toISODate();
  const previousStart = periodStart.value.minus({ days: days.value }).toISODate();
  return {
    current: submissionsInWindow(start, end),
    previous: submissionsInWindow(previousStart, previousEnd)
  };
});
const earliestSubmission = computed(() => {
  let earliest = null;
  for (const summary of summaries.values()) {
    const first = summary.firstSubmission;
    if (first != null && (earliest == null || first < earliest)) earliest = first;
  }
  return earliest;
});
const submissionChange = computed(() => {
  const { current, previous } = periodTotals.value;
  if (previous === 0) return null;
  // The previous window has to be fully inside the data, or the percentage
  // measures how long we have been collecting rather than how it is going.
  const first = earliestSubmission.value;
  if (first == null) return null;
  if (DateTime.fromISO(first) > periodStart.value.minus({ days: days.value })) return null;
  return Math.round(((current - previous) / previous) * 100);
});

const hasData = computed(() => activeProjects.value.length > 0);
const csvCell = value => `"${String(value).replaceAll('"', '""')}"`;
const exportSummary = () => {
  const lines = [
    ['Project', 'Health', 'Deployed forms', 'All forms', 'Submissions', 'Last activity'],
    ...projectRows.value.map(row => [row.name, t(`health.${row.health}`), row.deployedForms,
      row.forms, row.submissions, row.lastActivity ?? ''])
  ].map(row => row.map(csvCell).join(','));
  const url = URL.createObjectURL(new Blob([`${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `programme-summary-${now.value.toISODate()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};
</script>

<style lang="scss">
@import '../../assets/scss/variables';

#programme-dashboard {
  background: #f8f9fc;
  display: flex;
  min-height: calc(100vh - var(--space-16));
}

// The dashboard owns primary navigation, so its top bar becomes a quiet
// utility bar rather than competing with the left rail.
body:has(#programme-dashboard) .navbar-default {
  background: #fff;
  border-bottom: 1px solid #e0e0ea;
  box-shadow: none;

  .navbar-brand {
    &, &:hover, &:focus { color: #20202b; }
  }
  .navbar-mark { color: #5d4ee0; }
  #navbar-links { display: none !important; }
  .navbar-nav > li > a {
    &, &:hover, &:focus { color: #303047; }
    &:hover { background: #f1f1f6; }
  }
  .navbar-nav .open > a {
    &, &:hover, &:focus { background: #eeebff; color: #4b3ccb; }
  }
}

.programme-sidebar {
  background: #fff;
  border-right: 1px solid #e0e0ea;
  display: flex;
  flex: 0 0 196px;
  flex-direction: column;
  gap: 4px;
  padding: 28px 12px 18px;

  .sidebar-link {
    align-items: center;
    border-radius: 8px;
    color: #303047;
    display: flex;
    font-size: 14px;
    font-weight: 500;
    gap: 14px;
    min-height: 46px;
    padding: 0 16px;
    text-decoration: none;
    transition: background-color 120ms ease, color 120ms ease;

    > span:first-child { font-size: 18px; width: 20px; }
    &:hover, &:focus { background: #f4f2ff; color: #4b3ccb; }
    &:focus-visible { box-shadow: var(--ring-focus); outline: none; }
    &.active { background: #eeebff; color: #513ee8; font-weight: 650; }
  }
  .sidebar-admin { border-top: 1px solid #e9e9f1; margin-top: auto; padding-top: 4px; }
}

.programme-main { flex: 1; min-width: 0; padding: 28px 24px 48px; }
.dashboard-header {
  align-items: flex-start;
  display: flex;
  gap: 24px;
  justify-content: space-between;
  margin: 0 auto 24px;
  max-width: 1440px;

  h1 { color: #151529; font-size: 36px; font-weight: 750; letter-spacing: -0.035em; line-height: 1.1; margin: 4px 0 6px; }
}
.dashboard-date { color: #68687a; font-size: 13px; margin: 0; }
.dashboard-intro { color: #68687a; font-size: 15px; margin: 0; }
.dashboard-actions { align-items: center; display: flex; flex-wrap: wrap; gap: 10px; padding-top: 18px; }
.date-range {
  align-items: center; background: #fff; border: 1px solid #cfcfdc; border-radius: 6px; color: #303047;
  cursor: pointer; display: flex; font-size: 12px; gap: 8px; min-height: 36px; padding: 0 12px; position: relative;

  select {
    appearance: none; background: transparent; border: 0; color: inherit; cursor: pointer;
    font-size: 12px; height: 100%; inset: 0; opacity: 0; position: absolute; width: 100%;
  }
  &:focus-within { border-color: #5d4ee0; box-shadow: 0 0 0 3px rgba(93, 78, 224, .18); }
  .date-range-label { font-variant-numeric: tabular-nums; }
  &::after { border-color: #68687a transparent transparent; border-style: solid; border-width: 4px 4px 0; content: ''; }
}
.dashboard-actions .btn { align-items: center; display: inline-flex; gap: 7px; min-height: 36px; }

.dashboard-kpis, .dashboard-grid { margin-inline: auto; max-width: 1440px; }
.dashboard-kpis {
  background: #fff; border: 1px solid #e0e0ea; border-radius: 10px; display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 16px; overflow: hidden;
}
.kpi {
  align-items: center; display: flex; gap: 14px; min-height: 104px; padding: 20px;
  &:not(:last-child) { border-right: 1px solid #e9e9f1; }
  small { display: block; font-size: 11px; font-variant-numeric: tabular-nums; margin-top: 2px; }
  .kpi-up { color: #1f7a4c; } .kpi-up::before { content: '\2191 '; }
  .kpi-down { color: #b42a2f; } .kpi-down::before { content: '\2193 '; }
  .kpi-icon { align-items: center; background: #eeebff; border-radius: 8px; color: #5d4ee0; display: flex; font-size: 24px; height: 50px; justify-content: center; width: 50px; }
  > div { display: flex; flex-direction: column; }
  strong { color: #17172d; font-size: 26px; line-height: 1; }
  span:last-child { color: #4d4d5c; font-size: 13px; margin-top: 7px; }
  &.kpi-success .kpi-icon { background: #e6f6ee; color: #1f7a4c; }
}

.dashboard-grid { display: grid; gap: 16px; margin-bottom: 16px; }
.dashboard-grid-primary { grid-template-columns: minmax(420px, 0.95fr) minmax(530px, 1.05fr); }
.trend-card { display: flex; flex-direction: column; }
.dashboard-grid-secondary { grid-template-columns: 1fr 1fr; }
.dashboard-card { background: #fff; border: 1px solid #e0e0ea; border-radius: 10px; min-width: 0; overflow: hidden; }
.card-heading { align-items: center; display: flex; justify-content: space-between; padding: 18px 20px 14px; }
.card-heading h2 { color: #20202b; font-size: 18px; font-weight: 700; margin: 0 0 3px; }
.card-heading p { color: #68687a; font-size: 12px; margin: 0; }

.chart-legend { display: flex; flex-wrap: wrap; gap: 14px; padding: 0 20px 6px 50px; }
.chart-legend span { color: #68687a; font-size: 10px; }
.chart-legend i { border-radius: 50%; display: inline-block; height: 8px; margin-right: 5px; width: 8px; }
.stacked-chart {
  align-items: end; border-bottom: 1px solid #cfcfdc; display: flex; flex: 1 1 auto; gap: 5px;
  margin: 0 18px 34px 52px; min-height: 258px; padding: 20px 0 0; position: relative;
}
.chart-axis {
  bottom: 0; left: 0; position: absolute; right: 0; top: 20px;

  span {
    color: #77778a; font-size: 10px; font-variant-numeric: tabular-nums; left: -12px;
    position: absolute; transform: translate(-100%, 50%);
  }
  span::after {
    border-top: 1px solid #ededf3; content: ''; left: 12px; position: absolute;
    top: 50%; width: 100vw;
  }
  span:first-child::after { border-top-color: transparent; }
}
.chart-column { align-self: stretch; display: flex; flex: 1; justify-content: flex-end; min-width: 4px; position: relative; z-index: 1; }
.chart-bar { align-self: end; display: flex; flex-direction: column-reverse; height: 100%; justify-content: flex-start; max-width: 22px; width: 100%; }
.chart-bar i { display: block; min-height: 0; }
.chart-column > span { bottom: -22px; color: #77778a; font-size: 9px; left: 50%; position: absolute; transform: translateX(-50%); white-space: nowrap; }
.series-0 { background: #5d4ee0; } .series-1 { background: #9589f4; } .series-2 { background: #2c66bf; }
.series-3 { background: #58a6c7; } .series-4 { background: #c477d7; } .series-5 { background: #e29a2b; }

.health-table-wrap { overflow-x: auto; }
.health-table { border-collapse: collapse; min-width: 650px; width: 100%; }
.health-table th { background: #f8f8fb; color: #4d4d5c; font-size: 10px; font-weight: 650; padding: 11px 12px; text-align: left; text-transform: uppercase; }
.health-table td { border-top: 1px solid #ededf3; color: #4d4d5c; font-size: 12px; padding: 16px 12px; vertical-align: middle; }
.health-table td:first-child { font-weight: 650; max-width: 170px; }
.health-status { align-items: center; border-radius: 99px; display: inline-flex; font-size: 10px; gap: 5px; padding: 5px 8px; white-space: nowrap; }
.health-status i { border-radius: 50%; height: 7px; width: 7px; }
.health-onTrack { background: #e6f6ee; color: #1f7a4c; } .health-onTrack i { background: #2fa96b; }
.health-fair { background: #fcf3e0; color: #8b5d13; } .health-fair i { background: #e29a2b; }
.health-attention { background: #fdeaea; color: #b42a2f; } .health-attention i { background: #d4484d; }
.health-inactive { background: #f1f1f6; color: #68687a; } .health-inactive i { background: #8a8a9c; }
.row-action { background: #eeebff; border-radius: 6px; display: inline-block; font-size: 11px; font-weight: 650; padding: 7px 10px; text-decoration: none; }

.quality-grid { display: grid; grid-template-columns: repeat(4, 1fr); padding: 10px 12px 24px; }
.quality-grid article { align-items: center; display: flex; flex-direction: column; min-width: 0; padding: 8px; text-align: center; }
.quality-grid article:not(:last-child) { border-right: 1px solid #e9e9f1; }
.quality-grid article > span:first-child { align-items: center; border-radius: 50%; display: flex; font-size: 18px; height: 42px; justify-content: center; margin-bottom: 10px; width: 42px; }
.quality-grid strong { color: #20202b; font-size: 23px; line-height: 1.1; }
.quality-grid article > span:nth-of-type(2) { color: #303047; font-size: 12px; margin-top: 4px; }
.quality-grid small { color: #77778a; font-size: 10px; margin-top: 4px; }
.quality-approved > span:first-child { background: #e6f6ee; color: #1f7a4c; }
.quality-issues > span:first-child { background: #fcf3e0; color: #a86f14; }
.quality-rejected > span:first-child { background: #fdeaea; color: #b42a2f; }
.quality-other > span:first-child { background: #f1f1f6; color: #68687a; }

.activity-list { list-style: none; margin: 0; padding: 0 18px 16px; }
.activity-list li { align-items: center; border-top: 1px solid #ededf3; display: flex; gap: 12px; min-height: 58px; }
.activity-icon { align-items: center; background: #fdeaea; border-radius: 7px; color: #b42a2f; display: flex; font-size: 16px; height: 34px; justify-content: center; width: 34px; }
.activity-list div { display: flex; flex: 1; flex-direction: column; min-width: 0; }
.activity-list strong { color: #303047; font-size: 12px; }
.activity-list div span { color: #77778a; font-size: 10px; margin-top: 2px; }
.activity-list a { align-items: center; color: #68687a; display: flex; height: 38px; justify-content: center; width: 38px; }

.dashboard-empty { align-items: center; color: #77778a; display: flex; flex-direction: column; justify-content: center; min-height: 250px; padding: 24px; text-align: center; }
.dashboard-empty > span { color: #aaaabd; font-size: 28px; }
.dashboard-empty p { margin: 10px 0 0; }
.dashboard-empty.compact { min-height: 120px; }

@media (max-width: 1199px) {
  .dashboard-header { align-items: stretch; flex-direction: column; }
  .dashboard-actions { padding-top: 0; }
  .dashboard-grid-primary, .dashboard-grid-secondary { grid-template-columns: 1fr; }
}
@media (max-width: 767px) {
  #programme-dashboard { display: block; }
  .programme-sidebar { border-bottom: 1px solid #e0e0ea; border-right: 0; flex-direction: row; overflow-x: auto; padding: 8px 12px; }
  .programme-sidebar .sidebar-link { flex: 0 0 auto; min-height: 42px; padding-inline: 12px; }
  .programme-sidebar .sidebar-admin { border: 0; margin: 0; }
  .programme-main { padding: 20px 15px 36px; }
  .dashboard-header h1 { font-size: 29px; }
  .dashboard-actions { align-items: stretch; display: grid; grid-template-columns: 1fr 1fr; }
  .date-range { grid-column: 1 / -1; }
  .dashboard-kpis { grid-template-columns: 1fr 1fr; }
  .kpi:nth-child(2) { border-right: 0; }
  .kpi:nth-child(-n+2) { border-bottom: 1px solid #e9e9f1; }
  .quality-grid { grid-template-columns: 1fr 1fr; }
  .quality-grid article:nth-child(2) { border-right: 0; }
  .quality-grid article:nth-child(-n+2) { border-bottom: 1px solid #e9e9f1; }
}
@media (max-width: 479px) {
  .dashboard-actions { grid-template-columns: 1fr; }
  .date-range { grid-column: auto; }
  .dashboard-kpis { grid-template-columns: 1fr; }
  .kpi { border-bottom: 1px solid #e9e9f1; border-right: 0 !important; }
  .kpi:last-child { border-bottom: 0; }
}
</style>

<i18n lang="json5">
{
  "en": {
    "title": "Programme dashboard",
    "intro": "Which projects and forms are performing well, and what requires management action?",
    "nav": { "dashboard": "Dashboard", "reports": "Reports", "media": "Media", "integrations": "Integrations", "administration": "Administration" },
    "section": { "keyMetrics": "Key programme metrics" },
    "kpi": { "activeProjects": "Active projects", "formsDeployed": "Forms deployed", "submissions": "Submissions", "approvalRate": "Approval rate", "change": "{value}% vs the period before" },
    "action": { "export": "Export summary", "review": "Review submissions", "open": "Open", "openItem": "Open {item}", "period": "Reporting period", "lastDays": "Last {count} days" },
    "trend": { "title": "Submissions by project", "subtitle": "Daily submissions across the reporting period", "description": "Stacked bar chart of submissions by project over {days} days, peaking at {max} in a day.", "empty": "Daily submission activity will appear here after data is received." },
    "health": { "title": "Project health", "subtitle": "Live activity and review indicators", "empty": "There are no active projects to show.", "onTrack": "On track", "fair": "Fair", "attention": "Needs attention", "inactive": "Inactive" },
    "header": { "project": "Project", "health": "Overall health", "forms": "Deployed forms", "submissions": "Submissions", "lastActivity": "Last activity", "action": "Action" },
    "quality": { "title": "Data quality", "subtitle": "Current submission review states", "approved": "Approved", "issues": "Has issues", "rejected": "Rejected", "other": "Other states", "percent": "{value}% of total" },
    "activity": { "title": "Activity and approvals", "subtitle": "Items that may require your attention", "empty": "No review or publishing actions need attention.", "reviewIssues": "Review {count} flagged submission | Review {count} flagged submissions", "unpublishedForms": "Publish {count} draft form | Publish {count} draft forms" }
  }
}
</i18n>
