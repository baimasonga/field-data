<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

This file is part of Field Data, a distribution of ODK Central. It is subject to
the license terms in the LICENSE file found in the top-level directory of this
distribution and at https://www.apache.org/licenses/LICENSE-2.0.

Public report: read-only report page reached via a tokenized share link, no
login required. Shows aggregates only.
-->
<template>
  <div id="fd-public-report">
    <loading :state="report.initiallyLoading"/>
    <div v-if="report.dataExists" class="fd-public-sheet">
      <report-body :data="report.data"/>
    </div>
    <div v-else-if="failed" class="fd-public-gone">
      <h1>{{ $t('gone.title') }}</h1>
      <p>{{ $t('gone.body') }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRoute } from 'vue-router';

import Loading from '../loading.vue';
import ReportBody from './report-body.vue';

import { apiPaths } from '../../util/request';
import { useRequestData } from '../../request-data';

defineOptions({ name: 'FieldDataPublicReport' });

const route = useRoute();
const { createResource } = useRequestData();
const report = createResource('fieldDataPublicReport');
const failed = ref(false);

report.request({ url: apiPaths.fieldDataPublicReport(route.params.token), alert: false })
  .catch(() => { failed.value = true; });
</script>

<i18n lang="json5">
{
  "en": {
    "gone": {
      "title": "This report link is not available",
      "body": "The link may have been revoked, or the address may be incorrect. Please ask the person who shared it for a new link."
    }
  }
}
</i18n>

<style lang="scss">
#fd-public-report {
  max-width: 980px;
  margin: 0 auto;
  padding: 26px 20px;

  .fd-public-sheet { background: #fff; border: 1px solid #e4ebed; border-radius: 14px; padding: 26px 30px; }
  .fd-public-gone { text-align: center; padding: 80px 20px; color: #667a80;
    h1 { font-size: 22px; font-weight: 750; color: #143039; margin: 0 0 8px; } }
}
</style>
