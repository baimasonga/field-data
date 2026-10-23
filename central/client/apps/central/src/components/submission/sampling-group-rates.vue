<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <fieldset class="sampling-group-rates">
    <legend>Different rates by answer (optional)</legend>
    <p>Other answers use the default share below. Percentages round up within each collector and answer group; the minimum still applies. Rules for answers not yet received also apply to future draws.</p>
    <div v-for="(rule, index) of modelValue" :key="index" class="sampling-group-rate">
      <label>Group rate target
        <select class="form-control" :value="rule.value === null ? 'missing' : 'answer'" @change="update(index, 'value', $event.target.value === 'missing' ? null : '')">
          <option value="answer">Answer</option><option value="missing">Missing answer</option>
        </select>
      </label>
      <label v-if="rule.value !== null">Group rate answer
        <input class="form-control" :value="rule.value" maxlength="200" required @input="update(index, 'value', $event.target.value)">
      </label>
      <label>Group rate percentage
        <input class="form-control" type="number" min="1" max="100" step="1" required :value="rule.rate" @input="update(index, 'rate', Number($event.target.value))">
      </label>
      <button class="btn btn-link" type="button" :aria-label="`Remove group rate ${index + 1}`" @click="emit('update:modelValue', modelValue.filter((_, i) => i !== index))">Remove</button>
    </div>
    <button class="btn btn-default" type="button" :disabled="modelValue.length >= 100" @click="emit('update:modelValue', [...modelValue, { value: '', rate: 100 }])">Add group rate</button>
  </fieldset>
</template>
<script setup>
defineOptions({ name: 'SamplingGroupRates' });
const props = defineProps({ modelValue: { type: Array, required: true } });
const emit = defineEmits(['update:modelValue']);
const update = (index, key, value) => emit('update:modelValue', props.modelValue.map((rule, i) => (i === index ? { ...rule, [key]: value } : rule)));
</script>
<style lang="scss">
.sampling-group-rates {
  width: 100%; min-width: 0;
  legend { font-size: 15px; margin-bottom: 6px; }
  .sampling-group-rate { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin-bottom: 8px; }
}
</style>
