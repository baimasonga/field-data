<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <time v-if="iso && parsed.isValid" :datetime="iso">{{ formatted }}</time>
  <span v-else>{{ iso || 'Unknown' }}</span>
</template>
<script setup>
import { computed } from 'vue';
import { DateTime } from 'luxon';
import { useI18n } from 'vue-i18n';

const props = defineProps({ iso: String });
const { locale } = useI18n();
const parsed = computed(() => DateTime.fromISO(props.iso || '', { setZone: true, locale: locale.value }));
const formatted = computed(() => {
  const value = parsed.value.toFormat('d LLL yyyy · HH:mm:ss');
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(props.iso) ? `${value} ${parsed.value.toFormat('ZZZZ')}` : `${value} (time zone unknown)`;
});
</script>
