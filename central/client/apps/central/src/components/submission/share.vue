<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

Creating and revoking the read-only links to a Form's summary.

A link is a credential, so the server keeps only its hash and hands back the
usable value exactly once. This component is therefore the only place that
value ever exists, and it says so rather than letting somebody discover it by
coming back later and finding nothing.
-->
<template>
  <div class="summary-share">
    <div class="share-header">
      <h2>{{ $t('title') }}</h2>
      <p>{{ $t('explanation') }}</p>
    </div>

    <form class="share-form" @submit.prevent="create">
      <input v-model.trim="newShare.name" class="form-control" type="text"
        :placeholder="$t('field.name')" :aria-label="$t('field.name')"
        maxlength="255" required>
      <select v-model="newShare.expiresInDays" class="form-control"
        :aria-label="$t('field.expiry')">
        <option :value="null">{{ $t('expiry.never') }}</option>
        <option :value="7">{{ $t('expiry.days', 7) }}</option>
        <option :value="30">{{ $t('expiry.days', 30) }}</option>
        <option :value="90">{{ $t('expiry.days', 90) }}</option>
      </select>
      <button type="submit" class="btn btn-primary" :aria-disabled="awaitingResponse">
        {{ $t('action.create') }} <spinner :state="awaitingResponse"/>
      </button>
    </form>

    <!-- Shown once, because there is no second chance to show it. -->
    <div v-if="issued != null" class="share-issued" role="alert">
      <p class="issued-heading">{{ $t('issued.heading') }}</p>
      <p class="issued-warning">{{ $t('issued.onceOnly') }}</p>
      <div class="issued-link">
        <input ref="issuedInput" class="form-control" type="text" readonly
          :value="issued" :aria-label="$t('issued.heading')" @focus="selectAll">
        <button type="button" class="btn btn-default" @click="copy">
          {{ copied ? $t('action.copied') : $t('action.copy') }}
        </button>
        <button type="button" class="btn btn-link" @click="issued = null">
          {{ $t('action.dismiss') }}
        </button>
      </div>
    </div>

    <table v-if="shares.length > 0" class="table share-table">
      <thead>
        <tr>
          <th>{{ $t('header.name') }}</th>
          <th>{{ $t('header.created') }}</th>
          <th>{{ $t('header.expires') }}</th>
          <th class="count-col">{{ $t('header.views') }}</th>
          <th class="actions-col">{{ $t('header.actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row of shares" :key="row.id">
          <td>{{ row.name }}</td>
          <td><date-time :iso="row.createdAt"/></td>
          <td>
            <date-time v-if="row.expiresAt != null" :iso="row.expiresAt"/>
            <span v-else class="never">{{ $t('expiry.never') }}</span>
          </td>
          <td class="count-col">{{ $n(row.views, 'default') }}</td>
          <td class="actions-col">
            <button type="button" class="btn btn-default btn-xs"
              :aria-disabled="awaitingResponse" @click="revoke(row)">
              {{ $t('action.revoke') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="!loading" class="share-empty">{{ $t('noShares') }}</p>
  </div>
</template>

<script setup>
import { nextTick, reactive, ref, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';

import DateTime from '../date-time.vue';
import Spinner from '../spinner.vue';

import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';

defineOptions({ name: 'SubmissionShare' });

const props = defineProps({
  projectId: { type: String, required: true },
  xmlFormId: { type: String, required: true }
});

const { t } = useI18n();
const { request, awaitingResponse } = useRequest();

const shares = ref([]);
const loading = ref(true);
const issued = ref(null);
const copied = ref(false);
const issuedInput = useTemplateRef('issuedInput');
const newShare = reactive({ name: '', expiresInDays: null });

const path = apiPaths.formDashboards(props.projectId, props.xmlFormId);

const load = () => request({ method: 'GET', url: path })
  .then(({ data }) => { shares.value = data; })
  .catch(noop)
  .finally(() => { loading.value = false; });
load();

const create = () => request({
  method: 'POST', url: path, data: { ...newShare }
})
  .then(async ({ data }) => {
    // The server returns the token once. Turn it into the link somebody can
    // actually paste, here, and never ask for it again.
    issued.value = `${window.location.origin}/shared/${data.token}`;
    copied.value = false;
    newShare.name = '';
    newShare.expiresInDays = null;
    await load();
    await nextTick();
    if (issuedInput.value != null) issuedInput.value.focus();
  })
  .catch(noop);

const revoke = (row) => {
  // eslint-disable-next-line no-alert
  if (!window.confirm(t('confirmRevoke', { name: row.name }))) return;
  request({ method: 'DELETE', url: `${path}/${row.id}` })
    .then(load)
    .catch(noop);
};

const selectAll = (event) => { event.target.select(); };

const copy = async () => {
  try {
    await navigator.clipboard.writeText(issued.value);
    copied.value = true;
  } catch {
    // Clipboard access can be refused, and the link is on screen and
    // selectable either way, so falling back to selecting it is enough.
    if (issuedInput.value != null) issuedInput.value.select();
  }
};
</script>

<i18n lang="json5">
{
  "en": {
    "title": "Shared links",
    "explanation": "A shared link shows this Form's counts to anyone who opens it, without an account. No individual Submission, photograph or contributor's name is reachable through one.",
    "field": {
      "name": "Who is this link for?",
      "expiry": "Expires"
    },
    "expiry": {
      "never": "Never expires",
      "days": "Expires in {count} day | Expires in {count} days"
    },
    "issued": {
      "heading": "Your shared link",
      "onceOnly": "Copy it now. It is not stored, and cannot be shown again — if you lose it, revoke this link and create another."
    },
    "header": {
      "name": "For",
      "created": "Created",
      "expires": "Expires",
      "views": "Views",
      "actions": "Actions"
    },
    "action": {
      "create": "Create link",
      "copy": "Copy",
      "copied": "Copied",
      "dismiss": "Done",
      "revoke": "Revoke"
    },
    "noShares": "No links have been shared for this Form.",
    // {name} is who the link was created for.
    "confirmRevoke": "Revoke the link for “{name}”? Anyone holding it will stop being able to open it."
  }
}
</i18n>

<style lang="scss">
@import '../../assets/scss/variables';

.summary-share {
  border-top: 1px solid #e9e9f1;        // gradient --gray-150
  margin-top: 30px;
  padding-top: 24px;

  .share-header {
    h2 {
      color: $color-text;
      font-size: 15px;
      font-weight: 600;
      margin: 0 0 4px;
    }
    p {
      color: $color-text-muted;
      font-size: 13px;
      margin: 0 0 14px;
      max-width: 70ch;
    }
  }

  .share-form {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 18px;

    .form-control { flex: 1 1 200px; width: auto; }
    select.form-control { flex: 0 1 180px; }
  }

  .share-issued {
    background-color: #eeedfe;          // gradient --iris-50
    border: 1px solid #c9c4f9;          // gradient --iris-200
    border-radius: 8px;
    margin-bottom: 20px;
    padding: 14px 16px;

    .issued-heading {
      color: $color-text;
      font-weight: 600;
      margin: 0 0 2px;
    }
    .issued-warning {
      color: $color-text-secondary;
      font-size: 13px;
      margin: 0 0 10px;
    }
    .issued-link {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;

      .form-control {
        flex: 1 1 320px;
        font-family: $font-family-monospace;
        font-size: 12px;
        width: auto;
      }
    }
  }

  .share-table {
    .count-col { text-align: right; font-variant-numeric: tabular-nums; }
    .actions-col { text-align: right; white-space: nowrap; }
    .never { color: $color-text-muted; }
  }

  .share-empty {
    color: $color-text-muted;
    font-size: 13px;
  }
}
</style>
