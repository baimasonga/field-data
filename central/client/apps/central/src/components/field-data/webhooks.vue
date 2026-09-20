<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

This file is part of Field Data, a distribution of ODK Central. It is subject to
the license terms in the LICENSE file found in the top-level directory of this
distribution and at https://www.apache.org/licenses/LICENSE-2.0.
-->
<template>
  <div id="field-data-webhooks">
    <p class="lead">{{ $t('intro') }}</p>
    <form class="webhook-form" @submit.prevent="create">
      <input v-model.trim="newHook.name" class="form-control" type="text"
        :placeholder="$t('field.name')" :aria-label="$t('field.name')" required>
      <input v-if="!managedTarget" v-model.trim="newHook.url" class="form-control" type="url"
        :placeholder="$t('field.url')" :aria-label="$t('field.url')" required>
      <input v-if="!managedTarget" v-model.trim="newHook.events" class="form-control" type="text"
        :placeholder="$t('field.events')" :aria-label="$t('field.events')">
      <select v-model="newHook.target" class="form-control"
        :aria-label="$t('field.target')">
        <option v-for="target of targets" :key="target.name" :value="target.name">
          {{ target.label }}
        </option>
      </select>
      <select v-if="requiresForm" v-model="newHook.formKey" class="form-control"
        :aria-label="$t('field.form')" required>
        <option value="" disabled>{{ $t('field.form') }}</option>
        <option v-for="form of forms" :key="formKey(form)" :value="formKey(form)">
          {{ form.projectName }} · {{ form.formName }}
        </option>
      </select>
      <!-- The fields a target needs come from the same schema the server
      validates against, so the form and the validator cannot drift apart. -->
      <template v-for="setting of targetConfig" :key="setting.key">
        <label v-if="setting.type === 'boolean'" class="checkbox config-checkbox">
          <input v-model="newHook.config[setting.key]" type="checkbox">
          {{ setting.describe }}
        </label>
        <input v-else v-model.trim="newHook.config[setting.key]" class="form-control"
          :type="setting.secret ? 'password' : 'text'"
          :placeholder="setting.describe" :aria-label="setting.describe"
          :required="setting.required">
      </template>
      <button type="submit" class="btn btn-primary" :aria-disabled="awaitingResponse">
        {{ $t('action.add') }} <spinner :state="awaitingResponse"/>
      </button>
      <p v-if="newHook.target === 'google-sheets'" class="help-block google-help">
        {{ $t('googleHelp') }}
      </p>
    </form>

    <div v-if="latestSecret" class="alert alert-warning webhook-new-secret" role="alert">
      <strong>{{ $t('detail.saveSecret') }}</strong>
      <code>{{ latestSecret }}</code>
      <button type="button" class="btn btn-default btn-xs" @click="latestSecret = ''">
        {{ $t('action.dismiss') }}
      </button>
    </div>

    <loading :state="webhooks.initiallyLoading"/>
    <table v-show="webhooks.dataExists" class="table">
      <thead>
        <tr>
          <th>{{ $t('header.name') }}</th>
          <th>{{ $t('header.url') }}</th>
          <th>{{ $t('header.events') }}</th>
          <th>{{ $t('header.target') }}</th>
          <th>{{ $t('header.status') }}</th>
          <th>{{ $t('header.active') }}</th>
          <th class="actions-col">{{ $t('header.actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="hook of webhooks.data" :key="hook.id">
          <tr>
            <td>{{ hook.name }}</td>
            <td class="url-cell">
              {{ hook.target === 'google-sheets' ? $t('managed') : hook.url }}
            </td>
            <td>{{ (hook.events || []).join(', ') || $t('allEvents') }}</td>
            <td class="target-cell">
              {{ targetLabel(hook.target) }}
              <span v-if="hook.xmlFormId" class="scoped">{{ hook.xmlFormId }}</span>
              <span v-else class="scoped">{{ $t('everyForm') }}</span>
            </td>
            <td :class="{ 'status-failed': failing(hook.lastStatus) }">
              {{ hook.lastStatus }}
            </td>
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
            <td colspan="7">
              <div v-if="hook.target !== 'google-sheets'" class="webhook-secret">
                <span class="detail-label">{{ $t('detail.secret') }}</span>
                <span>{{ hook.hasSecret ? $t('detail.configured') : $t('detail.noSecret') }}</span>
                <button type="button" class="btn btn-default btn-xs"
                  :aria-disabled="awaitingResponse" @click="rotateSecret(hook)">
                  {{ $t('action.rotateSecret') }}
                </button>
                <p class="help-block">{{ $t('detail.secretHelp') }}</p>
              </div>

              <section v-else class="sheet-recovery">
                <div v-if="needsReauthorization(hook)" class="alert alert-danger" role="alert">
                  {{ $t('sheet.reauthorization') }}
                </div>
                <div class="sheet-actions">
                  <button type="button" class="btn btn-primary btn-xs"
                    :aria-disabled="awaitingResponse" @click="startSync(hook)">
                    {{ $t('action.syncNow') }}
                  </button>
                  <button type="button" class="btn btn-default btn-xs"
                    @click="loadSyncs(hook)">
                    {{ $t('action.refresh') }}
                  </button>
                  <button type="button" class="btn btn-default btn-xs"
                    @click="showCredentials = !showCredentials">
                    {{ $t('action.replaceCredentials') }}
                  </button>
                </div>

                <form v-if="showCredentials" class="credential-form"
                  @submit.prevent="replaceCredentials(hook)">
                  <input v-model.trim="credentials.clientSecret" class="form-control"
                    type="password" :placeholder="$t('field.clientSecret')"
                    :aria-label="$t('field.clientSecret')" required>
                  <input v-model.trim="credentials.refreshToken" class="form-control"
                    type="password" :placeholder="$t('field.refreshToken')"
                    :aria-label="$t('field.refreshToken')" required>
                  <button type="submit" class="btn btn-primary btn-xs"
                    :aria-disabled="awaitingResponse">
                    {{ $t('action.saveCredentials') }}
                  </button>
                </form>

                <div class="detail-label">{{ $t('sheet.history') }}</div>
                <Loading :state="loadingSyncs"/>
                <table v-show="!loadingSyncs && syncs.length > 0" class="table sync-table">
                  <thead>
                    <tr>
                      <th>{{ $t('sheet.status') }}</th>
                      <th>{{ $t('sheet.progress') }}</th>
                      <th>{{ $t('sheet.results') }}</th>
                      <th>{{ $t('header.actions') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="sync of syncs" :key="sync.id">
                      <td>{{ sync.status }}</td>
                      <td>{{ sync.processed }} / {{ sync.total }}</td>
                      <td>{{ $t('sheet.counts', sync) }}</td>
                      <td>
                        <button v-if="sync.status === 'Partial' || sync.status === 'Failed'"
                          type="button" class="btn btn-default btn-xs"
                          @click="retrySync(hook, sync)">
                          {{ $t('action.retryFailed') }}
                        </button>
                        <button v-if="sync.status === 'Pending' || sync.status === 'Running'"
                          type="button" class="btn btn-default btn-xs"
                          @click="cancelSync(hook, sync)">
                          {{ $t('action.cancel') }}
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p v-show="!loadingSyncs && syncs.length === 0" class="empty-table-message">
                  {{ $t('sheet.noHistory') }}
                </p>
              </section>

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
import { computed, inject, reactive, ref } from 'vue';
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

// A webhook whose last delivery failed looked exactly like one that succeeded:
// the status code was there, in the same colour, for anyone who happened to
// know which numbers are bad news.
const failing = (status) => {
  if (typeof status === 'string') return status.startsWith('Failed');
  const code = Number(status);
  return Number.isFinite(code) && (code < 200 || code >= 300);
};

const newHook = reactive({
  name: '', url: '', events: '', target: 'json', formKey: '', config: {}
});
const targets = ref([]);
const forms = ref([]);
const selectedTarget = computed(() => targets.value
  .find(target => target.name === newHook.target));
const targetConfig = computed(() => targets.value
  .find(target => target.name === newHook.target)?.config ?? []);
const managedTarget = computed(() => selectedTarget.value?.managesUrl === true);
const requiresForm = computed(() => selectedTarget.value?.requiresForm === true);
const targetLabel = (name) => targets.value
  .find(target => target.name === name)?.label ?? name ?? 'json';

request({ method: 'GET', url: apiPaths.fieldDataWebhookTargets() })
  .then(({ data }) => { targets.value = data; })
  .catch(noop);
request({ method: 'GET', url: apiPaths.fieldDataIntegrationForms() })
  .then(({ data }) => { forms.value = data; })
  .catch(noop);
const parseEvents = (str) => str.split(',').map(s => s.trim()).filter(s => s !== '');
const formKey = form => JSON.stringify([form.projectId, form.xmlFormId]);

const expandedId = ref(null);
const deliveries = ref([]);
const loadingDeliveries = ref(false);
const syncs = ref([]);
const loadingSyncs = ref(false);
const showCredentials = ref(false);
const credentials = reactive({ clientSecret: '', refreshToken: '' });
const latestSecret = ref('');

const create = () => {
  const [projectId, xmlFormId] = newHook.formKey === ''
    ? [undefined, undefined]
    : JSON.parse(newHook.formKey);
  request({
    method: 'POST',
    url: apiPaths.fieldDataWebhooks(),
    data: {
      name: newHook.name,
      url: newHook.url,
      events: parseEvents(newHook.events),
      target: newHook.target,
      config: { ...newHook.config },
      projectId,
      xmlFormId
    }
  })
    .then(({ data }) => {
      latestSecret.value = data.secret ?? '';
      alert.success(data.sync == null
        ? t('alert.created', { name: newHook.name })
        : t('alert.createdAndQueued', { name: newHook.name, count: data.sync.total }));
      newHook.name = '';
      newHook.url = '';
      newHook.events = '';
      newHook.target = 'json';
      newHook.formKey = '';
      newHook.config = {};
      fetchData();
    })
    .catch(noop);
};

const rotateSecret = (hook) => {
  request({
    method: 'POST',
    url: apiPaths.fieldDataWebhookRotateSecret(hook.id),
    data: {}
  })
    .then(({ data }) => {
      latestSecret.value = data.secret;
      alert.success(t('alert.rotated', { name: hook.name }));
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

const loadSyncs = (hook) => {
  loadingSyncs.value = true;
  return request({ method: 'GET', url: apiPaths.fieldDataWebhookSyncs(hook.id) })
    .then(({ data }) => {
      if (expandedId.value === hook.id) syncs.value = data;
    })
    .catch(noop)
    .finally(() => { loadingSyncs.value = false; });
};

const toggleDetails = (hook) => {
  if (expandedId.value === hook.id) {
    expandedId.value = null;
    return;
  }
  expandedId.value = hook.id;
  deliveries.value = [];
  syncs.value = [];
  showCredentials.value = false;
  loadingDeliveries.value = true;
  request({ method: 'GET', url: apiPaths.fieldDataWebhookDeliveries(hook.id) })
    .then(({ data }) => {
      // Ignore a stale response if the user has since collapsed/switched rows.
      if (expandedId.value === hook.id) deliveries.value = data;
    })
    .catch(noop)
    .finally(() => { loadingDeliveries.value = false; });
  if (hook.target === 'google-sheets') loadSyncs(hook);
};

const needsReauthorization = hook =>
  typeof hook.lastStatus === 'string' && hook.lastStatus.includes('Google authorization');

const startSync = (hook) => {
  // Backfill is intentionally explicit: it may write thousands of rows.
  // eslint-disable-next-line no-alert
  if (!window.confirm(t('sheet.confirmSync'))) return;
  request({ method: 'POST', url: apiPaths.fieldDataWebhookSyncs(hook.id), data: {} })
    .then(({ data }) => {
      alert.success(t('alert.syncQueued', { count: data.total }));
      loadSyncs(hook);
    })
    .catch(noop);
};

const retrySync = (hook, sync) => request({
  method: 'POST', url: apiPaths.fieldDataWebhookSyncRetry(hook.id, sync.id), data: {}
}).then(() => {
  alert.success(t('alert.retryQueued'));
  loadSyncs(hook);
}).catch(noop);

const cancelSync = (hook, sync) => request({
  method: 'POST', url: apiPaths.fieldDataWebhookSyncCancel(hook.id, sync.id), data: {}
}).then(() => loadSyncs(hook)).catch(noop);

const replaceCredentials = (hook) => request({
  method: 'PATCH',
  url: apiPaths.fieldDataWebhook(hook.id),
  data: {
    config: {
      spreadsheetId: hook.config.spreadsheetId,
      sheetName: hook.config.sheetName,
      clientId: hook.config.clientId,
      clientSecret: credentials.clientSecret,
      refreshToken: credentials.refreshToken,
      syncUpdates: hook.config.syncUpdates === true,
      sendExisting: false
    }
  }
}).then(() => {
  credentials.clientSecret = '';
  credentials.refreshToken = '';
  showCredentials.value = false;
  alert.success(t('alert.credentialsReplaced'));
  fetchData();
}).catch(noop);
</script>

<i18n lang="json5">
{
  "en": {
    "intro": "Send submission data to Google Sheets or notify another system with a webhook.",
    "googleHelp": "Use an OAuth refresh token authorized for the Google Sheets API. New submissions are appended; enabling updates replaces the row with the same instance ID.",
    "managed": "Managed by Field Data",
    "field": {
      "name": "Name",
      "url": "URL (https://…)",
      "events": "Events (comma-separated)",
      "target": "Integration type",
      "form": "Choose a Form",
      "clientSecret": "New OAuth client secret",
      "refreshToken": "New OAuth refresh token"
    },
    "action": {
      "add": "Add integration",
      "delete": "Delete",
      "details": "Details",
      "hide": "Hide",
      "rotateSecret": "Rotate secret",
      "dismiss": "I saved it",
      "syncNow": "Sync existing submissions",
      "refresh": "Refresh",
      "retryFailed": "Retry failed",
      "cancel": "Cancel",
      "replaceCredentials": "Replace Google credentials",
      "saveCredentials": "Save credentials"
    },
    "header": {
      "name": "Name",
      "url": "URL",
      "events": "Events",
      "target": "Sends",
      "status": "Last status",
      "active": "Active",
      "actions": "Actions"
    },
    // Shown in the Events column when a webhook subscribes to every event.
    "allEvents": "All events",
    // Shown where a service is not scoped to one Form.
    "everyForm": "every Form",
    "emptyTable": "No integrations have been configured yet.",
    "confirmDelete": "Are you sure you want to delete the integration “{name}”?",
    "alert": {
      "created": "Integration “{name}” has been created.",
      "createdAndQueued": "Integration “{name}” was created and {count} existing submissions were queued.",
      "deleted": "Integration “{name}” has been deleted.",
      "rotated": "The signing secret for “{name}” has been rotated.",
      "syncQueued": "{count} submissions are queued for background synchronization.",
      "retryQueued": "Failed rows have been queued again.",
      "credentialsReplaced": "Google credentials have been replaced."
    },
    "sheet": {
      "reauthorization": "Google authorization has expired. Replace the credentials, then retry the failed synchronization.",
      "history": "Historical synchronization",
      "status": "Status",
      "progress": "Progress",
      "results": "Results",
      "counts": "{synced} new · {updated} updated · {failed} failed",
      "noHistory": "No historical synchronization has been requested.",
      "confirmSync": "Synchronize every current Submission to this worksheet? The work will continue in the background."
    },
    "detail": {
      "secret": "Signing secret",
      "noSecret": "None (deliveries are not signed)",
      "configured": "Configured and hidden",
      "saveSecret": "Copy this signing secret now. It will not be shown again:",
      "secretHelp": "Deliveries are signed with HMAC-SHA256 in the X-FieldData-Signature header. Rotate the secret if it is lost or exposed.",
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
@import '../../assets/scss/variables';

#field-data-webhooks {
  .webhook-form {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 20px;
    .form-control { width: auto; flex: 1 1 180px; }
    .config-checkbox { align-self: center; flex: 1 1 100%; margin: 0; }
    .google-help { flex: 1 1 100%; margin: 0; }
  }
  .url-cell { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  // The target and its scope are two facts, not one phrase: without a
  // separator "JSON endpoint every Form" reads as a single label.
  .target-cell .scoped {
    color: $color-text-muted;
    font-size: 12px;

    &::before { content: '·'; margin: 0 4px; }
  }
  .actions-col { text-align: right; white-space: nowrap; }
  .actions-col .btn + .btn { margin-left: 5px; }

  // 4.97 to 1 on the row behind it, so the code is readable as text and not
  // only as a colour.
  .status-failed { color: #b42a2f; font-weight: 600; } // gradient --danger-text

  .details-row > td { background-color: #f8f8fb; }
  .detail-label { font-weight: bold; margin: 5px 0; }
  .webhook-secret {
    margin-bottom: 15px;
    .btn { margin-left: 8px; }
    code { word-break: break-all; }
  }
  .webhook-new-secret {
    align-items: center;
    display: flex;
    gap: 10px;
    code { word-break: break-all; }
  }
  .deliveries-table { margin-bottom: 5px; background-color: transparent; }
  .sheet-recovery { margin-bottom: 18px; }
  .sheet-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .credential-form {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 12px;
    .form-control { max-width: 320px; }
  }
  .sync-table { background-color: transparent; margin-bottom: 5px; }
}
</style>
