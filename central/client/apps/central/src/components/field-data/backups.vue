<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

This file is part of Field Data, a distribution of ODK Central. It is subject to
the license terms in the LICENSE file found in the top-level directory of this
distribution and at https://www.apache.org/licenses/LICENSE-2.0.
-->
<template>
  <div id="field-data-backups">
    <div class="table-actions-bar">
      <button type="button" class="btn btn-primary" :aria-disabled="awaitingResponse"
        @click="create">
        <span class="icon-database"></span>{{ $t('action.backupNow') }}
        <spinner :state="awaitingResponse"/>
      </button>
      <button type="button" class="btn btn-link" :aria-disabled="backups.awaitingResponse"
        @click="fetchData">
        {{ $t('action.refresh') }}
      </button>
    </div>

    <loading :state="backups.initiallyLoading"/>
    <table v-show="backups.dataExists" class="table">
      <thead>
        <tr>
          <th>{{ $t('header.date') }}</th>
          <th>{{ $t('header.type') }}</th>
          <th>{{ $t('header.size') }}</th>
          <th>{{ $t('header.status') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="backup of backups.data" :key="backup.id">
          <td><date-time :iso="backup.date"/></td>
          <td>{{ backup.type }}</td>
          <td>{{ backup.size }}</td>
          <td><span class="label" :class="`label-${backup.statusColor}`">{{ backup.status }}</span></td>
        </tr>
      </tbody>
    </table>
    <p v-show="backups.dataExists && backups.data.length === 0" class="empty-table-message">
      {{ $t('emptyTable') }}
    </p>
  </div>
</template>

<script setup>
import { inject } from 'vue';
import { useI18n } from 'vue-i18n';

import DateTime from '../date-time.vue';
import Loading from '../loading.vue';
import Spinner from '../spinner.vue';

import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';
import { useRequestData } from '../../request-data';

defineOptions({
  name: 'FieldDataBackups'
});

const { t } = useI18n();
const alert = inject('alert');
const { request, awaitingResponse } = useRequest();
const { createResource } = useRequestData();
const backups = createResource('fieldDataBackups');

const fetchData = () => backups.request({ url: apiPaths.fieldDataBackups() }).catch(noop);
fetchData();

const create = () => {
  request({ method: 'POST', url: apiPaths.fieldDataBackups(), data: {} })
    .then(() => {
      alert.success(t('alert.started'));
      fetchData();
    })
    .catch(noop);
};
</script>

<i18n lang="json5">
{
  "en": {
    "action": {
      "backupNow": "Back up now",
      "refresh": "Refresh"
    },
    "header": {
      "date": "Date",
      "type": "Type",
      "size": "Size",
      "status": "Status"
    },
    "emptyTable": "No backups have been created yet.",
    "alert": {
      // Shown after a manual backup is triggered; it runs in the background.
      "started": "Backup started. It will run in the background — refresh to see the result."
    }
  }
}
</i18n>

<style lang="scss">
#field-data-backups {
  .icon-database { margin-right: 6px; }
}
</style>
