<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

This file is part of Field Data, a distribution of ODK Central. It is subject to
the license terms in the LICENSE file found in the top-level directory of this
distribution and at https://www.apache.org/licenses/LICENSE-2.0.
-->
<template>
  <div id="field-data-webhooks">
    <form class="webhook-form" @submit.prevent="create">
      <input v-model.trim="newHook.name" class="form-control" type="text"
        :placeholder="$t('field.name')" :aria-label="$t('field.name')" required>
      <input v-model.trim="newHook.url" class="form-control" type="url"
        :placeholder="$t('field.url')" :aria-label="$t('field.url')" required>
      <input v-model.trim="newHook.events" class="form-control" type="text"
        :placeholder="$t('field.events')" :aria-label="$t('field.events')">
      <button type="submit" class="btn btn-primary" :aria-disabled="awaitingResponse">
        {{ $t('action.add') }} <spinner :state="awaitingResponse"/>
      </button>
    </form>

    <loading :state="webhooks.initiallyLoading"/>
    <table v-show="webhooks.dataExists" class="table">
      <thead>
        <tr>
          <th>{{ $t('header.name') }}</th>
          <th>{{ $t('header.url') }}</th>
          <th>{{ $t('header.events') }}</th>
          <th>{{ $t('header.status') }}</th>
          <th>{{ $t('header.active') }}</th>
          <th class="actions-col">{{ $t('header.actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="hook of webhooks.data" :key="hook.id">
          <td>{{ hook.name }}</td>
          <td class="url-cell">{{ hook.url }}</td>
          <td>{{ (hook.events || []).join(', ') }}</td>
          <td>{{ hook.lastStatus }}</td>
          <td>
            <input type="checkbox" :checked="hook.active"
              :aria-label="$t('header.active')"
              :aria-disabled="awaitingResponse" @change="toggle(hook)">
          </td>
          <td class="actions-col">
            <button type="button" class="btn btn-default btn-xs"
              :aria-disabled="awaitingResponse" @click="del(hook)">
              {{ $t('action.delete') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-show="webhooks.dataExists && webhooks.data.length === 0" class="empty-table-message">
      {{ $t('emptyTable') }}
    </p>
  </div>
</template>

<script setup>
import { inject, reactive } from 'vue';
import { useI18n } from 'vue-i18n';

import Loading from '../loading.vue';
import Spinner from '../spinner.vue';

import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';
import { useRequestData } from '../../request-data';

defineOptions({
  name: 'FieldDataWebhooks'
});

const { t } = useI18n();
const alert = inject('alert');
const { request, awaitingResponse } = useRequest();
const { createResource } = useRequestData();
const webhooks = createResource('fieldDataWebhooks');

const fetchData = () => webhooks.request({ url: apiPaths.fieldDataWebhooks() }).catch(noop);
fetchData();

const newHook = reactive({ name: '', url: '', events: '' });
const parseEvents = (str) => str.split(',').map(s => s.trim()).filter(s => s !== '');

const create = () => {
  request({
    method: 'POST',
    url: apiPaths.fieldDataWebhooks(),
    data: { name: newHook.name, url: newHook.url, events: parseEvents(newHook.events) }
  })
    .then(() => {
      alert.success(t('alert.created', { name: newHook.name }));
      newHook.name = '';
      newHook.url = '';
      newHook.events = '';
      fetchData();
    })
    .catch(noop);
};

const toggle = (hook) => {
  request({
    method: 'PATCH',
    url: apiPaths.fieldDataWebhook(hook.id),
    data: { active: !hook.active }
  })
    .then(fetchData)
    .catch(noop);
};

const del = (hook) => {
  // eslint-disable-next-line no-alert
  if (!window.confirm(t('confirmDelete', { name: hook.name }))) return;
  request({ method: 'DELETE', url: apiPaths.fieldDataWebhook(hook.id) })
    .then(() => {
      alert.success(t('alert.deleted', { name: hook.name }));
      fetchData();
    })
    .catch(noop);
};
</script>

<i18n lang="json5">
{
  "en": {
    "field": {
      "name": "Name",
      "url": "URL (https://…)",
      "events": "Events (comma-separated)"
    },
    "action": {
      "add": "Add webhook",
      "delete": "Delete"
    },
    "header": {
      "name": "Name",
      "url": "URL",
      "events": "Events",
      "status": "Last status",
      "active": "Active",
      "actions": "Actions"
    },
    "emptyTable": "No webhooks have been configured yet.",
    "confirmDelete": "Are you sure you want to delete the webhook “{name}”?",
    "alert": {
      "created": "Webhook “{name}” has been created.",
      "deleted": "Webhook “{name}” has been deleted."
    }
  }
}
</i18n>

<style lang="scss">
#field-data-webhooks {
  .webhook-form {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 20px;
    .form-control { width: auto; flex: 1 1 180px; }
  }
  .url-cell { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .actions-col { text-align: right; }
}
</style>
