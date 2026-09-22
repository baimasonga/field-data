<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.
-->
<template>
  <div id="submission-csv-import">
    <section aria-labelledby="csv-import-title">
      <h2 id="csv-import-title">{{ $t('title') }}</h2>
      <p>{{ $t('lead') }}</p>
      <div class="alert alert-info">
        <span class="icon-info-circle" aria-hidden="true"></span>
        {{ $t('guardrail') }}
      </div>

      <p>
        <a class="btn btn-default" :href="templateUrl">
          <span class="icon-download" aria-hidden="true"></span>
          {{ $t('downloadTemplate') }}
        </a>
      </p>

      <div class="form-group">
        <label for="submission-import-file">{{ $t('file') }}</label>
        <input id="submission-import-file" ref="fileInput" type="file"
          class="form-control" accept=".csv,text/csv" @change="selectFile">
        <p class="help-block">{{ $t('limits') }}</p>
      </div>

      <button type="button" class="btn btn-primary" :disabled="file == null || busy"
        @click="dryRun">
        {{ $t('validate') }} <spinner :state="validating"/>
      </button>

      <div v-if="result != null" class="validation-result" aria-live="polite">
        <div v-if="result.errors.length === 0" class="alert alert-success">
          {{ $tc('valid', result.validRows, { count: result.validRows }) }}
        </div>
        <template v-else>
          <div class="alert alert-danger">
            {{ $tc('invalid', result.errors.length, { count: result.errors.length }) }}
            {{ $t('allOrNothing') }}
          </div>
          <div class="table-responsive">
            <table class="table">
              <thead><tr><th>{{ $t('row') }}</th><th>{{ $t('field') }}</th><th>{{ $t('problem') }}</th></tr></thead>
              <tbody>
                <tr v-for="(error, index) of result.errors" :key="index">
                  <td>{{ error.row ?? '—' }}</td>
                  <td><code v-if="error.field != null">{{ error.field }}</code><span v-else>—</span></td>
                  <td>{{ error.message }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </div>

      <button v-if="canCommit" type="button" class="btn btn-primary commit"
        :disabled="committing" @click="commit">
        {{ $tc('import', result.validRows, { count: result.validRows }) }}
        <spinner :state="committing"/>
      </button>
    </section>
  </div>
</template>

<script setup>
import { computed, inject, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import Spinner from '../spinner.vue';
import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';

defineOptions({ name: 'SubmissionCsvImport' });
const props = defineProps({
  projectId: { type: String, required: true },
  xmlFormId: { type: String, required: true }
});

const { t } = useI18n();
const alert = inject('alert');
const { request } = useRequest();
const fileInput = ref(null);
const file = ref(null);
const result = ref(null);
const validating = ref(false);
const committing = ref(false);
const busy = computed(() => validating.value || committing.value);
const canCommit = computed(() => result.value != null && result.value.errors.length === 0 &&
  result.value.validRows > 0 && !validating.value);
const templateUrl = apiPaths.submissionCsvImportTemplate(props.projectId, props.xmlFormId);

const selectFile = (event) => {
  [file.value] = event.target.files;
  result.value = null;
};
const payload = () => {
  const data = new FormData();
  data.append('file', file.value);
  return data;
};
const dryRun = () => {
  if (file.value == null) return;
  validating.value = true;
  request({
    method: 'POST',
    url: apiPaths.submissionCsvImportDryRun(props.projectId, props.xmlFormId),
    data: payload()
  })
    .then(({ data }) => { result.value = data; })
    .catch(noop).finally(() => { validating.value = false; });
};
const commit = () => {
  if (!canCommit.value) return;
  committing.value = true;
  const data = payload();
  data.append('validationHash', result.value.hash);
  request({
    method: 'POST',
    url: apiPaths.submissionCsvImportCommit(props.projectId, props.xmlFormId),
    data
  })
    .then(({ data: response }) => {
      alert.success(t('complete', { count: response.created }));
      file.value = null;
      result.value = null;
      // Clearing the ref alone leaves the chosen filename sitting in the
      // control, which reads as though the file is still queued.
      if (fileInput.value != null) fileInput.value.value = '';
    }).catch(noop).finally(() => { committing.value = false; });
};
</script>

<style lang="scss">
#submission-csv-import {
  max-width: 850px;
  section { background: #fff; border: 1px solid #ddd; border-radius: 4px; padding: 24px; }
  .validation-result { margin-top: 24px; }
  .commit { margin-top: 8px; }
  code { color: inherit; }
}
</style>

<i18n lang="json5">
{
  "en": {
    "title": "Import Submissions from CSV",
    "lead": "Validate a CSV against this published Form, then import the same file.",
    "guardrail": "Import is available only while the Form has no Submissions. It never updates, replaces, or deletes data.",
    "downloadTemplate": "Download CSV Template",
    "file": "CSV file",
    "limits": "Maximum 500 rows and 2 MB. Repeat and attachment fields are not supported.",
    "validate": "Validate File",
    "valid": "One row is ready to import. | {count} rows are ready to import.",
    "invalid": "One validation error must be fixed. | {count} validation errors must be fixed.",
    "allOrNothing": "The whole file is imported or none of it is, so no rows are imported until every error is fixed.",
    "row": "Row",
    "field": "Field",
    "problem": "Problem",
    "import": "Import One Submission | Import {count} Submissions",
    "complete": "Imported {count} Submissions."
  }
}
</i18n>
