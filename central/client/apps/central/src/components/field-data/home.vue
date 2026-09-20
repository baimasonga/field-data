<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

This file is part of Field Data, a distribution of ODK Central. It is subject to
the license terms in the LICENSE file found in the top-level directory of this
distribution and at https://www.apache.org/licenses/LICENSE-2.0.
-->
<template>
  <div>
    <page-head>
      <template #title>{{ $t('title') }}</template>
      <template #tabs>
        <li :class="tabClass('')" role="presentation">
          <router-link :to="tabPath('')">{{ $t('tab.dashboard') }}</router-link>
        </li>
        <li v-if="canManage" :class="tabClass('media')" role="presentation">
          <router-link :to="tabPath('media')">{{ $t('tab.media') }}</router-link>
        </li>
        <!-- Shown to everybody, because an organization owner holds no
        site-wide verb that could be tested here and hiding the tab from them
        is what made the owner role decorative. The page itself is scoped by
        the server. -->
        <li :class="tabClass('organizations')" role="presentation">
          <router-link :to="tabPath('organizations')">{{ $t('tab.organizations') }}</router-link>
        </li>
        <li v-if="canConfigure" :class="tabClass('webhooks')" role="presentation">
          <router-link :to="tabPath('webhooks')">{{ $t('tab.webhooks') }}</router-link>
        </li>
        <li v-if="canBackup" :class="tabClass('backups')" role="presentation">
          <router-link :to="tabPath('backups')">{{ $t('tab.backups') }}</router-link>
        </li>
      </template>
    </page-head>
    <page-body>
      <router-view/>
    </page-body>
  </div>
</template>

<script setup>
import { computed } from 'vue';

import PageBody from '../page/body.vue';
import PageHead from '../page/head.vue';

import useTabs from '../../composables/tabs';
import { useRequestData } from '../../request-data';

defineOptions({
  name: 'FieldDataHome'
});

const { tabPath, tabClass } = useTabs('/field-data');
const { currentUser } = useRequestData();
const canConfigure = computed(() => currentUser.can('config.set'));
const canBackup = computed(() => currentUser.can('backup.run'));
const canManage = computed(() => currentUser.can('project.create'));
</script>

<i18n lang="json5">
{
  "en": {
    // Title of the Field Data operations section
    "title": "Field Data",
    "tab": {
      "dashboard": "Dashboard",
      "media": "Media Library",
      // The tenants that own this deployment's Projects.
      "organizations": "Organizations",
      "webhooks": "Webhooks",
      "backups": "Backups"
    }
  }
}
</i18n>
