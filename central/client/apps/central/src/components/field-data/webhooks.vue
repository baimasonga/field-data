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
        <template v-for="hook of webhooks.data" :key="hook.id">
          <tr>
            <td>{{ hook.name }}</td>
            <td class="url-cell">{{ hook.url }}</td>
            <td>{{ (hook.events || []).join(', ') || $t('allEvents') }}</td>
            <td>{{ hook.lastStatus }}</td>
            <td>
              <input type="checkbox" :checked="hook.active"
                :aria-label="$t('header.active')"
                :aria-disabled="awaitingResponse" @change="toggle(hook)">
            </td>
            <td class="actions-col">
              <button type="button" class="btn btn-default btn-xs"
                @click="toggleDetails(hook)">
                {{ expandedId === hook.id ? $t('action.hide') : $t('action.details') }}
              </button>
              <button type="button" class="btn btn-default btn-xs"
                :aria-disabled="awaitingResponse" @click="del(hook)">
                {{ $t('action.delete') }}
              </button>
            </td>
          </tr>
          <tr v-if="expandedId === hook.id" class="details-row">
            <td colspan="6">
              <div class="webhook-secret">
                <span class="detail-label">{{ $t('detail.secret') }}</span>
                <code v-if="hook.secret">{{ hook.secret }}</code>
                <span v-else class="text-muted">{{ $t('detail.noSecret') }}</span>
                <p class="help-block">{{ $t('detail.secretHelp') }}</p>
              </div>

              <div class="detail-label">{{ $t('detail.deliveries') }}</div>
              <loading :state="loadingDeliveries"/>
              <table v-show="!loadingDeliveries" class="table deliveries-table">
                <thead>
                  <tr>
                    <th>{{ $t('detail.event') }}</th>
                    <th>{{ $t('detail.result') }}</th>
                    <th>{{ $t('detail.when') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="d of deliveries" :key="d.id">
                    <td>{{ d.event }}</td>
                    <td>
                      <span :class="d.success ? 'text-success' : 'text-danger'">
                        {{ d.success ? '✓' : '✗' }}
                      </span>
                      {{ d.statusCode != null ? d.statusCode : d.error }}
                    </td>
                    <td><date-time :iso="d.createdAt"/></td>
                  </tr>
                </tbody>
              </table>
              <p v-show="!loadingDeliveries && deliveries.length === 0" class="empty-table-message">
                {{ $t('detail.noDeliveries') }}
              </p>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    <p v-show="webhooks.dataExists && webhooks.data.length === 0" class="empty-table-message">
      {{ $t('emptyTable') }}
    </p>
  </div>
</template>

<script setup>
import { inject, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import DateTime from '../date-time.vue';
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

const expandedId = ref(null);
const deliveries = ref([]);
const loadingDeliveries = ref(false);

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
      if (expandedId.value === hook.id) expandedId.value = null;
      fetchData();
    })
    .catch(noop);
};

const toggleDetails = (hook) => {
  if (expandedId.value === hook.id) {
    expandedId.value = null;
    return;
  }
  expandedId.value = hook.id;
  deliveries.value = [];
  loadingDeliveries.value = true;
  request({ method: 'GET', url: apiPaths.fieldDataWebhookDeliveries(hook.id) })
    .then(({ data }) => {
      // Ignore a stale response if the user has since collapsed/switched rows.
      if (expandedId.value === hook.id) deliveries.value = data;
    })
    .catch(noop)
    .finally(() => { loadingDeliveries.value = false; });
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
      "delete": "Delete",
      "details": "Details",
      "hide": "Hide"
    },
    "header": {
      "name": "Name",
      "url": "URL",
      "events": "Events",
      "status": "Last status",
      "active": "Active",
      "actions": "Actions"
    },
    // Shown in the Events column when a webhook subscribes to every event.
    "allEvents": "All events",
    "emptyTable": "No webhooks have been configured yet.",
    "confirmDelete": "Are you sure you want to delete the webhook “{name}”?",
    "alert": {
      "created": "Webhook “{name}” has been created.",
      "deleted": "Webhook “{name}” has been deleted."
    },
    "detail": {
      "secret": "Signing secret",
      "noSecret": "None (deliveries are not signed)",
      "secretHelp": "Deliveries are signed with HMAC-SHA256 of the request body in the X-FieldData-Signature header. Use this secret to verify them.",
      "deliveries": "Recent deliveries",
      "event": "Event",
      "result": "Result",
      "when": "When",
      "noDeliveries": "No deliveries yet."
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
  .actions-col { text-align: right; white-space: nowrap; }
  .actions-col .btn + .btn { margin-left: 5px; }

  .details-row > td { background-color: #f7f7f7; }
  .detail-label { font-weight: bold; margin: 5px 0; }
  .webhook-secret {
    margin-bottom: 15px;
    code { word-break: break-all; }
  }
  .deliveries-table { margin-bottom: 5px; background-color: transparent; }
}
</style>
