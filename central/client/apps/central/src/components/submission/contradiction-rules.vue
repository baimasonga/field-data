<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.

Answer-contradiction rules (F1) for one Form. Reviewers see the rules; project
managers write them. A rule lists answers that should not occur together, and
must say at least one ordinary reason they might. -->
<template>
  <section class="contradiction-rules" aria-labelledby="contradiction-rules-title">
    <h2 id="contradiction-rules-title">Answer contradiction rules</h2>
    <p class="section-lead">Each rule lists answers that should not all be true together. Running the checks records every Submission that matches as a finding for review. Collectors never see these rules.</p>
    <p v-if="error" role="alert" class="rule-error">{{ error }}</p>
    <p v-if="loaded && rules.length === 0 && editing == null">No rules yet.</p>

    <ul class="rule-list">
      <li v-for="rule of rules" :key="rule.id" class="rule" :class="{ inactive: !rule.active }">
        <div class="rule-head">
          <strong>{{ rule.title }}</strong>
          <span class="rule-meta">v{{ rule.version }}{{ rule.active ? '' : ' · inactive' }}</span>
        </div>
        <p class="rule-conditions">Flags when {{ rule.conditions.map(describeCondition).join(' and ') }}.</p>
        <p v-if="!rule.status.usable" class="rule-unusable">
          Not run: the current Form version no longer has {{ rule.status.missing?.length ? rule.status.missing.join(', ') : 'what this rule checks' }}. Edit the rule to match the Form.
        </p>
        <div v-if="canManage" class="rule-actions">
          <button type="button" class="btn btn-default btn-sm" :disabled="busy" @click="edit(rule)">Edit</button>
          <button v-if="rule.active" type="button" class="btn btn-default btn-sm" :disabled="busy" @click="deactivate(rule)">Deactivate</button>
        </div>
      </li>
    </ul>

    <button v-if="canManage && editing == null" type="button" class="btn btn-default" :disabled="busy || !loaded" @click="edit(null)">New rule</button>

    <form v-if="editing != null" class="rule-editor" @submit.prevent="save">
      <h3>{{ editing.id == null ? 'New rule' : 'Edit rule' }}</h3>
      <label>Title <input v-model="editing.title" class="form-control" maxlength="120" required></label>

      <fieldset>
        <legend>Flag a Submission when all of these hold</legend>
        <div v-for="(row, i) of editing.conditions" :key="i" class="condition">
          <label>Kind
            <select v-model="row.kind" class="form-control" :aria-label="`Condition ${i + 1} kind`" @change="row.op = '='">
              <option value="field">An answer</option>
              <option value="count" :disabled="shape.repeats.length === 0">A count of repeat entries</option>
            </select>
          </label>
          <template v-if="row.kind === 'field'">
            <label>Question
              <select v-model="row.field" class="form-control" :aria-label="`Condition ${i + 1} question`" required @change="resetOperator(row)">
                <option value="" disabled>Choose a question</option>
                <option v-for="f of shape.top" :key="f.path" :value="f.path">{{ f.path }}</option>
              </select>
            </label>
            <condition-target :row="row" :index="i" :field="fieldAt(row.field)" :candidates="shape.top"/>
          </template>
          <template v-else>
            <label>Repeat
              <select v-model="row.repeat" class="form-control" :aria-label="`Condition ${i + 1} repeat`" required @change="row.where = []">
                <option value="" disabled>Choose a repeat</option>
                <option v-for="r of shape.repeats" :key="r" :value="r">{{ r }}</option>
              </select>
            </label>
            <div v-for="(w, j) of row.where" :key="j" class="where">
              <label>Entries where
                <select v-model="w.field" class="form-control" :aria-label="`Condition ${i + 1} filter ${j + 1} question`" required @change="resetOperator(w)">
                  <option value="" disabled>Choose a question</option>
                  <option v-for="f of shape.inRepeat(row.repeat)" :key="f.path" :value="f.path">{{ f.path }}</option>
                </select>
              </label>
              <condition-target :row="w" :index="i" :field="fieldAt(w.field)" :candidates="shape.inRepeat(row.repeat)"/>
              <button type="button" class="btn btn-link" @click="row.where.splice(j, 1)">Remove filter</button>
            </div>
            <button v-if="row.repeat && row.where.length < 5" type="button" class="btn btn-link" @click="row.where.push(blankWhere())">Only count entries where…</button>
            <condition-target :row="row" :index="i" :field="{ path: '', type: 'int' }" :candidates="shape.top" :operators="COUNT_OPERATORS"/>
          </template>
          <button v-if="editing.conditions.length > 1" type="button" class="btn btn-link" @click="editing.conditions.splice(i, 1)">Remove condition</button>
        </div>
        <button v-if="editing.conditions.length < 10" type="button" class="btn btn-default btn-sm" @click="editing.conditions.push(blankCondition())">Add condition</button>
      </fieldset>

      <label>What the conflict means <textarea v-model="editing.explanation" class="form-control" rows="2" maxlength="2000" required></textarea></label>
      <label>Ordinary reasons these answers could both be true (one per line, at least one)
        <textarea v-model="editing.benign" class="form-control" rows="3" required></textarea>
      </label>
      <label>What a reviewer should do <input v-model="editing.nextStep" class="form-control" maxlength="1000" required></label>
      <div class="rule-actions">
        <button type="submit" class="btn btn-primary" :disabled="busy">Save rule</button>
        <button type="button" class="btn btn-default" :disabled="busy" @click="editing = null">Cancel</button>
      </div>
    </form>
  </section>
</template>

<script setup>
import { computed, defineComponent, h, ref } from 'vue';
import useRequest from '../../composables/request';
import {
  COUNT_OPERATORS, OPERATOR_LABELS, blankCondition, blankWhere, canCompareWithQuestion, comparableWith,
  describeCondition, formShape, fromEditor, operatorsFor, takesValue, toEditor
} from '../../util/contradiction-rules';

defineOptions({ name: 'ContradictionRules' });
const props = defineProps({
  projectId: { type: String, required: true },
  xmlFormId: { type: String, required: true },
  canManage: Boolean
});
const emit = defineEmits(['changed']);
const { request } = useRequest();
const base = () => `/v1/projects/${props.projectId}/forms/${encodeURIComponent(props.xmlFormId)}`;

const rules = ref([]); const fields = ref([]); const loaded = ref(false); const busy = ref(false);
const error = ref(''); const editing = ref(null);
const shape = computed(() => formShape(fields.value));
const fieldAt = (path) => fields.value.map((f) => ({ ...f, selectMultiple: f.selectMultiple === true })).find((f) => f.path === path) ?? null;

// The operator and what it is compared with, shared by answers, counts and count filters.
const ConditionTarget = defineComponent({
  props: { row: Object, index: Number, field: Object, candidates: Array, operators: Array },
  setup(p) {
    return () => {
      const ops = p.operators ?? operatorsFor(p.field);
      const others = comparableWith(p.field, p.candidates);
      const label = `Condition ${p.index + 1}`;
      const children = [h('label', ['Test ', h('select', {
        class: 'form-control', 'aria-label': `${label} test`, value: p.row.op,
        onChange: (e) => { p.row.op = e.target.value; if (!canCompareWithQuestion(p.row.op)) p.row.mode = 'value'; }
      }, ops.map((op) => h('option', { value: op }, OPERATOR_LABELS[op]))) ])];
      if (takesValue(p.row.op)) {
        if (canCompareWithQuestion(p.row.op) && others.length > 0) {
          children.push(h('label', ['Compare with ', h('select', {
            class: 'form-control', 'aria-label': `${label} compare with`, value: p.row.mode,
            onChange: (e) => { p.row.mode = e.target.value; }
          }, [h('option', { value: 'value' }, 'a value'), h('option', { value: 'other' }, 'another question')])]));
        }
        children.push(p.row.mode === 'other'
          ? h('label', ['Question ', h('select', {
            class: 'form-control', 'aria-label': `${label} other question`, value: p.row.otherField, required: true,
            onChange: (e) => { p.row.otherField = e.target.value; }
          }, [h('option', { value: '', disabled: true }, 'Choose a question'), ...others.map((o) => h('option', { value: o.path }, o.path))])])
          : h('label', ['Value ', h('input', {
            class: 'form-control', 'aria-label': `${label} value`, value: p.row.value, required: true,
            onInput: (e) => { p.row.value = e.target.value; }
          })]));
      }
      return h('div', { class: 'condition-target' }, children);
    };
  }
});

const load = async () => {
  error.value = '';
  try {
    const [r, f] = await Promise.all([
      request({ method: 'GET', url: `${base()}/contradiction-rules`, alert: false }),
      request({ method: 'GET', url: `${base()}/fields`, alert: false })
    ]);
    rules.value = r.data; fields.value = f.data; loaded.value = true;
  } catch (e) {
    error.value = e.response?.data?.message || 'The rules could not be loaded.';
  }
};
load();

// A different question may not support the test chosen for the last one.
const resetOperator = (row) => {
  const ops = operatorsFor(fieldAt(row.field));
  if (!ops.includes(row.op)) row.op = ops[0];
  if (!canCompareWithQuestion(row.op)) row.mode = 'value';
  row.otherField = '';
};

const edit = (rule) => {
  error.value = '';
  editing.value = rule == null
    ? { id: null, title: '', explanation: '', benign: '', nextStep: '', conditions: [blankCondition()] }
    : { id: rule.id, revision: rule.revision, active: rule.active, title: rule.title, explanation: rule.explanation,
      benign: rule.benignExplanations.join('\n'), nextStep: rule.nextStep, conditions: toEditor(rule.conditions) };
};

const save = async () => {
  const e = editing.value;
  const data = {
    title: e.title, explanation: e.explanation, nextStep: e.nextStep, active: e.active !== false,
    benignExplanations: e.benign.split('\n').map((line) => line.trim()).filter((line) => line !== ''),
    conditions: fromEditor(e.conditions)
  };
  busy.value = true; error.value = '';
  try {
    await (e.id == null
      ? request({ method: 'POST', url: `${base()}/contradiction-rules`, data, alert: false })
      : request({ method: 'PUT', url: `${base()}/contradiction-rules/${e.id}`, headers: { 'If-Match': `"rule-${e.revision}"` }, data, alert: false }));
    editing.value = null; await load(); emit('changed');
  } catch (err) {
    const message = err.response?.data?.message || 'The rule could not be saved.';
    // Reload the rule another manager changed; the editor keeps this person's draft.
    if (err.response?.status === 412) await load();
    error.value = message;
  } finally { busy.value = false; }
};

const deactivate = async (rule) => {
  busy.value = true; error.value = '';
  try {
    await request({ method: 'DELETE', url: `${base()}/contradiction-rules/${rule.id}`, headers: { 'If-Match': `"rule-${rule.revision}"` }, alert: false });
    await load(); emit('changed');
  } catch (err) {
    error.value = err.response?.data?.message || 'The rule could not be deactivated.';
  } finally { busy.value = false; }
};
</script>

<style lang="scss">
@import '../../assets/scss/variables';

.contradiction-rules {
  margin: 0 0 34px;
  overflow-wrap: anywhere;

  .rule-list { list-style: none; margin: 0 0 12px; padding: 0; }
  .rule { border: 1px solid #e9e9f1; border-radius: 6px; margin-bottom: 10px; padding: 12px 14px; }
  .rule.inactive { border-style: dashed; }
  .rule-head { display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; }
  .rule-meta { color: $color-text-muted; font-size: 12px; }
  .rule-conditions { color: $color-text-secondary; font-size: 13px; margin: 6px 0; }
  .rule-unusable { color: #a86f14; font-size: 13px; margin: 6px 0; }
  .rule-error { color: #b42318; }
  .rule-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .rule-editor {
    border-top: 1px solid #e9e9f1; margin-top: 12px; padding-top: 12px;
    label { display: block; font-weight: normal; margin: 8px 0; }
    fieldset { min-width: 0; }
  }
  .condition { border-left: 3px solid #e9e9f1; margin: 10px 0; padding-left: 10px; }
  .where { margin-left: 12px; }
  .condition-target { display: flex; flex-wrap: wrap; gap: 0 12px; label { flex: 1 1 180px; } }
}
</style>
