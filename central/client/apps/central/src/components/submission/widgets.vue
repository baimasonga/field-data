<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

Charts somebody kept. The Summary tab computes charts fresh and forgets them;
these have a title their author chose and a place in an order they arranged.

Every chart here shows its denominator beside its title. A mean over a field
three quarters of submissions left blank is not the mean a reader will assume,
and the number outlives the caveat once it reaches a report. The coverage line
is not decoration.
-->
<template>
  <div id="submission-widgets">
    <Loading :state="loading"/>

    <template v-if="!loading">
      <section class="widget-new">
        <h2>{{ $t('create.title') }}</h2>
        <p class="section-lead">{{ $t('create.lead') }}</p>

        <form class="widget-form" @submit.prevent="create">
          <label class="widget-field">
            <span>{{ $t('field.title') }}</span>
            <input v-model.trim="draft.title" class="form-control" type="text"
              maxlength="255" :placeholder="$t('field.titlePlaceholder')">
          </label>

          <label class="widget-field">
            <span>{{ $t('field.aggregation') }}</span>
            <select v-model="draft.aggregation" class="form-control">
              <option value="count">{{ $t('aggregation.count') }}</option>
              <option value="mean">{{ $t('aggregation.mean') }}</option>
              <option value="median">{{ $t('aggregation.median') }}</option>
              <option value="sum">{{ $t('aggregation.sum') }}</option>
            </select>
          </label>

          <label class="widget-field">
            <span>{{ draft.aggregation === 'count' ? $t('field.column') : $t('field.number') }}</span>
            <select v-model="draft.column" class="form-control">
              <option value="">{{ $t('field.choose') }}</option>
              <option v-for="field of columnOptions" :key="field.path" :value="field.path">
                {{ field.name }}
              </option>
            </select>
          </label>

          <label v-if="draft.aggregation !== 'count'" class="widget-field">
            <span>{{ $t('field.groupBy') }}</span>
            <select v-model="draft.groupBy" class="form-control">
              <option value="">{{ $t('field.choose') }}</option>
              <option v-for="field of groupOptions" :key="field.path" :value="field.path">
                {{ field.name }}
              </option>
            </select>
          </label>

          <button type="submit" class="btn btn-primary"
            :aria-disabled="!canCreate || awaitingResponse">
            {{ $t('action.add') }} <spinner :state="awaitingResponse"/>
          </button>
        </form>
      </section>

      <section class="widget-list">
        <h2>{{ $t('saved.title') }}</h2>

        <!-- A blank tab with an Add button teaches nobody what a chart here is
        for, so the empty state says it. -->
        <p v-if="widgets.length === 0" class="empty-table-message">
          {{ $t('saved.none') }}
        </p>

        <article v-for="(widget, index) of widgets" :key="widget.id" class="widget-card">
          <header class="widget-head">
            <div>
              <h3>{{ widget.title }}</h3>
              <p class="widget-coverage">{{ coverageText(widget) }}</p>
            </div>
            <div class="widget-actions">
              <button type="button" class="btn btn-link btn-sm" :aria-disabled="index === 0"
                :title="$t('action.moveUp')" @click="move(index, -1)">
                <span class="icon-angle-up" aria-hidden="true"></span>
                <span class="sr-only">{{ $t('action.moveUp') }}</span>
              </button>
              <button type="button" class="btn btn-link btn-sm"
                :aria-disabled="index === widgets.length - 1"
                :title="$t('action.moveDown')" @click="move(index, 1)">
                <span class="icon-angle-down" aria-hidden="true"></span>
                <span class="sr-only">{{ $t('action.moveDown') }}</span>
              </button>
              <button type="button" class="btn btn-danger btn-sm" @click="remove(widget)">
                {{ $t('action.delete') }}
              </button>
            </div>
          </header>

          <p v-if="widget.usable === false" class="widget-stale">
            <span class="icon-exclamation-triangle" aria-hidden="true"></span>
            {{ widget.missingFilters && widget.missingFilters.length > 0
              ? $t('stale.filterGone')
              : $t('stale.fieldGone', { fields: (widget.missingFields || []).join(', ') }) }}
          </p>

          <p v-else-if="widget.tooManyCategories" class="widget-stale">
            <span class="icon-exclamation-triangle" aria-hidden="true"></span>
            {{ $t('stale.tooManyCategories', { count: widget.distinct }) }}
          </p>

          <template v-else>
            <chart-bars v-if="widget.rows && widget.rows.length > 0"
              :data="barData(widget)" :label-header="labelHeader(widget)"
              :show-share="widget.aggregation === 'count'"/>
            <p v-else class="empty-table-message">{{ $t('saved.noData') }}</p>

            <p v-if="widget.omitted" class="widget-omitted">
              {{ $t('saved.omitted', {
                shown: widget.rows.length,
                total: widget.rows.length + widget.omitted.groups,
              }) }}
            </p>
          </template>
        </article>
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import ChartBars from '../chart/bars.vue';
import Loading from '../loading.vue';
import Spinner from '../spinner.vue';

import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';

defineOptions({ name: 'SubmissionWidgets' });

const props = defineProps({
  projectId: { type: String, required: true },
  xmlFormId: { type: String, required: true }
});

const { t, n } = useI18n();
const { request, awaitingResponse } = useRequest();

const loading = ref(true);
const fields = ref([]);
const widgets = ref([]);
const draft = reactive({ title: '', column: '', groupBy: '', aggregation: 'count' });

const NUMERIC = new Set(['int', 'decimal']);
const columnOptions = computed(() => (draft.aggregation === 'count'
  ? fields.value
  : fields.value.filter(field => NUMERIC.has(field.type))));
const groupOptions = computed(() =>
  fields.value.filter(field => field.path !== draft.column));

const canCreate = computed(() => draft.title !== '' && draft.column !== '' &&
  (draft.aggregation === 'count' || draft.groupBy !== ''));

const loadWidgets = () => request({
  method: 'GET',
  url: apiPaths.widgets(props.projectId, { xmlFormId: props.xmlFormId, data: 'true' })
}).then(({ data }) => { widgets.value = data; });

Promise.all([
  request({
    method: 'GET',
    url: apiPaths.formFilterFields(props.projectId, props.xmlFormId)
  }).then(({ data }) => { fields.value = data; }),
  loadWidgets()
]).catch(noop).finally(() => { loading.value = false; });

const create = () => {
  if (!canCreate.value) return;
  request({
    method: 'POST',
    url: apiPaths.widgets(props.projectId),
    data: {
      xmlFormId: props.xmlFormId,
      title: draft.title,
      column: draft.column,
      groupBy: draft.aggregation === 'count' ? null : draft.groupBy,
      aggregation: draft.aggregation
    }
  })
    .then(() => {
      draft.title = '';
      draft.column = '';
      draft.groupBy = '';
      return loadWidgets();
    })
    .catch(noop);
};

const remove = (widget) => request({
  method: 'DELETE',
  url: apiPaths.widget(props.projectId, widget.id, { xmlFormId: props.xmlFormId })
}).then(loadWidgets).catch(noop);

// The whole order goes at once: patching one position at a time races with
// itself and can leave two charts sharing a place.
const move = (index, delta) => {
  const next = index + delta;
  if (next < 0 || next >= widgets.value.length) return;
  const order = widgets.value.map(widget => widget.id);
  [order[index], order[next]] = [order[next], order[index]];
  request({
    method: 'PATCH',
    url: apiPaths.widgetOrder(props.projectId),
    data: { xmlFormId: props.xmlFormId, order }
  }).then(loadWidgets).catch(noop);
};

const fieldName = (path) => fields.value.find(field => field.path === path)?.name ?? path;

const labelHeader = (widget) => fieldName(widget.groupBy ?? widget.column_path);

// bars.vue wants [{ key, label, count }]. An aggregated chart's magnitude is
// its value, not how many rows went into it, so that is what the bar measures
// -- and the row count still travels in the label so nobody reads an average
// of two as though it were an average of two hundred.
const barData = (widget) => widget.rows.map(row => (widget.aggregation === 'count'
  ? { key: row.key, label: row.key, count: row.count }
  : {
    key: row.key,
    label: t('saved.groupLabel', { group: row.key, rows: n(row.count, 'default') }),
    count: Math.round((row.value ?? 0) * 100) / 100
  }));

const coverageText = (widget) => {
  if (widget.coverage == null) return '';
  const { answered, total } = widget.coverage;
  const name = fieldName(widget.column_path);
  return widget.aggregation === 'count'
    ? t('saved.coverageCount', { name, answered: n(answered, 'default'), total: n(total, 'default') })
    : t('saved.coverageValue', {
      aggregation: t(`aggregation.${widget.aggregation}`).toLowerCase(),
      name, answered: n(answered, 'default'), total: n(total, 'default')
    });
};
</script>

<i18n lang="json5">
{
  "en": {
    "create": {
      "title": "Add a chart",
      "lead": "A chart you add here keeps its title and its place, and is here next time you open this Form."
    },
    "field": {
      "title": "Chart title",
      "titlePlaceholder": "For example, Households by district",
      "aggregation": "Show",
      "column": "Field",
      "number": "Number to work out",
      "groupBy": "For each",
      "choose": "Choose a field"
    },
    "aggregation": {
      "count": "How many Submissions",
      "mean": "Average",
      "median": "Median",
      "sum": "Total"
    },
    "saved": {
      "title": "Saved charts",
      "none": "No saved charts yet. A chart you add here keeps the title you give it and stays in the order you arrange, unlike the Summary tab's charts, which are worked out fresh each time and not kept.",
      "noData": "No Submissions have answered this field yet.",
      // {answered} of {total} Submissions answered the field being counted.
      "coverageCount": "{name} · answered by {answered} of {total} Submissions",
      "coverageValue": "{aggregation} of {name} · across {answered} of {total} Submissions",
      // A bar label on an aggregated chart: the group, and how many rows it rests on.
      "groupLabel": "{group} ({rows})",
      // Said rather than truncating silently.
      "omitted": "Showing the largest {shown} of {total}."
    },
    "stale": {
      "fieldGone": "The Form no longer has {fields}, so this chart cannot be drawn. Delete it or add one for a field the Form still has.",
      "filterGone": "The filtered dataset behind this chart cannot be applied since the Form was republished, so no rows are shown.",
      "tooManyCategories": "This field has {count} different answers, which would draw one bar per Submission rather than a chart. It is closer to free text than a category."
    },
    "action": {
      "add": "Add chart",
      "delete": "Delete",
      "moveUp": "Move up",
      "moveDown": "Move down"
    }
  }
}
</i18n>

<style lang="scss">
@import '../../assets/scss/variables';

#submission-widgets {
  padding-top: 20px;

  h2 {
    color: $color-text;
    font-size: 15px;
    font-weight: 600;
    margin: 0 0 4px;
  }

  .section-lead {
    color: $color-text-muted;
    font-size: 13px;
    margin: 0 0 14px;
    max-width: 78ch;
  }

  .widget-form {
    align-items: flex-end;
    background-color: #f8f8fb;             // gradient --gray-50
    border: 1px solid #e9e9f1;             // gradient --gray-150
    border-radius: 8px;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 34px;
    padding: 16px 18px;
  }

  .widget-field {
    display: flex;
    flex: 1 1 190px;
    flex-direction: column;
    font-weight: normal;
    gap: 4px;
    margin: 0;

    > span {
      color: $color-text-muted;
      font-size: 11px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .form-control { width: 100%; }
  }

  .widget-card {
    border: 1px solid #e9e9f1;             // gradient --gray-150
    border-radius: 6px;
    margin-bottom: 16px;
    padding: 16px 18px;
  }

  .widget-head {
    display: flex;
    gap: 16px;
    justify-content: space-between;
    margin-bottom: 12px;

    h3 { color: $color-text; font-size: 14px; font-weight: 600; margin: 0; }
  }

  // Beside the title, never in a footnote: a chart that hides how much data it
  // rests on gets quoted as though it rested on all of it.
  .widget-coverage {
    color: $color-text-muted;
    font-size: 12px;
    margin: 2px 0 0;
  }

  .widget-actions { display: flex; flex-shrink: 0; gap: 4px; }

  .widget-omitted {
    color: $color-text-muted;
    font-size: 12px;
    margin: 8px 0 0;
  }

  .widget-stale {
    background-color: #fdf6e7;             // gradient --warning-bg
    border-left: 3px solid #a86f14;        // gradient --warning-text
    border-radius: 4px;
    color: $color-text-secondary;
    font-size: 13px;
    margin: 0;
    max-width: 82ch;
    padding: 10px 12px;

    // Icon first so [class^="icon-"] matches and the glyph resolves.
    [class^="icon-"] { margin-right: 6px; }
  }
}
</style>
