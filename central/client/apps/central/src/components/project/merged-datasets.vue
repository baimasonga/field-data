<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

Several Forms pooled into one read-only table over the fields they genuinely
have in common.

What was left out is shown beside what went in, not behind a link. A merged
dataset that silently drops four fields is one that gets presented to a donor;
one that says "18 fields, 4 excluded, here is why" is one somebody can check
before they trust it.
-->
<template>
  <div id="project-merged-datasets">
    <loading :state="loading"/>

    <template v-if="!loading">
      <section class="merge-new">
        <h2>{{ $t('create.title') }}</h2>
        <p class="section-lead">{{ $t('create.lead') }}</p>

        <form class="merge-form" @submit.prevent="create">
          <label class="merge-field">
            <span>{{ $t('field.name') }}</span>
            <input v-model.trim="draft.name" class="form-control" type="text"
              maxlength="255" :placeholder="$t('field.namePlaceholder')">
          </label>

          <fieldset class="merge-forms">
            <legend>{{ $t('field.forms') }}</legend>
            <p class="field-help">{{ $t('field.formsHelp') }}</p>
            <label v-for="form of forms" :key="form.xmlFormId" class="merge-check">
              <input v-model="draft.xmlFormIds" type="checkbox" :value="form.xmlFormId">
              {{ form.name || form.xmlFormId }}
            </label>
            <p v-if="forms.length < 2" class="empty-table-message">
              {{ $t('field.needTwo') }}
            </p>
          </fieldset>

          <button type="submit" class="btn btn-primary"
            :aria-disabled="draft.xmlFormIds.length < 2 || draft.name === '' || awaitingResponse">
            {{ $t('action.create') }} <spinner :state="awaitingResponse"/>
          </button>
        </form>
      </section>

      <section class="merge-list">
        <h2>{{ $t('saved.title') }}</h2>
        <p v-if="datasets.length === 0" class="empty-table-message">
          {{ $t('saved.none') }}
        </p>

        <article v-for="dataset of datasets" :key="dataset.id" class="merge-card">
          <header class="merge-head">
            <div>
              <h3>{{ dataset.name }}</h3>
              <p class="merge-sub">
                {{ $tc('saved.formCount', dataset.formCount, { count: dataset.formCount }) }}
              </p>
            </div>
            <div class="merge-actions">
              <button type="button" class="btn btn-link btn-sm" @click="open(dataset)">
                {{ openId === dataset.id ? $t('action.close') : $t('action.inspect') }}
              </button>
              <button type="button" class="btn btn-danger btn-sm" @click="remove(dataset)">
                {{ $t('action.delete') }}
              </button>
            </div>
          </header>

          <div v-if="openId === dataset.id" class="merge-detail">
            <loading :state="detailLoading"/>

            <template v-if="!detailLoading && detail != null">
              <p class="merge-summary">
                {{ $t('detail.summary', {
                  merged: detail.fields.length,
                  excluded: detail.excluded.length
                }) }}
              </p>

              <!-- Beside the merged fields, never behind a link: a reader who
              does not know what was dropped will read the table as complete. -->
              <div v-if="detail.excluded.length > 0" class="merge-excluded">
                <h4>{{ $t('detail.excludedTitle') }}</h4>
                <ul>
                  <li v-for="row of detail.excluded" :key="row.path">
                    <code>{{ row.path }}</code> — {{ excludedReason(row) }}
                  </li>
                </ul>
              </div>

              <div v-if="detail.coding && detail.coding.length > 0" class="merge-coding">
                <span class="icon-exclamation-triangle" aria-hidden="true"></span>
                <div>
                  <p v-for="row of detail.coding" :key="row.path">
                    {{ $t('detail.coding', { path: row.path }) }}
                  </p>
                  <p class="merge-coding-note">{{ $t('detail.codingNote') }}</p>
                </div>
              </div>

              <div v-if="rows != null && rows.data.length > 0" class="table-responsive">
                <table class="table">
                  <thead>
                    <tr>
                      <th>{{ $t('detail.sourceForm') }}</th>
                      <th v-for="field of detail.fields" :key="field.path">{{ field.name }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row of rows.data" :key="row.instanceId">
                      <td class="source-form">{{ row.sourceForm }}</td>
                      <td v-for="field of detail.fields" :key="field.path">
                        {{ row[field.path] }}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p class="merge-total">
                  {{ $tc('detail.total', rows.total, { count: $n(rows.total, 'default') }) }}
                </p>
              </div>
              <p v-else-if="rows != null" class="empty-table-message">
                {{ detail.fields.length === 0 ? $t('detail.noFields') : $t('detail.noRows') }}
              </p>
            </template>
          </div>
        </article>
      </section>
    </template>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import Loading from '../loading.vue';
import Spinner from '../spinner.vue';

import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';

defineOptions({ name: 'ProjectMergedDatasets' });

const props = defineProps({
  projectId: { type: String, required: true }
});

const { t } = useI18n();
const { request, awaitingResponse } = useRequest();

const loading = ref(true);
const detailLoading = ref(false);
const forms = ref([]);
const datasets = ref([]);
const openId = ref(null);
const detail = ref(null);
const rows = ref(null);
const draft = reactive({ name: '', xmlFormIds: [] });

const loadDatasets = () => request({
  method: 'GET', url: apiPaths.mergedDatasets(props.projectId)
}).then(({ data }) => { datasets.value = data; });

Promise.all([
  request({ method: 'GET', url: apiPaths.forms(props.projectId) })
    // Only published Forms: the server merges published versions, so offering
    // a draft here would hand somebody a "not found" on create with nothing
    // explaining why.
    .then(({ data }) => { forms.value = data.filter(form => form.publishedAt != null); }),
  loadDatasets()
]).catch(noop).finally(() => { loading.value = false; });

const create = () => {
  if (draft.xmlFormIds.length < 2 || draft.name === '') return;
  request({
    method: 'POST',
    url: apiPaths.mergedDatasets(props.projectId),
    data: { name: draft.name, xmlFormIds: [...draft.xmlFormIds] }
  })
    .then(() => {
      draft.name = '';
      draft.xmlFormIds = [];
      return loadDatasets();
    })
    .catch(noop);
};

const remove = (dataset) => request({
  method: 'DELETE', url: apiPaths.mergedDataset(props.projectId, dataset.id)
})
  .then(() => {
    if (openId.value === dataset.id) openId.value = null;
    return loadDatasets();
  })
  .catch(noop);

const open = (dataset) => {
  if (openId.value === dataset.id) { openId.value = null; return; }
  openId.value = dataset.id;
  detail.value = null;
  rows.value = null;
  detailLoading.value = true;
  Promise.all([
    request({
      method: 'GET',
      url: apiPaths.mergedDataset(props.projectId, dataset.id, { coding: 'true' })
    }).then(({ data }) => { detail.value = data; }),
    request({
      method: 'GET',
      url: apiPaths.mergedDatasetData(props.projectId, dataset.id, { limit: 25 })
    }).then(({ data }) => { rows.value = data; })
  ]).catch(noop).finally(() => { detailLoading.value = false; });
};

// Each exclusion says what happened in terms of the forms, because "type
// differs" alone leaves somebody guessing which form to go and look at.
const excludedReason = (row) => {
  if (row.reason === 'missing-from-some-forms')
    return t('excluded.missing', { forms: (row.detail?.absent ?? []).join(', ') });
  if (row.reason === 'type-differs')
    return t('excluded.type', {
      types: Object.entries(row.detail ?? {}).map(([id, type]) => `${id}: ${type}`).join(', ')
    });
  if (row.reason === 'select-multiple-differs') return t('excluded.select');
  if (row.reason === 'binary-field') return t('excluded.binary');
  return t('excluded.unsafe');
};
</script>

<i18n lang="json5">
{
  "en": {
    "create": {
      "title": "Pool several Forms",
      "lead": "A merged dataset shows the fields the chosen Forms genuinely have in common, as one read-only table. It never accepts Submissions of its own."
    },
    "field": {
      "name": "Name",
      "namePlaceholder": "For example, All 2026 rounds",
      "forms": "Forms to pool",
      "formsHelp": "Pick two or more. Only fields every chosen Form declares the same way become columns.",
      "needTwo": "This Project has fewer than two published Forms to pool."
    },
    "saved": {
      "title": "Merged datasets",
      "none": "No merged datasets yet. Pool two or more Forms above to see how a whole round went rather than one Form at a time.",
      "formCount": "{count} Form | {count} Forms"
    },
    "detail": {
      // {merged} fields became columns; {excluded} did not.
      "summary": "{merged} fields merged · {excluded} excluded",
      "excludedTitle": "Left out, and why",
      "sourceForm": "From",
      "total": "{count} row | {count} rows",
      "noRows": "No Submissions yet in any of these Forms.",
      "noFields": "These Forms have no fields in common, so there is nothing to put in a table. What was excluded, and why, is listed above.",
      // Evidence of a coding clash gathered from submitted values.
      "coding": "{path} shares no values at all between these Forms.",
      "codingNote": "That often means one Form records names where another records codes, which would merge into a column of nonsense. It can also just mean the Forms covered different places. Worth checking before you trust this column."
    },
    "excluded": {
      "missing": "not asked in {forms}",
      "type": "declared as different types ({types})",
      "select": "takes several answers in one Form and one in another",
      "binary": "an attachment, which has no value to put in a column",
      "unsafe": "its name is not one this can safely read"
    },
    "action": {
      "create": "Create merged dataset",
      "inspect": "Inspect",
      "close": "Close",
      "delete": "Delete"
    }
  }
}
</i18n>

<style lang="scss">
@import '../../assets/scss/variables';

#project-merged-datasets {
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

  .merge-form {
    background-color: #f8f8fb;             // gradient --gray-50
    border: 1px solid #e9e9f1;             // gradient --gray-150
    border-radius: 8px;
    margin-bottom: 34px;
    padding: 16px 18px;
  }

  .merge-field {
    display: block;
    font-weight: normal;
    margin-bottom: 16px;
    max-width: 420px;

    > span {
      color: $color-text-muted;
      display: block;
      font-size: 11px;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
      text-transform: uppercase;
    }
  }

  .merge-forms {
    border: none;
    margin: 0 0 16px;
    padding: 0;

    legend {
      border: none;
      color: $color-text-muted;
      font-size: 11px;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
      text-transform: uppercase;
      width: auto;
    }
    .field-help { color: $color-text-muted; font-size: 12px; margin: 0 0 8px; }
  }

  .merge-check {
    display: block;
    font-weight: normal;
    margin-bottom: 4px;

    input { margin-right: 6px; }
  }

  .merge-card {
    border: 1px solid #e9e9f1;             // gradient --gray-150
    border-radius: 6px;
    margin-bottom: 16px;
    padding: 16px 18px;
  }

  .merge-head {
    display: flex;
    gap: 16px;
    justify-content: space-between;

    h3 { color: $color-text; font-size: 14px; font-weight: 600; margin: 0; }
  }
  .merge-sub { color: $color-text-muted; font-size: 12px; margin: 2px 0 0; }
  .merge-actions { display: flex; flex-shrink: 0; gap: 4px; }

  .merge-detail { margin-top: 14px; }

  .merge-summary {
    color: $color-text-secondary;
    font-size: 13px;
    margin: 0 0 10px;
  }

  .merge-excluded {
    background-color: #f1f1f6;             // gradient --gray-100
    border-radius: 6px;
    margin-bottom: 14px;
    max-width: 82ch;
    padding: 10px 12px;

    h4 {
      color: $color-text;
      font-size: 12px;
      font-weight: 600;
      margin: 0 0 6px;
    }
    ul { color: $color-text-secondary; font-size: 13px; margin: 0; padding-left: 20px; }
    code { background: none; font-size: 12px; padding: 0; }
  }

  .merge-coding {
    background-color: #fdf6e7;             // gradient --warning-bg
    border-left: 3px solid #a86f14;        // gradient --warning-text
    border-radius: 4px;
    color: $color-text-secondary;
    display: flex;
    font-size: 13px;
    gap: 8px;
    margin-bottom: 14px;
    max-width: 82ch;
    padding: 10px 12px;

    p { margin: 0 0 4px; }
    .merge-coding-note { color: $color-text-muted; font-size: 12px; margin: 0; }
  }

  .source-form {
    color: $color-text-muted;
    font-size: 12px;
    white-space: nowrap;
  }

  .merge-total { color: $color-text-muted; font-size: 12px; margin: 8px 0 0; }
}
</style>
