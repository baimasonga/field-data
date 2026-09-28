<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

This file is part of Field Data, a distribution of ODK Central. It is subject to
the license terms in the LICENSE file found in the top-level directory of this
distribution and at https://www.apache.org/licenses/LICENSE-2.0.

Data Cleaning: follow up submissions that reviewers sent back for correction.
-->
<template>
  <div id="fd-cleaning">
    <header class="fd-head">
      <div>
        <h1>{{ $t('title') }}</h1>
        <p>{{ $t('subtitle') }}</p>
      </div>
      <button type="button" class="btn btn-link" @click="reload">{{ $t('refresh') }}</button>
    </header>

    <loading :state="cleaning.initiallyLoading"/>

    <template v-if="cleaning.dataExists">
      <div class="fd-stats">
        <div class="stat open"><span>{{ cleaning.data.counts.open }}</span>{{ $t('stat.open') }}</div>
        <div class="stat"><span>{{ cleaning.data.counts.corrected }}</span>{{ $t('stat.corrected') }}</div>
        <div class="stat rejected"><span>{{ cleaning.data.counts.rejected }}</span>{{ $t('stat.rejected') }}</div>
      </div>

      <div class="fd-panel">
        <table class="fd-table">
          <thead>
            <tr>
              <th>{{ $t('th.form') }}</th>
              <th>{{ $t('th.submitter') }}</th>
              <th>{{ $t('th.district') }}</th>
              <th>{{ $t('th.requested') }}</th>
              <th>{{ $t('th.note') }}</th>
              <th class="actions">{{ $t('th.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item of items" :key="item.id" class="rowlink" @click="openSubmission(item)">
              <td>
                <button type="button" class="submission-link" @click.stop="openSubmission(item)">
                  {{ item.formName || item.form }}
                </button>
                <span class="instance">#{{ item.id }}</span>
              </td>
              <td>{{ item.submitter || $t('unknown') }}</td>
              <td>{{ item.district || '-' }}</td>
              <td class="muted">
                <date-time v-if="item.reviewedAt" :iso="item.reviewedAt" relative="past"/>
                <date-time v-else :iso="item.createdAt" relative="past"/>
                <span v-if="item.reviewedBy" class="reviewer">{{ item.reviewedBy }}</span>
              </td>
              <td class="note">{{ item.note || $t('noNote') }}</td>
              <td class="actions">
                <button type="button" class="qbtn open" @click.stop="openSubmission(item)">{{ $t('action.open') }}</button>
                <button type="button" class="qbtn approve" :aria-disabled="awaitingResponse" @click.stop="act(item, 'approved')">{{ $t('action.approve') }}</button>
                <button type="button" class="qbtn reject" :aria-disabled="awaitingResponse" @click.stop="act(item, 'rejected')">{{ $t('action.reject') }}</button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="items.length === 0" class="fd-empty">{{ $t('empty') }}</p>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, inject } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import DateTime from '../date-time.vue';
import Loading from '../loading.vue';

import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';
import { useRequestData } from '../../request-data';

defineOptions({ name: 'FieldDataCleaning' });

const { t } = useI18n();
const alert = inject('alert');
const router = useRouter();
const { request, awaitingResponse } = useRequest();
const { createResource } = useRequestData();
const cleaning = createResource('fieldDataCleaning');

const reload = () => cleaning.request({ url: apiPaths.fieldDataCleaning() }).catch(noop);
reload();

const items = computed(() => (cleaning.dataExists ? cleaning.data.items : []));

const openSubmission = (item) => {
  router.push(`/projects/${item.projectId}/forms/${encodeURIComponent(item.form)}/submissions/${encodeURIComponent(item.instanceId)}`);
};

const act = (item, decision) => {
  let note = null;
  if (decision === 'rejected') {
    // eslint-disable-next-line no-alert
    note = window.prompt(t('rejectPrompt', { form: item.formName || item.form }));
    if (note === null) return;
  }
  request({ method: 'POST', url: apiPaths.fieldDataReview(), data: { submissionId: item.id, decision, note } })
    .then(() => {
      alert.success(t(`alert.${decision}`));
      reload();
    })
    .catch(noop);
};
</script>

<i18n lang="json5">
{
  "en": {
    "title": "Data Cleaning",
    "subtitle": "Follow up submissions that were sent back for correction.",
    "refresh": "Refresh",
    "unknown": "(unknown)",
    "noNote": "No correction note provided.",
    "stat": {
      "open": "open corrections",
      "corrected": "edited submissions",
      "rejected": "rejected"
    },
    "th": {
      "form": "Form",
      "submitter": "Submitter",
      "district": "District",
      "requested": "Requested",
      "note": "Correction note",
      "actions": "Actions"
    },
    "action": {
      "open": "Open",
      "approve": "Approve",
      "reject": "Reject"
    },
    "rejectPrompt": "Reason for rejecting this \"{form}\" submission (optional):",
    "alert": {
      "approved": "Submission approved.",
      "rejected": "Submission rejected."
    },
    "empty": "No submissions are waiting for correction."
  }
}
</i18n>

<style lang="scss">
@import '../../assets/scss/variables';

#fd-cleaning {
  --b: #e4ebed;
  --muted: #667a80;
  --teal: #0E7490;

  .fd-head {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px;
    h1 { font-size: 24px; font-weight: 750; margin: 0 0 4px; color: #143039; }
    p { margin: 0; color: var(--muted); font-size: 14px; }
    .btn-link { color: var(--teal); }
  }

  .fd-stats {
    display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px;
    .stat {
      border: 1px solid var(--b); border-radius: 12px; background: #fff; padding: 13px 16px;
      color: var(--muted); font-size: 12.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
      span { display: block; color: #143039; font-size: 25px; line-height: 1.1; margin-bottom: 3px; letter-spacing: 0; }
      &.open span { color: #9c6209; }
      &.rejected span { color: #b3210c; }
    }
  }

  .fd-panel { background: #fff; border: 1px solid var(--b); border-radius: 14px; overflow: hidden; box-shadow: 0 1px 2px rgba(20,48,57,0.04); }
  .fd-table {
    width: 100%; border-collapse: collapse;
    th {
      text-align: left; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em;
      color: var(--muted); padding: 12px 16px; border-bottom: 1px solid var(--b); white-space: nowrap;
    }
    td { padding: 14px 16px; border-bottom: 1px solid #f1f5f6; font-size: 14px; vertical-align: top; }
    tr.rowlink { cursor: pointer; }
    tr:hover td { background: #f7fbfc; }
    .submission-link { border: 0; background: transparent; color: #002b3b; font: inherit; font-weight: 750; padding: 0; text-align: left; cursor: pointer;
      &:hover { color: var(--teal); text-decoration: underline; } }
    .instance, .reviewer { display: block; color: var(--muted); font-size: 12px; margin-top: 3px; }
    .muted { color: var(--muted); white-space: nowrap; }
    .note { max-width: 440px; color: #33474d; line-height: 1.35; }
    .actions { text-align: right; white-space: nowrap; }
  }

  .qbtn {
    border: 0; border-radius: 8px; padding: 7px 12px; font-size: 13px; font-weight: 750; margin-left: 6px;
    &.open { color: #0E7490; background: #e7f2f5; }
    &.approve { color: #047044; background: #dff2e8; }
    &.reject { color: #b3210c; background: #fde9e7; }
    &:hover { filter: brightness(0.97); }
  }

  .fd-empty { margin: 0; padding: 42px 20px; color: var(--muted); text-align: center; }

  @media (max-width: 900px) {
    .fd-stats { grid-template-columns: 1fr; }
    .fd-panel { overflow-x: auto; }
  }
}
</style>
