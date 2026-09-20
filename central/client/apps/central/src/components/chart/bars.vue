<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

Counts by category, horizontal so long answer labels have room to be read
rather than turned on their side.

The categories have no natural order, so every bar takes the same hue: bar
length already shows the magnitude, and colouring by value would spend the
identity channel restating it. The one exception is a review state, which is
a reserved status colour and always arrives with its own icon and label.
-->
<template>
  <figure class="chart-bars">
    <figcaption v-if="title" class="chart-title">
      {{ title }}
      <span v-if="subtitle" class="chart-subtitle">{{ subtitle }}</span>
    </figcaption>

    <ul class="bar-rows">
      <li v-for="row of rows" :key="row.key" class="bar-row" tabindex="0"
        @pointerenter="hovered = row.key" @pointerleave="hovered = null"
        @focus="hovered = row.key" @blur="hovered = null">
        <span class="bar-label">
          <span v-if="row.icon" :class="[row.icon, 'bar-icon']" aria-hidden="true"></span>
          {{ row.label }}
        </span>
        <span class="bar-track">
          <span class="bar-fill" :class="{ hovered: hovered === row.key }"
            :style="{ width: `${row.width}%`, backgroundColor: row.color }"></span>
        </span>
        <span class="bar-value">{{ $n(row.count, 'default') }}</span>
        <span class="bar-share">{{ row.share }}</span>
      </li>
    </ul>

    <details class="chart-table">
      <summary>{{ $t('showTable') }}</summary>
      <table class="table">
        <thead>
          <tr>
            <th>{{ labelHeader }}</th>
            <th class="count-col">{{ $t('header.count') }}</th>
            <th class="count-col">{{ $t('header.share') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row of rows" :key="row.key">
            <td>{{ row.label }}</td>
            <td class="count-col">{{ $n(row.count, 'default') }}</td>
            <td class="count-col">{{ row.share }}</td>
          </tr>
        </tbody>
      </table>
    </details>
  </figure>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

defineOptions({ name: 'ChartBars' });

const props = defineProps({
  // [{ key, label, count, color?, icon? }]
  data: { type: Array, required: true },
  title: { type: String, default: null },
  subtitle: { type: String, default: null },
  labelHeader: { type: String, default: '' },
  // Counts are parts of a whole, so a share column reads naturally. An
  // average or a median is not: "6.4" is not 32% of anything, and a share
  // beside it invites exactly that reading.
  showShare: { type: Boolean, default: true }
});

const { n } = useI18n();
const hovered = ref(null);

// gradient --iris-600. 5.78 to one against the panel, so a bar is legible as a
// shape and not only as a length.
const DEFAULT_FILL = '#5d4ee0';

const total = computed(() => props.data.reduce((sum, row) => sum + row.count, 0));
const max = computed(() => Math.max(1, ...props.data.map((row) => row.count)));

const rows = computed(() => props.data.map((row) => ({
  ...row,
  color: row.color ?? DEFAULT_FILL,
  width: (row.count / max.value) * 100,
  share: (!props.showShare || total.value === 0)
    ? ''
    : `${n(row.count / total.value, 'percent')}`
})));

defineExpose({ n });
</script>

<i18n lang="json5">
{
  "en": {
    "showTable": "Show the numbers",
    "header": {
      "count": "Submissions",
      "share": "Share"
    }
  }
}
</i18n>

<style lang="scss">
@import '../../assets/scss/variables';

.chart-bars {
  margin: 0 0 30px;

  .chart-title {
    color: $color-text;
    font-size: 15px;
    font-weight: 600;
    margin-bottom: 10px;
  }
  .chart-subtitle {
    color: $color-text-muted;
    font-size: 12px;
    font-weight: normal;
    margin-left: 8px;
  }

  .bar-rows { list-style: none; margin: 0; padding: 0; }

  .bar-row {
    align-items: center;
    // The row is the hit target, not the painted bar, so a one-count bar is
    // as easy to reach as the longest one.
    border-radius: 4px;
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(90px, 22%) 1fr auto auto;
    padding: 3px 6px;

    &:hover, &:focus { background-color: #f8f8fb; outline: none; } // gradient --gray-50
    &:focus-visible { box-shadow: 0 0 0 2px #aba3f4; }             // gradient --iris-300
  }

  .bar-label {
    color: $color-text;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bar-icon { margin-right: 5px; }

  .bar-track {
    // The track is the surface, not a second mark: no fill, no border.
    display: block;
    height: 18px;
    position: relative;
  }

  .bar-fill {
    // Square at the baseline, rounded at the data end.
    border-radius: 0 4px 4px 0;
    display: block;
    height: 100%;
    min-width: 2px;
    transition: filter 0.1s ease-out;

    &.hovered { filter: brightness(1.12); }
  }

  .bar-value {
    color: $color-text;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    min-width: 48px;
    text-align: right;
  }
  .bar-share {
    color: $color-text-muted;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    min-width: 46px;
    text-align: right;
  }

  .chart-table {
    margin-top: 12px;

    summary {
      color: $color-action-foreground;
      cursor: pointer;
      font-size: 13px;
    }
    table { margin-top: 8px; }
    .count-col { text-align: right; font-variant-numeric: tabular-nums; }
  }
}
</style>
