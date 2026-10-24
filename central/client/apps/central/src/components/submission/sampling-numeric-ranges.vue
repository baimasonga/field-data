<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <fieldset class="sampling-numeric-ranges">
    <legend>Numeric grouping</legend>
    <label>Group numeric answers
      <select class="form-control" :value="modelValue.length ? 'ranges' : 'exact'" @change="emit('update:modelValue', $event.target.value === 'ranges' ? [''] : [])">
        <option value="exact">Exact answers</option><option value="ranges">Numeric ranges</option>
      </select>
    </label>
    <template v-if="modelValue.length">
      <p>Enter increasing boundaries using ordinary decimal numbers, for example 18 then 35. Each boundary starts the next range. Missing answers remain separate; invalid numeric answers stop the draw. Changing ranges clears different rates below.</p>
      <div v-for="(boundary, index) of modelValue" :key="index" class="sampling-numeric-boundary">
        <label>Range boundary {{ index + 1 }}
          <input class="form-control" inputmode="decimal" maxlength="64" required :value="boundary" @input="emit('update:modelValue', modelValue.map((value, i) => i === index ? $event.target.value : value))">
        </label>
        <button class="btn btn-link" type="button" :disabled="modelValue.length === 1" :aria-label="`Remove range boundary ${index + 1}`" @click="emit('update:modelValue', modelValue.filter((_, i) => i !== index))">Remove</button>
      </div>
      <button class="btn btn-default" type="button" :disabled="modelValue.length >= 98" @click="emit('update:modelValue', [...modelValue, ''])">Add boundary</button>
      <p v-if="labels.length">Ranges: {{ labels.join('; ') }}; Missing answer.</p>
    </template>
  </fieldset>
</template>
<script setup>
import { computed } from 'vue';
import numericRangeLabels from '../../util/sampling-ranges';
defineOptions({ name: 'SamplingNumericRanges' });
const props = defineProps({ modelValue: { type: Array, required: true } });
const emit = defineEmits(['update:modelValue']);
const labels = computed(() => numericRangeLabels(props.modelValue) ?? []);
</script>
<style lang="scss">
.sampling-numeric-ranges {
  width: 100%; min-width: 0;
  legend { font-size: 15px; margin-bottom: 6px; }
  .sampling-numeric-boundary { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin-bottom: 8px; }
}
</style>
