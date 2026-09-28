<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

Reusable Excel templates over Forms, filtered datasets, or merged datasets.
The template language is intentionally visible on the page: a spreadsheet
should remain understandable without a separate report designer.
-->
<template>
  <div id="project-xls-reports">
    <Loading :state="loading"/>

    <template v-if="!loading">
      <section class="report-guide">
        <div>
          <h2>{{ $t('guide.title') }}</h2>
          <p>{{ $t('guide.lead') }}</p>
        </div>
        <div class="guide-code">
          <code v-pre>{{report_name}}</code>
          <code v-pre>{{#submissions}}</code>
          <code v-pre>{{/data/district}}</code>
          <code v-pre>{{/submissions}}</code>
        </div>
      </section>

      <section v-if="canUpdate" class="template-new">
        <h2>{{ $t('create.title') }}</h2>
        <form class="template-form" @submit.prevent="upload">
          <label>
            <span>{{ $t('field.name') }}</span>
            <input v-model.trim="draft.name" class="form-control" type="text"
              maxlength="255" required :placeholder="$t('field.namePlaceholder')">
          </label>
          <label>
            <span>{{ $t('field.source') }}</span>
            <select v-model="draft.source" class="form-control" required>
              <option value="" disabled>{{ $t('field.chooseSource') }}</option>
              <optgroup v-if="sources.forms.length > 0" :label="$t('source.forms')">
                <option v-for="source of sources.forms" :key="`form-${source.id}`"
                  :value="`form:${source.id}`">{{ source.name }}</option>
              </optgroup>
              <optgroup v-if="sources.filtered.length > 0" :label="$t('source.filtered')">
                <option v-for="source of sources.filtered" :key="`filtered-${source.id}`"
                  :value="`filtered:${source.id}`">{{ source.name }}</option>
              </optgroup>
              <optgroup v-if="sources.merged.length > 0" :label="$t('source.merged')">
                <option v-for="source of sources.merged" :key="`merged-${source.id}`"
                  :value="`merged:${source.id}`">{{ source.name }}</option>
              </optgroup>
            </select>
          </label>
          <label>
            <span>{{ $t('field.file') }}</span>
            <input ref="fileInput" class="form-control" type="file" accept=".xlsx" required
              @change="selectFile">
          </label>
          <button type="submit" class="btn btn-primary"
            :aria-disabled="uploading || awaitingResponse || !readyToUpload">
            {{ $t('action.upload') }} <Spinner :state="uploading"/>
          </button>
        </form>
      </section>

      <section class="template-list">
        <header class="list-head">
          <div>
            <h2>{{ $t('saved.title') }}</h2>
            <p>{{ $t('saved.lead') }}</p>
          </div>
          <button type="button" class="btn btn-default btn-sm" @click="load">
            {{ $t('action.refresh') }}
          </button>
        </header>

        <p v-if="templates.length === 0" class="empty-table-message">
          {{ $t('saved.none') }}
        </p>

        <article v-for="template of templates" :key="template.id" class="template-card">
          <header>
            <div>
              <h3>{{ template.name }}</h3>
              <p>{{ template.sourceName }} · {{ sourceLabel(template.sourceType) }}</p>
            </div>
            <div class="template-actions">
              <a class="btn btn-default btn-sm"
                :href="apiPaths.xlsReportTemplateDownload(projectId, template.id)">
                {{ $t('action.template') }}
              </a>
              <button type="button" class="btn btn-primary btn-sm"
                :aria-disabled="hasActive(template) || awaitingResponse"
                @click="generate(template)">
                {{ hasActive(template) ? $t('action.queued') : $t('action.generate') }}
              </button>
              <button v-if="canUpdate" type="button" class="btn btn-danger btn-sm"
                @click="remove(template)">
                {{ $t('action.delete') }}
              </button>
            </div>
          </header>

          <div class="placeholder-summary">
            {{ $tc('saved.placeholders', template.placeholders.length,
              { count: template.placeholders.length }) }}
          </div>

          <div v-if="template.runs.length > 0" class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>{{ $t('header.status') }}</th>
                  <th>{{ $t('header.rows') }}</th>
                  <th>{{ $t('header.requested') }}</th>
                  <th>{{ $t('header.result') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="run of template.runs" :key="run.id">
                  <td><span :class="statusClass(run.status)">{{ run.status }}</span></td>
                  <td>{{ run.rowCount == null ? '—' : $n(run.rowCount, 'default') }}</td>
                  <td><DateTime :iso="run.createdAt"/></td>
                  <td>
                    <a v-if="run.downloadable" class="btn btn-link btn-sm"
                      :href="apiPaths.xlsReportRunDownload(projectId, template.id, run.id)">
                      {{ $t('action.download') }}
                    </a>
                    <button v-else-if="run.status === 'Pending' || run.status === 'Running'"
                      type="button" class="btn btn-link btn-sm"
                      @click="cancel(template, run)">
                      {{ $t('action.cancel') }}
                    </button>
                    <span v-else-if="run.error" class="run-error">{{ run.error }}</span>
                    <span v-else>—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="empty-table-message">{{ $t('saved.noRuns') }}</p>
        </article>
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed, inject, onUnmounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import DateTime from '../date-time.vue';
import Loading from '../loading.vue';
import Spinner from '../spinner.vue';

import useProject from '../../request-data/project';
import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';

defineOptions({ name: 'ProjectXlsReports' });

const props = defineProps({ projectId: { type: String, required: true } });
const { t } = useI18n();
const alert = inject('alert');
const { project } = useProject();
const { request, awaitingResponse } = useRequest();

const loading = ref(true);
const uploading = ref(false);
const templates = ref([]);
const sources = reactive({ forms: [], filtered: [], merged: [] });
const draft = reactive({ name: '', source: '', file: null });
const fileInput = ref(null);
const canUpdate = computed(() => project.dataExists && project.permits('project.update'));
const readyToUpload = computed(() => draft.name !== '' && draft.source !== '' && draft.file != null);

const hasActive = template => template.runs
  .some(run => run.status === 'Pending' || run.status === 'Running');
const anyActive = computed(() => templates.value.some(hasActive));

const load = () => request({ url: apiPaths.xlsReportTemplates(props.projectId) })
  .then(({ data }) => { templates.value = data; })
  .catch(noop);

Promise.all([
  request({ url: apiPaths.xlsReportSources(props.projectId) })
    .then(({ data }) => Object.assign(sources, data)),
  load()
]).catch(noop).finally(() => { loading.value = false; });

const poll = window.setInterval(() => { if (anyActive.value) load(); }, 5000);
onUnmounted(() => window.clearInterval(poll));

const selectFile = (event) => { [draft.file] = event.target.files; };

const upload = () => {
  if (!readyToUpload.value) return;
  const [sourceType, sourceId] = draft.source.split(':');
  const data = new FormData();
  data.append('name', draft.name);
  data.append('sourceType', sourceType);
  data.append('sourceId', sourceId);
  data.append('file', draft.file);
  uploading.value = true;
  request({ method: 'POST', url: apiPaths.xlsReportTemplates(props.projectId), data })
    .then(({ data: saved }) => {
      templates.value = saved;
      alert.success(t('alert.uploaded', { name: draft.name }));
      draft.name = '';
      draft.source = '';
      draft.file = null;
      fileInput.value.value = '';
    })
    .catch(noop)
    .finally(() => { uploading.value = false; });
};

const generate = template => request({
  method: 'POST', url: apiPaths.xlsReportRuns(props.projectId, template.id), data: {}
}).then(() => {
  alert.success(t('alert.queued', { name: template.name }));
  load();
}).catch(noop);

const cancel = (template, run) => request({
  method: 'POST',
  url: apiPaths.xlsReportRunCancel(props.projectId, template.id, run.id),
  data: {}
}).then(load).catch(noop);

const remove = (template) => {
  // eslint-disable-next-line no-alert
  if (!window.confirm(t('confirmDelete', { name: template.name }))) return;
  request({ method: 'DELETE', url: apiPaths.xlsReportTemplate(props.projectId, template.id) })
    .then(() => {
      alert.success(t('alert.deleted', { name: template.name }));
      load();
    })
    .catch(noop);
};

const sourceLabel = type => t(`source.${type}`);
const statusClass = status => ({
  'text-success': status === 'Success',
  'text-danger': status === 'Failed',
  'text-muted': status === 'Cancelled'
});
</script>

<i18n lang="json5">
{
  "en": {
    "guide": {
      "title": "Build the layout in Excel",
      "lead": "Put scalar placeholders anywhere. Put exactly one styled detail row between the submission markers; Field Data repeats it for every row while preserving the workbook layout. Field paths use their full /data/path names. Reports are limited to 10,000 rows."
    },
    "create": { "title": "Add report template" },
    "field": {
      "name": "Report name",
      "namePlaceholder": "For example, Monthly district report",
      "source": "Data source",
      "chooseSource": "Choose a data source",
      "file": "Excel template (.xlsx)"
    },
    "source": {
      "forms": "Forms",
      "filtered": "Filtered datasets",
      "merged": "Merged datasets",
      "form": "Form"
    },
    "saved": {
      "title": "Report templates",
      "lead": "Generate a fresh workbook whenever the underlying Submissions change.",
      "none": "No report templates yet. Create the layout in Excel, add placeholders, and upload it above.",
      "placeholders": "{count} placeholder | {count} placeholders",
      "noRuns": "This template has not generated a report yet."
    },
    "header": {
      "status": "Status",
      "rows": "Rows",
      "requested": "Requested",
      "result": "Result"
    },
    "action": {
      "upload": "Upload template",
      "refresh": "Refresh",
      "template": "Download template",
      "generate": "Generate report",
      "queued": "Generating…",
      "download": "Download report",
      "cancel": "Cancel",
      "delete": "Delete"
    },
    "alert": {
      "uploaded": "Report template “{name}” was uploaded.",
      "queued": "Report “{name}” was queued for background generation.",
      "deleted": "Report template “{name}” was deleted."
    },
    "confirmDelete": "Delete report template “{name}” and all of its generated reports?"
  }
}
</i18n>

<style lang="scss">
@import '../../assets/scss/variables';

#project-xls-reports {
  padding-top: 20px;

  h2 { font-size: 15px; font-weight: 600; margin: 0 0 4px; }
  h3 { font-size: 16px; font-weight: 600; margin: 0 0 3px; }

  .report-guide {
    align-items: center;
    background: linear-gradient(120deg, #f4f2ff, #f7fbff);
    border: 1px solid #e2def8;
    display: flex;
    gap: 24px;
    justify-content: space-between;
    margin-bottom: 28px;
    padding: 18px 20px;

    p { color: $color-text-muted; margin: 0; max-width: 75ch; }
  }

  .guide-code { display: grid; gap: 3px; min-width: 190px; }
  .guide-code code { background-color: #fff; padding: 3px 6px; }

  .template-new { margin-bottom: 34px; }
  .template-form {
    align-items: end;
    background-color: #f8f8fb;
    border: 1px solid #e9e9f1;
    display: grid;
    gap: 12px;
    grid-template-columns: 1.2fr 1.2fr 1.4fr auto;
    padding: 16px 18px;

    label { font-weight: normal; margin: 0; }
    label > span {
      color: $color-text-muted;
      display: block;
      font-size: 11px;
      letter-spacing: .05em;
      margin-bottom: 4px;
      text-transform: uppercase;
    }
  }

  .list-head, .template-card > header {
    align-items: flex-start;
    display: flex;
    justify-content: space-between;
  }
  .list-head { margin-bottom: 12px; }
  .list-head p, .template-card header p { color: $color-text-muted; margin: 0; }

  .template-card {
    border: 1px solid #e9e9f1;
    margin-bottom: 14px;
    padding: 16px 18px;
  }
  .template-actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .placeholder-summary { color: $color-text-muted; font-size: 12px; margin: 10px 0; }
  .table { background-color: transparent; margin-bottom: 0; }
  .run-error { color: $color-danger; font-size: 12px; }

  @media (max-width: 767px) {
    .report-guide { align-items: stretch; flex-direction: column; }
    .template-form { grid-template-columns: 1fr; }
    .template-card > header { gap: 10px; }
  }
}
</style>
