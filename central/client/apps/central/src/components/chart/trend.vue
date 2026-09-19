<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

A count over time: one series, so one hue and no legend -- the heading says
what is plotted. A crosshair snaps to the nearest day, because a reader aims
at a date and never at a two pixel line, and the readout leads with the value.

Every number the tooltip shows is also in the table beneath, so the hover
layer enhances and never gates.
-->
<template>
  <figure class="chart-trend">
    <figcaption v-if="title" class="chart-title">{{ title }}</figcaption>

    <div ref="plotEl" class="chart-plot" @pointermove="track" @pointerleave="clear">
      <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" role="img"
        :aria-label="description">
        <!-- Hairline, solid, one step off the surface: present but recessive. -->
        <g class="grid">
          <line v-for="tick of ticks" :key="tick.value"
            :x1="PAD.left" :x2="W - PAD.right" :y1="tick.y" :y2="tick.y"/>
        </g>

        <path class="area" :d="areaPath"/>
        <path class="line" :d="linePath"/>

        <template v-if="hovered != null">
          <line class="crosshair" :x1="x(hovered.index)" :x2="x(hovered.index)"
            :y1="PAD.top" :y2="H - PAD.bottom"/>
          <circle class="marker" :cx="x(hovered.index)" :cy="y(hovered.count)" r="4"/>
        </template>
      </svg>

      <div class="axis-y">
        <span v-for="tick of ticks" :key="tick.value"
          :style="{ top: `${(tick.y / H) * 100}%` }">{{ $n(tick.value, 'default') }}</span>
      </div>

      <div v-if="hovered != null" class="chart-tooltip" :style="tooltipStyle" role="status">
        <span class="tooltip-value">{{ $n(hovered.count, 'default') }}</span>
        <span class="tooltip-label">{{ hovered.label }}</span>
      </div>
    </div>

    <div class="axis-x">
      <span>{{ firstLabel }}</span>
      <span>{{ lastLabel }}</span>
    </div>

    <details class="chart-table">
      <summary>{{ $t('showTable') }}</summary>
      <table class="table">
        <thead>
          <tr><th>{{ $t('header.date') }}</th><th class="count-col">{{ $t('header.count') }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="point of points" :key="point.label">
            <td>{{ point.label }}</td>
            <td class="count-col">{{ $n(point.count, 'default') }}</td>
          </tr>
        </tbody>
      </table>
    </details>
  </figure>
</template>

<script setup>
import { DateTime } from 'luxon';
import { computed, ref, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';

defineOptions({ name: 'ChartTrend' });

const props = defineProps({
  // [{ date: '2026-09-19', count: 12 }], already gap-filled by the caller.
  points: { type: Array, required: true },
  title: { type: String, default: null },
  description: { type: String, default: '' }
});

const { n } = useI18n();

const W = 720;
const H = 200;
const PAD = { top: 12, right: 8, bottom: 8, left: 8 };

const max = computed(() => Math.max(1, ...props.points.map((p) => p.count)));

// Round the axis to a clean number so the ticks carry the values that are not
// directly labelled.
const ticks = computed(() => {
  const step = Math.max(1, Math.ceil(max.value / 2));
  const top = step * 2;
  return [0, step, top].map((value) => ({ value, y: yFor(value, top) }));
});

function yFor(value, top) {
  const usable = H - PAD.top - PAD.bottom;
  return H - PAD.bottom - (value / top) * usable;
}

const axisTop = computed(() => ticks.value[ticks.value.length - 1].value);
const y = (count) => yFor(count, axisTop.value);
const x = (index) => {
  const usable = W - PAD.left - PAD.right;
  const last = Math.max(1, props.points.length - 1);
  return PAD.left + (index / last) * usable;
};

const linePath = computed(() => props.points
  .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(2)} ${y(point.count).toFixed(2)}`)
  .join(' '));

const areaPath = computed(() => {
  if (props.points.length === 0) return '';
  const base = H - PAD.bottom;
  return `${linePath.value} L${x(props.points.length - 1).toFixed(2)} ${base} L${x(0).toFixed(2)} ${base} Z`;
});

// The dates arrive as plain days; render them in the reader's locale.
const label = (point) => DateTime.fromISO(point.date).toLocaleString(DateTime.DATE_MED);
const firstLabel = computed(() => (props.points.length ? label(props.points[0]) : ''));
const lastLabel = computed(() => (props.points.length ? label(props.points[props.points.length - 1]) : ''));

const plotEl = useTemplateRef('plotEl');
const hovered = ref(null);

// Snap to the nearest day rather than asking the reader to hit one.
const track = (event) => {
  const box = plotEl.value.getBoundingClientRect();
  if (box.width === 0 || props.points.length === 0) return;
  const ratio = (event.clientX - box.left) / box.width;
  const index = Math.min(props.points.length - 1,
    Math.max(0, Math.round(ratio * (props.points.length - 1))));
  const point = props.points[index];
  hovered.value = { index, count: point.count, label: label(point) };
};
const clear = () => { hovered.value = null; };

const tooltipStyle = computed(() => {
  const left = (x(hovered.value.index) / W) * 100;
  return {
    left: `${left}%`,
    // Keep the readout inside the plot at both ends instead of letting it
    // hang off the edge.
    transform: left > 70 ? 'translate(-100%, 0)' : left < 30 ? 'translate(0, 0)' : 'translate(-50%, 0)'
  };
});

defineExpose({ n });
</script>

<i18n lang="json5">
{
  "en": {
    "showTable": "Show the numbers",
    "header": {
      "date": "Date",
      "count": "Submissions"
    }
  }
}
</i18n>

<style lang="scss">
@import '../../assets/scss/variables';

.chart-trend {
  margin: 0 0 30px;

  .chart-title {
    color: $color-text;
    font-size: 15px;
    font-weight: 600;
    margin-bottom: 10px;
  }

  .chart-plot {
    position: relative;
    padding-left: 46px;

    svg { display: block; height: 200px; width: 100%; }
  }

  // Hairline and solid. Dashes read as data.
  .grid line { stroke: #e9e9f1; stroke-width: 1; } // gradient --gray-150

  .area { fill: #5d4ee0; fill-opacity: 0.1; }      // gradient --iris-600, a wash
  .line {
    fill: none;
    stroke: #5d4ee0;                               // gradient --iris-600, 5.78:1
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }

  .crosshair { stroke: #adadbf; stroke-width: 1; } // gradient --gray-400
  // The ring is the surface colour so the marker stays legible on the line,
  // and it is part of the hit target rather than decoration.
  .marker { fill: #5d4ee0; stroke: #ffffff; stroke-width: 2; }

  .axis-y {
    position: absolute;
    left: 0; top: 0; bottom: 0; width: 42px;

    span {
      color: $color-text-muted;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      position: absolute;
      right: 0;
      transform: translateY(-50%);
    }
  }

  .axis-x {
    color: $color-text-muted;
    display: flex;
    font-size: 11px;
    justify-content: space-between;
    margin: 4px 0 0 46px;
  }

  .chart-tooltip {
    background-color: #20202b;                     // gradient --gray-900
    border-radius: 6px;
    color: #ffffff;
    font-size: 12px;
    padding: 6px 10px;
    pointer-events: none;
    position: absolute;
    top: 0;
    white-space: nowrap;

    // The reader already knows the series; they came for the number.
    .tooltip-value { font-weight: 600; margin-right: 6px; }
    .tooltip-label { color: #cfcfdc; }             // gradient --gray-300
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
