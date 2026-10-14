<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <ol class="itinerary-stops">
    <li v-for="stop of stops" :key="stop.id">
      <h4>Stop {{ stop.order }}</h4>
      <p class="question">{{ stop.question }}</p>
      <p v-if="stop.xmlFormId">
<strong>Collect form:</strong> {{ stop.formName || stop.xmlFormId }} ({{ stop.xmlFormId }})<br>
        <span>Form version: {{ stop.formVersion || 'No version label' }}{{ snapshot ? ' · as saved' : ' · current published version' }}</span>
      </p>
      <p v-else role="status">Form details are unavailable here. Match this request ID to your current instructions before collecting.</p>
      <dl>
        <dt>Location</dt><dd>{{ stop.location.latitude }}, {{ stop.location.longitude }}</dd>
        <dt>GPS accuracy</dt><dd>{{ stop.location.accuracy == null || stop.location.accuracy < 0 ? 'Unknown' : `${stop.location.accuracy} m` }}</dd>
        <dt>Due</dt><dd><record-date-time v-if="stop.dueAt" :value="stop.dueAt"/><span v-else>Not set</span></dd>
      </dl>
      <details><summary>Request reference</summary><p>{{ stop.id }}</p></details>
    </li>
  </ol>
</template>
<script setup>
import RecordDateTime from '../record-date-time.vue';

defineOptions({ name: 'FieldDataItineraryStops' });
defineProps({ stops: { type: Array, required: true }, snapshot: Boolean });
</script>
<style scoped>
.itinerary-stops { list-style: none; padding: 0; }
.itinerary-stops li { border-top: 1px solid #e5edef; padding: 16px 0; }
.itinerary-stops h4 { font-size: 16px; margin: 0 0 8px; }
.question { white-space: pre-wrap; }
dl { display: grid; grid-template-columns: minmax(95px, 0.35fr) minmax(0, 1fr); gap: 6px 12px; margin: 12px 0; }
dt { font-weight: 500; color: #536c75; }
dd { margin: 0; overflow-wrap: anywhere; }
summary { cursor: pointer; color: #0d7188; }
</style>
