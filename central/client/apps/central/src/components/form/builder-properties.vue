<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <fieldset>
    <legend>{{ title }}</legend>
    <div v-for="(value, name) of modelValue" :key="name">
      <label>{{ name }}<input class="form-control" :value="value" @input="update(name, $event.target.value)"></label>
      <button type="button" class="btn btn-default" @click="remove(name)">Remove {{ name }}</button>
    </div>
    <label>{{ keyLabel }}<input v-model.trim="newKey" class="form-control"></label>
    <button type="button" class="btn btn-default" :disabled="!newKey || Object.hasOwn(modelValue, newKey)" @click="add">Add {{ keyLabel }}</button>
  </fieldset>
</template>
<script setup>
import { ref } from 'vue';

defineOptions({ name: 'BuilderProperties' });
const props = defineProps({ modelValue: { type: Object, default: () => ({}) }, title: { type: String, required: true }, keyLabel: { type: String, default: 'Language' } });
const emit = defineEmits(['update:modelValue']); const newKey = ref('');
const update = (name, value) => emit('update:modelValue', { ...props.modelValue, [name]: value });
const remove = name => emit('update:modelValue', Object.fromEntries(Object.entries(props.modelValue).filter(([key]) => key !== name)));
const add = () => { if (['__proto__', 'constructor', 'prototype'].includes(newKey.value)) return; update(newKey.value, ''); newKey.value = ''; };
</script>
