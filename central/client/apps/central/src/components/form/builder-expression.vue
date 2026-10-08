<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <fieldset>
<legend>Build a condition</legend>
    <label>Apply to<select v-model="target" class="form-control"><option value="relevant">Show question when</option><option value="required">Require answer when</option><option value="constraint">Accept answer when</option><option value="choiceFilter">Filter choices when</option><option value="calculation">Calculate answer</option><option value="repeatCount">Repeat count</option></select></label>
    <label>Field<select v-model="field" aria-label="Field" class="form-control"><option value=".">This answer</option><option v-for="name of fields" :key="name" :value="name">{{ name }}</option></select></label>
    <label>Comparison<select v-model="operator" class="form-control"><option v-for="op of ['=', '!=', '>', '>=', '<', '<=', 'selected', '+', '-', '*', 'div']" :key="op">{{ op }}</option></select></label>
    <label>Value<input v-model="value" class="form-control"></label>
    <label><input v-model="numeric" type="checkbox">Numeric value</label>
    <button type="button" class="btn btn-default" :disabled="numeric && !validNumber" @click="apply">Apply condition</button>
    <p v-if="error" role="alert">{{ error }}</p>
  </fieldset>
</template>
<script setup>
import { computed, ref } from 'vue';

defineOptions({ name: 'BuilderExpression' });
defineProps({ fields: { type: Array, default: () => [] } }); const emit = defineEmits(['apply']);
const target = ref('relevant'); const field = ref('.'); const operator = ref('='); const value = ref(''); const numeric = ref(false); const error = ref('');
const validNumber = computed(() => /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(value.value));
const literal = text => { if (!text.includes("'")) return `'${text}'`; if (!text.includes('"')) return `"${text}"`; return `concat(${text.split("'").map(part => `'${part}'`).join(', "\'", ')})`; };
const apply = () => {
  if (numeric.value && !validNumber.value) return;
  const left = field.value === '.' ? '.' : `\${${field.value}}`; const right = numeric.value ? value.value : literal(value.value);
  emit('apply', { field: target.value, value: operator.value === 'selected' ? `selected(${left}, ${right})` : `${left} ${operator.value} ${right}` }); error.value = '';
};
</script>
