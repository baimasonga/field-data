<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

Build and inspect named, reusable subsets of a Form's Submissions.
-->
<template>
  <div id="submission-filtered-datasets">
    <Loading :state="loading"/>

    <template v-if="!loading">
      <section class="dataset-editor" aria-labelledby="filtered-dataset-editor-title">
        <div class="section-head">
          <div>
            <h2 id="filtered-dataset-editor-title">
              {{ editingId == null ? $t('editor.newTitle') : $t('editor.editTitle') }}
            </h2>
            <p>{{ $t('editor.lead') }}</p>
          </div>
          <button v-if="editingId != null" type="button" class="btn btn-default"
            @click="resetEditor">
            {{ $t('action.cancel') }}
          </button>
        </div>

        <div class="form-group name-field">
          <label for="filtered-dataset-name">{{ $t('field.name') }}</label>
          <input id="filtered-dataset-name" v-model.trim="draft.name"
            class="form-control" maxlength="255" :placeholder="$t('field.namePlaceholder')">
        </div>

        <fieldset>
          <legend>{{ $t('field.columns') }}</legend>
          <p class="field-help">{{ $t('field.columnsHelp') }}</p>
          <div class="column-picker">
            <label v-for="field of fields" :key="field.path" class="column-option">
              <input v-model="draft.columns" type="checkbox" :value="field.path">
              <span>{{ field.name }}</span>
              <code>{{ field.path }}</code>
            </label>
          </div>
        </fieldset>

        <fieldset class="filters">
          <div class="filters-head">
            <legend>{{ $t('field.filters') }}</legend>
            <button type="button" class="btn btn-default btn-sm" @click="addFilter">
              <span class="icon-plus-circle" aria-hidden="true"></span>
              {{ $t('action.addFilter') }}
            </button>
          </div>
          <p v-if="draft.query.length === 0" class="field-help">{{ $t('field.noFilters') }}</p>
          <div v-for="(filter, index) of draft.query" :key="filter.key" class="filter-row">
            <select v-if="index > 0" v-model="filter.condition" class="form-control condition"
              :aria-label="$t('field.condition')">
              <option value="AND">{{ $t('condition.and') }}</option>
              <option value="OR">{{ $t('condition.or') }}</option>
            </select>
            <span v-else class="condition first">{{ $t('condition.where') }}</span>
            <select v-model="filter.column" class="form-control"
              :aria-label="$t('field.filterColumn')">
              <option value="" disabled>{{ $t('field.chooseField') }}</option>
              <option v-for="field of fields" :key="field.path" :value="field.path">
                {{ field.name }} — {{ field.path }}
              </option>
            </select>
            <select v-model="filter.filter" class="form-control operator"
              :aria-label="$t('field.operator')">
              <option v-for="operator of operators" :key="operator" :value="operator">
                {{ operator }}
              </option>
            </select>
            <input v-model="filter.value" class="form-control value" type="text"
              :aria-label="$t('field.value')" :placeholder="$t('field.value')">
            <button type="button" class="btn btn-danger btn-sm remove-filter"
              :aria-label="$t('action.removeFilter')" @click="removeFilter(index)">
              <span class="icon-trash" aria-hidden="true"></span>
            </button>
          </div>
        </fieldset>

        <div class="editor-footer">
          <div class="match-count" role="status" aria-live="polite">
            <spinner :state="previewing"/>
            <template v-if="preview != null">
              <strong>{{ $n(preview.matching, 'default') }}</strong>
              {{ $tc('preview.matching', preview.matching) }}
              <span v-if="preview.excludedMalformed > 0" class="malformed">
                {{ $t('preview.malformed', { count: preview.excludedMalformed }) }}
              </span>
            </template>
            <span v-else>{{ $t('preview.chooseColumns') }}</span>
          </div>
          <button type="button" class="btn btn-primary" :aria-disabled="!canSave"
            @click="save">
            {{ editingId == null ? $t('action.save') : $t('action.update') }}
            <spinner :state="saving"/>
          </button>
        </div>
      </section>

      <section class="saved" aria-labelledby="filtered-dataset-saved-title">
        <h2 id="filtered-dataset-saved-title">{{ $t('saved.title') }}</h2>
        <p v-if="datasets.length === 0" class="empty-table-message">{{ $t('saved.empty') }}</p>
        <article v-for="dataset of datasets" :key="dataset.id" class="dataset-card">
          <div class="dataset-card-head">
            <div>
              <h3>{{ dataset.name }}</h3>
              <p>
                {{ $tc('saved.columns', dataset.columns.length, { count: dataset.columns.length }) }} ·
                {{ $tc('saved.filters', dataset.filterCount, { count: dataset.filterCount }) }}
              </p>
            </div>
            <div class="dataset-actions">
              <button type="button" class="btn btn-default btn-sm" @click="showRows(dataset)">
                {{ $t('action.previewRows') }}
              </button>
              <button type="button" class="btn btn-default btn-sm" @click="edit(dataset)">
                {{ $t('action.edit') }}
              </button>
              <button type="button" class="btn btn-danger btn-sm" @click="remove(dataset)">
                {{ $t('action.delete') }}
              </button>
            </div>
          </div>

          <div v-if="openDatasetId === dataset.id" class="data-preview">
            <Loading :state="rowsLoading"/>

            <!-- A dataset outlives the form it was built on. Saying so beats an
            empty table, and the filter case has to be distinguished from the
            column case because only one of them is withholding rows. -->
            <p v-if="!rowsLoading && rows != null && rows.usable === false"
              class="dataset-stale">
              <span class="icon-exclamation-triangle" aria-hidden="true"></span>
              {{ rows.missingFilters.length > 0
                ? $t('stale.filterGone', { fields: rows.missingFilters.join(', ') })
                : $t('stale.allGone') }}
            </p>
            <p v-else-if="!rowsLoading && rows != null && rows.missingColumns.length > 0"
              class="dataset-stale">
              <span class="icon-exclamation-triangle" aria-hidden="true"></span>
              {{ $t('stale.columnsGone', { fields: rows.missingColumns.join(', ') }) }}
            </p>

            <p v-if="!rowsLoading && rows != null && rows.usable !== false
              && rows.data.length === 0" class="empty-table-message">
              {{ $t('saved.noMatches') }}
            </p>
            <div v-else-if="!rowsLoading && rows != null && rows.usable !== false"
              class="table-responsive">
              <table class="table">
                <thead><tr><th v-for="column of rows.columns" :key="column">{{ column }}</th></tr></thead>
                <tbody>
                  <tr v-for="(row, index) of rows.data" :key="index">
                    <td v-for="column of rows.columns" :key="column">{{ row[column] }}</td>
                  </tr>
                </tbody>
              </table>
              <p class="preview-total">
                {{ $tc('saved.totalMatches', rows.total, { count: $n(rows.total, 'default') }) }}
              </p>
            </div>
          </div>
        </article>
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed, inject, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import Loading from '../loading.vue';
import Spinner from '../spinner.vue';

import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';

defineOptions({ name: 'SubmissionFilteredDatasets' });

const props = defineProps({
  projectId: { type: String, required: true },
  xmlFormId: { type: String, required: true }
});

const { t } = useI18n();
const alert = inject('alert');
const { request } = useRequest();
const fields = ref([]);
const datasets = ref([]);
const loading = ref(true);
const previewing = ref(false);
const saving = ref(false);
const rowsLoading = ref(false);
const preview = ref(null);
const rows = ref(null);
const openDatasetId = ref(null);
const editingId = ref(null);
let filterKey = 0;
let previewTimer;

const blankDraft = () => ({ name: '', columns: [], query: [] });
const draft = reactive(blankDraft());
const operators = ['=', '<>', '>', '<', '>=', '<='];
const validQuery = computed(() => draft.query.every(filter =>
  filter.column !== '' && operators.includes(filter.filter)));
const canSave = computed(() => !saving.value && draft.name !== '' &&
  draft.columns.length > 0 && validQuery.value);

const payload = () => ({
  name: draft.name,
  sourceProjectId: Number(props.projectId),
  xmlFormId: props.xmlFormId,
  columns: [...draft.columns],
  query: draft.query.map(({ column, filter, value, condition }) => ({
    column, filter, value, condition
  }))
});

const load = () => Promise.all([
  request({ method: 'GET', url: apiPaths.formFilterFields(props.projectId, props.xmlFormId) })
    .then(({ data }) => { fields.value = data; }),
  request({
    method: 'GET',
    url: apiPaths.filteredDatasets(props.projectId, {
      sourceProjectId: props.projectId, xmlFormId: props.xmlFormId
    })
  }).then(({ data }) => { datasets.value = data; })
]).catch(noop).finally(() => { loading.value = false; });
load();

const resetEditor = () => {
  Object.assign(draft, blankDraft());
  editingId.value = null;
  preview.value = null;
};

const addFilter = () => {
  draft.query.push({ key: filterKey += 1, column: '', filter: '=', value: '', condition: 'AND' });
};
const removeFilter = (index) => { draft.query.splice(index, 1); };

const refreshPreview = () => {
  clearTimeout(previewTimer);
  if (draft.columns.length === 0 || !validQuery.value) {
    preview.value = null;
    return;
  }
  previewTimer = setTimeout(() => {
    previewing.value = true;
    request({
      method: 'POST',
      url: apiPaths.filteredDatasetPreview(props.projectId, props.xmlFormId),
      data: payload()
    }).then(({ data }) => { preview.value = data; })
      .catch(() => { preview.value = null; })
      .finally(() => { previewing.value = false; });
  }, 400);
};
watch(() => [draft.columns, draft.query], refreshPreview, { deep: true });

const save = () => {
  if (!canSave.value) return;
  saving.value = true;
  const config = editingId.value == null
    ? { method: 'POST', url: apiPaths.filteredDatasets(props.projectId), data: payload() }
    : { method: 'PATCH', url: apiPaths.filteredDataset(props.projectId, editingId.value), data: payload() };
  request(config).then(() => {
    alert.success(t(editingId.value == null ? 'alert.created' : 'alert.updated'));
    resetEditor();
    return load();
  }).catch(noop).finally(() => { saving.value = false; });
};

const edit = (dataset) => {
  request({
    method: 'GET', url: apiPaths.filteredDatasetDefinition(props.projectId, dataset.id)
  }).then(({ data }) => {
    editingId.value = data.id;
    draft.name = data.name;
    draft.columns = [...data.columns];
    draft.query = data.query.map((filter) => {
      filterKey += 1;
      return { ...filter, key: filterKey };
    });
    document.getElementById('filtered-dataset-editor-title')?.scrollIntoView({ behavior: 'smooth' });
  }).catch(noop);
};

const remove = (dataset) => {
  // eslint-disable-next-line no-alert
  if (!window.confirm(t('confirmDelete', { name: dataset.name }))) return;
  request({ method: 'DELETE', url: apiPaths.filteredDataset(props.projectId, dataset.id) })
    .then(() => {
      alert.success(t('alert.deleted'));
      if (editingId.value === dataset.id) resetEditor();
      return load();
    }).catch(noop);
};

const showRows = (dataset) => {
  if (openDatasetId.value === dataset.id) {
    openDatasetId.value = null;
    rows.value = null;
    return;
  }
  openDatasetId.value = dataset.id;
  rows.value = null;
  rowsLoading.value = true;
  request({
    method: 'GET', url: apiPaths.filteredDatasetData(props.projectId, dataset.id, { limit: 10 })
  }).then(({ data }) => { rows.value = data; })
    .catch(noop).finally(() => { rowsLoading.value = false; });
};
</script>

<i18n lang="json5">
{
  "en": {
    "editor": {
      "newTitle": "Create a filtered dataset",
      "editTitle": "Edit filtered dataset",
      "lead": "Choose exactly which answers readers can see, then narrow the rows with simple conditions."
    },
    "field": {
      "name": "Dataset name",
      "namePlaceholder": "For example, Bombali household visits",
      "columns": "Visible fields",
      "columnsHelp": "Only checked fields appear in the dataset. A filter field does not become visible unless you also check it.",
      "filters": "Row filters",
      "noFilters": "No filters: every Submission will match.",
      "condition": "Condition",
      "filterColumn": "Filter field",
      "chooseField": "Choose a field",
      "operator": "Operator",
      "value": "Value"
    },
    "condition": { "where": "Where", "and": "and", "or": "or" },
    "action": {
      "addFilter": "Add filter", "removeFilter": "Remove filter", "save": "Save dataset",
      "update": "Save changes", "cancel": "Cancel edit", "previewRows": "Preview rows",
      "edit": "Edit", "delete": "Delete"
    },
    "preview": {
      "matching": "matching Submission | matching Submissions",
      "chooseColumns": "Choose at least one visible field to see a live row count.",
      "malformed": "{count} malformed XML row excluded"
    },
    "saved": {
      "title": "Saved filtered datasets", "empty": "No filtered datasets have been saved for this Form.",
      "columns": "{count} visible field | {count} visible fields",
      "filters": "{count} filter | {count} filters", "noMatches": "No rows match this dataset.",
      "totalMatches": "{count} matching row | {count} matching rows"
    },
    "stale": {
      // Shown when the source Form was republished without a field this
      // dataset filters on. No rows are served, because the filter was what
      // kept them narrowed.
      "filterGone": "This dataset filters on {fields}, which the Form no longer has. No rows are shown, because showing them without that filter could reveal rows the dataset was set up to hide. Edit the dataset to choose a new filter.",
      "allGone": "The Form no longer has any of the fields this dataset shows. Edit the dataset to choose fields it still has.",
      "columnsGone": "The Form no longer has {fields}, so that column is not shown. The rest of the dataset is unaffected."
    },
    "confirmDelete": "Delete “{name}”? This cannot be undone.",
    "alert": { "created": "Filtered dataset created.", "updated": "Filtered dataset updated.", "deleted": "Filtered dataset deleted." }
  }
}
</i18n>

<style lang="scss">
@import '../../assets/scss/variables';

#submission-filtered-datasets {
  padding: 20px 0 40px;

  h2 { margin-top: 0; }
  .dataset-editor, .dataset-card {
    background: #fff;
    border: 1px solid #e0e0e8;
    border-radius: 8px;
  }
  .dataset-editor { padding: 24px; }
  .section-head, .dataset-card-head, .editor-footer, .filters-head {
    align-items: flex-start;
    display: flex;
    gap: 16px;
    justify-content: space-between;
  }
  .section-head p, .dataset-card p { color: $color-text-muted; margin-bottom: 0; }
  .name-field { max-width: 520px; }
  fieldset { border: 0; margin: 24px 0 0; min-width: 0; padding: 0; }
  legend { border: 0; font-size: 16px; font-weight: 600; margin-bottom: 0; }
  .field-help { color: $color-text-muted; margin: 5px 0 12px; }
  .column-picker {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  }
  .column-option {
    align-items: flex-start;
    border: 1px solid #e9e9f1;
    border-radius: 6px;
    display: grid;
    gap: 2px 8px;
    grid-template-columns: auto 1fr;
    padding: 10px;
  }
  .column-option input { grid-row: 1 / 3; margin-top: 3px; }
  .column-option code { color: $color-text-muted; font-size: 11px; overflow-wrap: anywhere; }
  .filter-row {
    align-items: center;
    display: grid;
    gap: 8px;
    grid-template-columns: 72px minmax(180px, 2fr) 76px minmax(130px, 1fr) auto;
    margin-top: 8px;
  }
  .condition.first { color: $color-text-muted; padding-left: 12px; }
  .editor-footer {
    align-items: center;
    border-top: 1px solid #e9e9f1;
    margin-top: 24px;
    padding-top: 18px;
  }
  .match-count { color: $color-text-muted; }
  .match-count strong { color: $color-text; font-size: 20px; margin-right: 3px; }
  .malformed { display: block; font-size: 12px; }
  .saved { margin-top: 32px; }
  .dataset-card { margin-top: 12px; padding: 18px; }
  .dataset-card h3 { margin: 0; }
  .dataset-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .data-preview { border-top: 1px solid #e9e9f1; margin-top: 16px; padding-top: 16px; }
  .dataset-stale {
    background-color: #fdf6e7;             // gradient --warning-bg
    border-left: 3px solid #a86f14;        // gradient --warning-text
    border-radius: 4px;
    color: $color-text-secondary;
    font-size: 13px;
    margin-bottom: 12px;
    max-width: 82ch;
    padding: 10px 12px;

    // Icon first so the [class^="icon-"] rule matches and the glyph resolves.
    [class^="icon-"] { margin-right: 6px; }
  }

  .preview-total { color: $color-text-muted; font-size: 12px; }

  @media (max-width: 600px) {
    .dataset-editor { padding: 16px; }
    .section-head, .dataset-card-head, .editor-footer { align-items: stretch; flex-direction: column; }
    .filter-row { grid-template-columns: 1fr 80px auto; }
    .filter-row .condition { grid-column: 1 / 4; }
    .filter-row > select:nth-of-type(2) { grid-column: 1 / 4; }
    .filter-row .value { grid-column: 1 / 3; }
    .dataset-actions .btn { flex: 1 1 auto; }
  }
}
</style>
