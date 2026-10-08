<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <fieldset>
<legend>Choices</legend>
    <div v-for="(choice, index) of modelValue" :key="index">
      <label>Choice name<input class="form-control" :value="choice.name" @input="update(index, 'name', $event.target.value)"></label>
      <label>Choice label<input class="form-control" :value="choice.label" @input="update(index, 'label', $event.target.value)"></label>
      <builder-properties :model-value="choice.translations || {}" title="Choice translations" @update:model-value="update(index, 'translations', $event)"/>
      <builder-properties :model-value="choice.attributes || {}" title="Cascade attributes" key-label="Attribute" @update:model-value="update(index, 'attributes', $event)"/>
      <button type="button" class="btn btn-default" @click="remove(index)">Remove choice</button>
    </div>
    <button type="button" class="btn btn-default" @click="emit('update:modelValue', [...modelValue, { name: '', label: '' }])">Add choice</button>
  </fieldset>
</template>
<script setup>
import BuilderProperties from './builder-properties.vue';

defineOptions({ name: 'BuilderChoices' });
const props = defineProps({ modelValue: { type: Array, default: () => [] } }); const emit = defineEmits(['update:modelValue']);
const update = (index, field, value) => emit('update:modelValue', props.modelValue.map((choice, i) => (i === index ? { ...choice, [field]: value } : choice)));
const remove = index => emit('update:modelValue', props.modelValue.filter((_, i) => i !== index));
</script>
