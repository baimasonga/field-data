<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <fieldset :id="`builder-question-${modelValue.id}`" class="advanced-question" tabindex="-1">
    <legend>{{ modelValue.name || 'New question' }}</legend>
    <div class="builder-question-fields">
    <label>Type<select class="form-control" :value="modelValue.type" @change="set('type', $event.target.value)"><option v-for="type of types" :key="type">{{ type }}</option></select></label>
    <label>Name<input class="form-control" :value="modelValue.name" maxlength="64" @input="set('name', $event.target.value)"></label>
    <label>Label<input class="form-control" :value="modelValue.label" @input="set('label', $event.target.value)"></label>
    <label>Hint<input class="form-control" :value="modelValue.hint" @input="set('hint', $event.target.value)"></label>
<label v-if="modelValue.type.endsWith('_from_file')">CSV attachment filename<input class="form-control" :value="modelValue.sourceFile" @input="set('sourceFile', $event.target.value)"></label>
    <label>Entity property (save answer to)<input class="form-control" :value="modelValue.xlsExtra?.save_to || ''" @input="set('xlsExtra', { ...modelValue.xlsExtra, save_to: $event.target.value })"></label>
    <label>Required expression (blank, yes, or XPath)<input class="form-control" :value="requiredText" @input="set('required', $event.target.value === 'yes' ? true : $event.target.value)"></label>
    </div>
    <details>
<summary>Logic, translations and choices</summary>
      <label v-for="field of logicFields" :key="field">{{ field }}<input class="form-control" :value="modelValue[field]" @input="set(field, $event.target.value)"></label>
      <builder-expression :fields="fields" @apply="set($event.field, $event.value)"/>
      <p>Expressions use XLSForm XPath and ${field_name} references. PyXForm validates expressions before a form is published.</p>
      <builder-properties :model-value="modelValue.translations || {}" title="Translated labels" @update:model-value="set('translations', $event)"/>
      <builder-properties :model-value="modelValue.hintTranslations || {}" title="Translated hints" @update:model-value="set('hintTranslations', $event)"/>
      <details>
<summary>Advanced JSON editor</summary>
      <label>Translated labels (JSON language → text)<textarea class="form-control" :value="JSON.stringify(modelValue.translations || {})" @change="json('translations', $event.target.value)"></textarea></label>
      <label>Translated hints (JSON language → text)<textarea class="form-control" :value="JSON.stringify(modelValue.hintTranslations || {})" @change="json('hintTranslations', $event.target.value)"></textarea></label>
      </details>
      <template v-if="modelValue.type.startsWith('select_') && !modelValue.type.endsWith('_from_file')">
        <label>Reusable list name (or leave blank)<input class="form-control" :value="modelValue.listName" @input="set('listName', $event.target.value)"></label>
        <fieldset>
<legend>Cascading choices</legend>
          <label>Parent question<select v-model="cascadeField" class="form-control"><option v-for="name of fields" :key="name">{{ name }}</option></select></label>
          <label>Choice attribute<input v-model.trim="cascadeAttribute" class="form-control"></label>
          <button type="button" class="btn btn-default" :disabled="!cascadeField || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(cascadeAttribute)" @click="set('choiceFilter', `${cascadeAttribute}=\${${cascadeField}}`)">Apply cascade</button>
        </fieldset>
        <builder-choices :model-value="modelValue.choices || []" @update:model-value="set('choices', $event)"/>
        <details><summary>Advanced choice JSON</summary><label>Choices (JSON array of name, label, optional attributes and translations)<textarea class="form-control" rows="5" :value="JSON.stringify(modelValue.choices || [], null, 2)" @change="json('choices', $event.target.value)"></textarea></label></details>
      </template>
      <builder-properties :model-value="modelValue.xlsExtra || {}" title="Additional XLSForm columns" key-label="Column" @update:model-value="set('xlsExtra', $event)"/>
      <p v-if="error" role="alert">{{ error }}</p>
    </details>
    <template v-if="['group', 'repeat'].includes(modelValue.type)">
      <div v-for="(child, index) of modelValue.children || []" :key="child.id">
        <advanced-question :model-value="child" :fields="fields" @update:model-value="replaceChild(index, $event)"/>
        <button type="button" class="btn btn-default" :disabled="index === 0" @click="moveChild(index, -1)">Move child up</button>
        <button type="button" class="btn btn-default" :disabled="index === modelValue.children.length - 1" @click="moveChild(index, 1)">Move child down</button>
        <button type="button" class="btn btn-danger" @click="removeChild(index)">Remove child</button>
      </div>
      <button type="button" class="btn btn-default" @click="addChild">Add child question</button>
    </template>
  </fieldset>
</template>
<script setup>
import { computed, ref } from 'vue';
import BuilderProperties from './builder-properties.vue';
import BuilderChoices from './builder-choices.vue';
import BuilderExpression from './builder-expression.vue';

defineOptions({ name: 'AdvancedQuestion' });
const props = defineProps({ modelValue: { type: Object, required: true }, fields: { type: Array, default: () => [] } }); const emit = defineEmits(['update:modelValue']);
const types = ['text', 'integer', 'decimal', 'date', 'time', 'dateTime', 'select_one', 'select_multiple', 'note', 'geopoint', 'image', 'calculate', 'group', 'repeat', 'audio', 'video', 'barcode', 'geotrace', 'geoshape', 'range', 'file', 'start', 'end', 'today', 'deviceid', 'username', 'email', 'phonenumber', 'audit', 'start-geopoint', 'select_one_from_file', 'select_multiple_from_file'];
const logicFields = ['relevant', 'constraint', 'constraintMessage', 'calculation', 'choiceFilter', 'appearance', 'repeatCount'];
const cascadeField = ref(''); const cascadeAttribute = ref('');
const error = ref(''); const requiredText = computed(() => (props.modelValue.required === true ? 'yes' : props.modelValue.required || ''));
const set = (field, value) => { const q = { ...props.modelValue, [field]: value }; if (field === 'type' && ['group', 'repeat'].includes(value)) q.children ||= []; emit('update:modelValue', q); };
const json = (field, value) => { try { set(field, JSON.parse(value)); error.value = ''; } catch { error.value = 'Invalid JSON; the previous value is retained.'; } };
const replaceChild = (index, child) => { const children = [...props.modelValue.children]; children[index] = child; set('children', children); };
const removeChild = index => set('children', props.modelValue.children.filter((_, i) => i !== index));
const moveChild = (index, delta) => { const children = [...props.modelValue.children]; const [child] = children.splice(index, 1); children.splice(index + delta, 0, child); set('children', children); };
const addChild = () => set('children', [...(props.modelValue.children || []), { id: crypto.randomUUID(), type: 'text', name: '', label: '', hint: '', required: false }]);
</script>
<style>.advanced-question { border: 1px solid #cbd5e1; padding: 16px; margin: 12px 0; } .advanced-question label { display: block; margin: 8px 0; } .advanced-question legend { font-size: 16px; width: auto; }</style>
