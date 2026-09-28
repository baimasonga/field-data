<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

This file is part of Field Data, a distribution of ODK Central. It is subject to
the license terms in the LICENSE file found in the top-level directory of this
distribution and at https://www.apache.org/licenses/LICENSE-2.0.

Wrapper for the Field Data section. Navigation between Dashboard / Media /
Webhooks / Backups now lives in the left sidebar, so this component just frames
the active sub-page.
-->
<template>
  <page-body>
    <router-view/>
  </page-body>
</template>

<script setup>
import PageBody from '../page/body.vue';

defineOptions({
  name: 'FieldDataHome'
});
</script>
