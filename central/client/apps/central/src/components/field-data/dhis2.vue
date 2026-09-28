<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

This file is part of Field Data, a distribution of ODK Central. It is subject to
the license terms in the LICENSE file found in the top-level directory of this
distribution and at https://www.apache.org/licenses/LICENSE-2.0.

DHIS2 Mapping: saved mapping defaults for Field Data aggregate exports.
-->
<template>
  <div id="fd-dhis2">
    <header class="fd-head">
      <div>
        <h1>{{ $t('title') }}</h1>
        <p>{{ $t('subtitle') }}</p>
      </div>
      <div class="head-actions">
        <button type="button" class="fd-secondary" :aria-disabled="awaitingResponse" @click="preview">{{ $t('action.preview') }}</button>
        <button type="button" class="fd-primary" :aria-disabled="awaitingResponse" @click="save">{{ $t('action.save') }}</button>
      </div>
    </header>

    <loading :state="settings.initiallyLoading"/>

    <template v-if="settings.dataExists">
      <div class="fd-grid">
        <section class="fd-panel">
          <h2>{{ $t('section.dataset') }}</h2>
          <div class="field-grid">
            <label>
              {{ $t('field.dataSet') }}
              <input v-model.trim="form.dataSet" type="text" class="form-control">
            </label>
            <label>
              {{ $t('field.orgUnit') }}
              <input v-model.trim="form.orgUnit" type="text" class="form-control">
            </label>
            <label>
              {{ $t('field.categoryOptionCombo') }}
              <input v-model.trim="form.categoryOptionCombo" type="text" class="form-control">
            </label>
            <label>
              {{ $t('field.attributeOptionCombo') }}
              <input v-model.trim="form.attributeOptionCombo" type="text" class="form-control">
            </label>
          </div>
        </section>

        <section class="fd-panel">
          <h2>{{ $t('section.elements') }}</h2>
          <div class="field-grid">
            <label v-for="field of elementFields" :key="field.key">
              {{ field.label }}
              <input v-model.trim="form.dataElements[field.key]" type="text" class="form-control">
            </label>
          </div>
        </section>
      </div>

      <section class="fd-panel preview-panel">
        <div class="preview-head">
          <h2>{{ $t('section.preview') }}</h2>
          <div class="head-actions">
            <button type="button" class="fd-secondary" :aria-disabled="awaitingResponse || previewText === ''" @click="copyPreview">{{ $t('action.copy') }}</button>
            <button type="button" class="fd-secondary" :aria-disabled="awaitingResponse || previewText === ''" @click="downloadPreview">{{ $t('action.download') }}</button>
          </div>
        </div>
        <pre v-if="previewText !== ''">{{ previewText }}</pre>
        <p v-else class="empty">{{ $t('empty.preview') }}</p>
      </section>
    </template>
  </div>
</template>

<script setup>
import { inject, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import Loading from '../loading.vue';

import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';
import { useRequestData } from '../../request-data';

defineOptions({ name: 'FieldDataDhis2' });

const { t } = useI18n();
const alert = inject('alert');
const { request, awaitingResponse } = useRequest();
const { createResource } = useRequestData();
const settings = createResource('fieldDataDhis2Settings');
const previewText = ref('');

const form = reactive({
  dataSet: '',
  orgUnit: '',
  categoryOptionCombo: '',
  attributeOptionCombo: '',
  dataElements: {
    submissions: '',
    approved: '',
    rejected: '',
    inReview: '',
    activeForms: ''
  }
});

const elementFields = [
  { key: 'submissions', label: t('element.submissions') },
  { key: 'approved', label: t('element.approved') },
  { key: 'rejected', label: t('element.rejected') },
  { key: 'inReview', label: t('element.inReview') },
  { key: 'activeForms', label: t('element.activeForms') }
];

const load = () => settings.request({ url: apiPaths.fieldDataDhis2Settings() }).catch(noop);
load();

watch(() => settings.data, (data) => {
  if (data == null) return;
  form.dataSet = data.dataSet || '';
  form.orgUnit = data.orgUnit || '';
  form.categoryOptionCombo = data.categoryOptionCombo || '';
  form.attributeOptionCombo = data.attributeOptionCombo || '';
  form.dataElements = { ...form.dataElements, ...(data.dataElements || {}) };
}, { immediate: true });

const payload = () => ({
  dataSet: form.dataSet,
  orgUnit: form.orgUnit,
  categoryOptionCombo: form.categoryOptionCombo,
  attributeOptionCombo: form.attributeOptionCombo,
  dataElements: { ...form.dataElements }
});

const save = () => {
  request({ method: 'PATCH', url: apiPaths.fieldDataDhis2Settings(), data: payload() })
    .then(() => {
      alert.success(t('alert.saved'));
      load();
    })
    .catch(noop);
};

const preview = () => {
  request({ method: 'GET', url: apiPaths.fieldDataDhis2() })
    .then(({ data }) => { previewText.value = JSON.stringify(data, null, 2); })
    .catch(noop);
};

const copyPreview = () => {
  navigator.clipboard.writeText(previewText.value)
    .then(() => { alert.success(t('alert.copied')); })
    .catch(noop);
};

const downloadPreview = () => {
  const blob = new Blob([previewText.value], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'field-data-dhis2-preview.json';
  link.click();
  URL.revokeObjectURL(url);
};
</script>

<i18n lang="json5">
{
  "en": {
    "title": "DHIS2 Mapping",
    "subtitle": "Save DHIS2 IDs once so exports use the right data set, org unit, and data elements.",
    "section": {
      "dataset": "Data value set",
      "elements": "Aggregate data elements",
      "preview": "Preview export"
    },
    "field": {
      "dataSet": "Data set UID",
      "orgUnit": "Organisation unit UID",
      "categoryOptionCombo": "Category option combo UID",
      "attributeOptionCombo": "Attribute option combo UID"
    },
    "element": {
      "submissions": "Total submissions",
      "approved": "Approved submissions",
      "rejected": "Rejected submissions",
      "inReview": "Submissions in review",
      "activeForms": "Active forms"
    },
    "action": {
      "save": "Save Mapping",
      "preview": "Preview JSON",
      "copy": "Copy",
      "download": "Download"
    },
    "alert": {
      "saved": "DHIS2 mapping saved.",
      "copied": "DHIS2 JSON copied."
    },
    "empty": {
      "preview": "Preview the DHIS2 JSON after saving your mapping."
    }
  }
}
</i18n>

<style lang="scss">
#fd-dhis2 {
  --b: #e4ebed;
  --muted: #667a80;
  --teal: #0E7490;

  .fd-head {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px;
    h1 { font-size: 24px; font-weight: 750; margin: 0 0 4px; color: #143039; }
    p { margin: 0; color: var(--muted); font-size: 14px; }
  }

  .head-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
  .fd-primary, .fd-secondary {
    min-height: 38px; border-radius: 8px; padding: 0 14px; font-weight: 750; white-space: nowrap;
  }
  .fd-primary { border: 0; background: var(--teal); color: #fff; }
  .fd-secondary { border: 1px solid #d5e2e5; background: #fff; color: #33474d; }
  .fd-primary:hover, .fd-secondary:hover { filter: brightness(0.97); }

  .fd-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-bottom: 14px; }
  .fd-panel {
    background: #fff; border: 1px solid var(--b); border-radius: 8px; padding: 16px;
    box-shadow: 0 1px 2px rgba(20,48,57,0.04);
    h2 { margin: 0 0 12px; color: #143039; font-size: 16px; font-weight: 800; }
  }

  .field-grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
  label { color: #33474d; font-size: 13px; font-weight: 750; }
  .form-control { margin-top: 5px; height: 38px; border-color: #d5e2e5; box-shadow: none; }
  .form-control:focus { border-color: var(--teal); box-shadow: 0 0 0 2px rgba(14,116,144,0.12); }

  .preview-panel {
    .preview-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    pre {
      margin: 0; max-height: 460px; overflow: auto; background: #10232b; color: #edf7f9;
      border-radius: 8px; padding: 14px; font-size: 12px; line-height: 1.45;
    }
    .empty { margin: 0; color: var(--muted); font-size: 14px; padding: 20px 0 4px; }
  }

  @media (max-width: 900px) {
    .fd-grid { grid-template-columns: 1fr; }
  }
}
</style>
