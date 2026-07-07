<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

This file is part of Field Data, a distribution of ODK Central. It is subject to
the license terms in the LICENSE file found in the top-level directory of this
distribution and at https://www.apache.org/licenses/LICENSE-2.0.
-->
<template>
  <div id="field-data-media">
    <div class="table-actions-bar">
      <button type="button" class="btn btn-primary" :aria-disabled="uploading"
        @click="fileInput.click()">
        <span class="icon-upload"></span>{{ $t('action.upload') }}
        <spinner :state="uploading"/>
      </button>
      <input ref="fileInput" type="file" class="hidden-file-input"
        :aria-label="$t('action.upload')" @change="onFileChange">
    </div>

    <loading :state="media.initiallyLoading"/>
    <table v-show="media.dataExists" class="table">
      <thead>
        <tr>
          <th>{{ $t('header.name') }}</th>
          <th>{{ $t('header.type') }}</th>
          <th>{{ $t('header.size') }}</th>
          <th>{{ $t('header.uploaded') }}</th>
          <th class="actions-col">{{ $t('header.actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item of media.data" :key="item.id">
          <td>{{ item.name }}</td>
          <td>{{ item.type }}</td>
          <td>{{ item.size }}</td>
          <td><date-time :iso="item.createdAt"/></td>
          <td class="actions-col">
            <a :href="downloadUrl(item.id)" class="btn btn-default btn-xs">
              {{ $t('action.download') }}
            </a>
            <button type="button" class="btn btn-default btn-xs"
              :aria-disabled="awaitingResponse" @click="del(item)">
              {{ $t('action.delete') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-show="media.dataExists && media.data.length === 0" class="empty-table-message">
      {{ $t('emptyTable') }}
    </p>
  </div>
</template>

<script setup>
import { inject, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import DateTime from '../date-time.vue';
import Loading from '../loading.vue';
import Spinner from '../spinner.vue';

import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';
import { useRequestData } from '../../request-data';

defineOptions({
  name: 'FieldDataMedia'
});

const { t } = useI18n();
const alert = inject('alert');
const { request, awaitingResponse } = useRequest();
const { createResource } = useRequestData();
const media = createResource('fieldDataMedia');

const fetchData = () => media.request({ url: apiPaths.fieldDataMedia() }).catch(noop);
fetchData();

const downloadUrl = (id) => apiPaths.fieldDataMediaDownload(id);

const fileInput = ref(null);
const uploading = ref(false);
const onFileChange = (event) => {
  const file = event.target.files[0];
  if (file == null) return;
  const data = new FormData();
  data.append('file', file);
  uploading.value = true;
  request({ method: 'POST', url: apiPaths.fieldDataMedia(), data })
    .then(() => {
      alert.success(t('alert.uploaded', { name: file.name }));
      fetchData();
    })
    .catch(noop)
    .finally(() => {
      uploading.value = false;
      fileInput.value.value = '';
    });
};

const del = (item) => {
  // eslint-disable-next-line no-alert
  if (!window.confirm(t('confirmDelete', { name: item.name }))) return;
  request({ method: 'DELETE', url: apiPaths.fieldDataMediaItem(item.id) })
    .then(() => {
      alert.success(t('alert.deleted', { name: item.name }));
      fetchData();
    })
    .catch(noop);
};
</script>

<i18n lang="json5">
{
  "en": {
    "action": {
      "upload": "Upload file",
      "download": "Download",
      "delete": "Delete"
    },
    "header": {
      "name": "Name",
      "type": "Type",
      "size": "Size",
      "uploaded": "Uploaded",
      "actions": "Actions"
    },
    "emptyTable": "No media has been uploaded yet.",
    "confirmDelete": "Are you sure you want to delete “{name}”?",
    "alert": {
      "uploaded": "“{name}” has been uploaded.",
      "deleted": "“{name}” has been deleted."
    }
  }
}
</i18n>

<style lang="scss">
#field-data-media {
  .hidden-file-input { display: none; }
  .actions-col { text-align: right; white-space: nowrap; }
  .actions-col .btn + .btn { margin-left: 5px; }
  .icon-upload { margin-right: 6px; }
}
</style>
