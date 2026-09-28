<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

This file is part of Field Data, a distribution of ODK Central. It is subject to
the license terms in the LICENSE file found in the top-level directory of this
distribution and at https://www.apache.org/licenses/LICENSE-2.0.

Reports: printable program report + public share-link management.
-->
<template>
  <div id="fd-report">
    <div class="fd-report-actions">
      <div>
        <h1>{{ $t('title') }}</h1>
        <p>{{ $t('subtitle') }}</p>
      </div>
      <button type="button" class="fd-btn-primary" @click="printReport">{{ $t('action.print') }}</button>
    </div>

    <div class="fd-share-panel">
      <div class="sp-head">
        <h2>{{ $t('share.title') }}</h2>
        <button type="button" class="fd-btn-secondary" :aria-disabled="awaitingResponse" @click="createShare">{{ $t('share.create') }}</button>
      </div>
      <p class="sp-hint">{{ $t('share.hint') }}</p>
      <ul v-if="activeShares.length > 0" class="sp-list">
        <li v-for="s of activeShares" :key="s.id">
          <code class="sp-url">{{ shareUrl(s) }}</code>
          <button type="button" class="rbtn ok" @click="copyShare(s)">{{ $t('share.copy') }}</button>
          <button type="button" class="rbtn no" :aria-disabled="awaitingResponse" @click="revoke(s)">{{ $t('share.revoke') }}</button>
        </li>
      </ul>
      <p v-else-if="shares.dataExists" class="sp-none">{{ $t('share.none') }}</p>
    </div>

    <div class="fd-dhis2-panel">
      <div class="sp-head">
        <h2>{{ $t('dhis2.title') }}</h2>
        <div class="dhis2-actions">
          <button type="button" class="fd-btn-secondary" :aria-disabled="awaitingResponse" @click="copyDhis2">{{ $t('dhis2.copy') }}</button>
          <button type="button" class="fd-btn-primary small" :aria-disabled="awaitingResponse" @click="downloadDhis2">{{ $t('dhis2.download') }}</button>
        </div>
      </div>
      <p class="sp-hint">{{ $t('dhis2.hint') }}</p>
    </div>

    <loading :state="report.initiallyLoading"/>
    <div v-if="report.dataExists" class="fd-report-sheet">
      <report-body :data="report.data"/>
    </div>
  </div>
</template>

<script setup>
import { computed, inject } from 'vue';
import { useI18n } from 'vue-i18n';

import Loading from '../loading.vue';
import ReportBody from './report-body.vue';

import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';
import { useRequestData } from '../../request-data';

defineOptions({ name: 'FieldDataReport' });

const { t } = useI18n();
const alert = inject('alert');
const { request, awaitingResponse } = useRequest();
const { createResource } = useRequestData();
const report = createResource('fieldDataReport');
const shares = createResource('fieldDataShares');

report.request({ url: apiPaths.fieldDataReport() }).catch(noop);
const loadShares = () => shares.request({ url: apiPaths.fieldDataShares(), clear: false }).catch(noop);
loadShares();

const activeShares = computed(() => (shares.dataExists ? shares.data.filter(s => s.revokedAt == null) : []));
const shareUrl = (s) => `${window.location.origin}/report/${s.token}`;

const createShare = () => {
  request({ method: 'POST', url: apiPaths.fieldDataShares(), data: {} })
    .then(() => { alert.success(t('share.created')); loadShares(); })
    .catch(noop);
};
const revoke = (s) => {
  request({ method: 'DELETE', url: apiPaths.fieldDataShare(s.id) })
    .then(() => { alert.success(t('share.revoked')); loadShares(); })
    .catch(noop);
};
const copyShare = (s) => {
  navigator.clipboard.writeText(shareUrl(s))
    .then(() => { alert.success(t('share.copied')); })
    .catch(noop);
};
const fetchDhis2 = () => request({ method: 'GET', url: apiPaths.fieldDataDhis2() });
const copyDhis2 = () => {
  fetchDhis2()
    .then(({ data }) => navigator.clipboard.writeText(JSON.stringify(data, null, 2)))
    .then(() => { alert.success(t('dhis2.copied')); })
    .catch(noop);
};
const downloadDhis2 = () => {
  fetchDhis2()
    .then(({ data }) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `field-data-dhis2-${data.period || 'export'}.json`;
      link.click();
      URL.revokeObjectURL(url);
    })
    .catch(noop);
};
const printReport = () => { window.print(); };
</script>

<i18n lang="json5">
{
  "en": {
    "title": "Reports",
    "subtitle": "A donor-ready program summary. Print it, save it as PDF, or share a live link.",
    "action": { "print": "Print / Save PDF" },
    "share": {
      "title": "Public share links",
      "hint": "Anyone with a link sees a live, read-only version of this report - aggregates only, no raw records. Revoke a link at any time.",
      "create": "New share link",
      "copy": "Copy",
      "revoke": "Revoke",
      "none": "No active share links.",
      "created": "Share link created.",
      "revoked": "Share link revoked.",
      "copied": "Link copied to clipboard."
    },
    "dhis2": {
      "title": "DHIS2 export",
      "hint": "Download a DHIS2 Data Value Set JSON payload using the saved DHIS2 mapping settings.",
      "copy": "Copy JSON",
      "download": "Download JSON",
      "copied": "DHIS2 JSON copied."
    }
  }
}
</i18n>

<style lang="scss">
@import '../../assets/scss/variables';

#fd-report {
  --b: #e4ebed; --muted: #667a80;

  .fd-report-actions { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;
    h1 { font-size: 24px; font-weight: 750; letter-spacing: -0.01em; margin: 0 0 4px; color: #143039; }
    p { margin: 0; color: var(--muted); font-size: 14px; } }
  .fd-btn-primary { border: none; background: #0E7490; color: #fff; font: inherit; font-weight: 600; font-size: 13.5px; padding: 10px 20px; border-radius: 9px; cursor: pointer; box-shadow: 0 4px 12px rgba(14,116,144,0.22); &:hover { background: #0A5A72; } &.small { padding: 7px 14px; font-size: 13px; box-shadow: none; } }
  .fd-btn-secondary { border: 1px solid #d5e2e5; background: #fff; color: #33474d; font: inherit; font-weight: 600; font-size: 13px; padding: 7px 14px; border-radius: 8px; cursor: pointer; &:hover { border-color: #0E7490; color: #0E7490; } }

  .fd-share-panel, .fd-dhis2-panel { background: #fff; border: 1px solid var(--b); border-radius: 12px; padding: 14px 18px; margin-bottom: 20px;
    .sp-head { display: flex; justify-content: space-between; align-items: center;
      h2 { font-size: 15px; font-weight: 700; margin: 0; color: #143039; } }
    .sp-hint { color: var(--muted); font-size: 12.5px; margin: 6px 0 10px; }
    .sp-list { list-style: none; margin: 0; padding: 0;
      li { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-top: 1px solid #f1f5f6; } }
    .sp-url { font-size: 12px; background: #f6fafb; border: 1px solid #e4ebed; border-radius: 6px; padding: 5px 10px; color: #155a86; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60%; }
    .sp-none { color: var(--muted); font-size: 13px; margin: 0; }
    .rbtn { border: none; border-radius: 7px; font-size: 12.5px; font-weight: 600; padding: 5px 12px; cursor: pointer;
      &.ok { background: #e3f0f6; color: #155a86; } &.no { background: #fdecea; color: #b3210c; } } }
  .dhis2-actions { display: flex; gap: 8px; align-items: center; }

  .fd-report-sheet { background: #fff; border: 1px solid var(--b); border-radius: 14px; padding: 26px 30px; box-shadow: 0 1px 2px rgba(18,48,58,0.04); }
}
</style>
