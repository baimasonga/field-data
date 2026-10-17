<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="investigation-instrument" aria-label="Targeted backcheck instrument">
    <h5>Targeted backcheck</h5>
    <p>Prepare neutral follow-up questions from this source's active investigation findings. Review and edit the questions, then choose a published form that can record the answers.</p>
    <button type="button" class="btn btn-default" :disabled="busy" @click="load">{{ data ? 'Refresh instrument' : 'Prepare targeted backcheck' }}</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="data">
      <p v-if="!data.items.length">No supported active finding for this source is attached to the investigation.</p>
      <p v-if="data.omitted">{{ data.omitted }} further findings omitted. This instrument offers at most 20 findings.</p>
      <p v-if="!data.canRequest">To request a visit, the investigation and project must be open, this must be the current case assigned to you for review, and it must have no pending backcheck. You also need permission to update its source.</p>
      <form v-if="data.items.length" @submit.prevent="save">
        <fieldset :disabled="busy || pending != null || generated != null || (!data.canRequest && !data.canGenerateForm)">
          <legend>Choose what to verify</legend>
          <label v-for="item of data.items" :key="item.findingId" class="instrument-check">
            <input v-model="selected" type="checkbox" :value="item.findingId"> {{ item.label }} · finding {{ item.findingId }} (rule version {{ item.ruleVersion }})
          </label>
          <button type="button" class="btn btn-default" :disabled="!selected.length" @click="draft">Draft verification questions</button>
        </fieldset>
        <fieldset :disabled="busy || pending != null || !data.canRequest">
          <label>Questions for the independent visit <textarea v-model="question" class="form-control" required maxlength="2000" rows="6"></textarea></label>
          <p v-if="selectionChanged">The selected checks changed. Draft the questions again before requesting a visit.</p>
          <p>These prompts use fixed templates. They do not copy earlier answers or establish wrongdoing. Check that your chosen form captures these questions. You can also generate a starting form from the selected templates and review its fields below.</p>
          <label>Response form <select v-model="formId" aria-label="Response form" class="form-control" required @change="chooseCollector">
            <option disabled value="">Choose a published form…</option>
            <option v-for="form of forms" :key="form.id" :value="form.xmlFormId">{{ form.name || form.xmlFormId }} ({{ form.xmlFormId }})</option>
          </select></label>
          <label>Independent collector <select v-model="collector" aria-label="Independent collector" class="form-control" required>
            <option disabled :value="null">Choose an eligible collector…</option>
            <option v-for="actor of assignees" :key="actor.id" :value="actor.id" :disabled="actor.original">{{ actor.name }} · {{ actor.pending ?? 0 }} open{{ actor.original ? ' · original collector unavailable' : actor.suggested ? ' · suggested' : '' }}</option>
          </select></label>
          <p v-if="formId && !assignees.some(actor => !actor.original)">No independent collector is assigned to this form. Assign an App User to it before refreshing.</p>
          <label>Visit due date (optional) <input v-model="due" class="form-control" type="date"></label>
        </fieldset>
        <button v-if="data.canRequest" type="submit" class="btn btn-primary" :disabled="busy || (!pending && (!selected.length || selectionChanged || !question.trim() || !formId || collector == null))">{{ pending ? 'Retry same backcheck request' : 'Request targeted backcheck' }}</button>
      </form>
      <button v-if="data.canGenerateForm && data.items.length && !generated && !createdForm" type="button" class="btn btn-default" :disabled="busy || pending != null || !selected.length" @click="generateForm">Generate response-form draft</button>
      <section v-if="generated" class="generated-form" aria-label="Generated response-form review">
        <h5>Review generated response form</h5>
        <p>This starting form uses the selected check templates. Review its labels, consent and location questions before creating a draft. Visit instructions remain separate.</p>
        <p>Unsaved generated edits stay in this inspection only. Download the XLSForm to keep them. Your existing builder draft is preserved.</p>
        <form-builder :key="generated.formId" :project-id="projectId" :initial-definition="generated" :persist-draft="false" @success="formCreated"/>
      </section>
      <p v-if="createdForm" role="status">Response-form draft created. <router-link :to="`/projects/${projectId}/forms/${encodeURIComponent(createdForm)}/draft`">Review and publish response-form draft</router-link>. Assign independent collectors to it, then refresh the instrument to choose the published form.</p>
    </template>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import useRequest from '../../composables/request';
import FormBuilder from '../form/builder.vue';

defineOptions({ name: 'FieldDataInvestigationInstrument' });
const props = defineProps({ base: { type: String, required: true }, projectId: { type: [String, Number], required: true }, caseId: { type: String, required: true } });
const emit = defineEmits(['requested', 'unavailable']); const { request } = useRequest();
const generated = ref(null); const createdForm = ref(null);
const data = ref(null); const forms = ref([]); const busy = ref(false); const error = ref(''); const pending = ref(null);
const selected = ref([]); const drafted = ref([]); const question = ref(''); const formId = ref(''); const collector = ref(null); const due = ref('');
let generation = 0;
const ids = value => JSON.stringify([...value].sort((a, b) => a - b));
const selectionChanged = computed(() => ids(selected.value) !== ids(drafted.value));
const assignees = computed(() => forms.value.find(form => form.xmlFormId === formId.value)?.assignees ?? []);
const chooseCollector = () => { collector.value = assignees.value.find(actor => actor.suggested && !actor.original)?.id ?? null; };
const load = async () => {
  generation += 1; const current = generation; generated.value = null; createdForm.value = null; busy.value = true; error.value = ''; data.value = null; forms.value = []; pending.value = null;
  selected.value = []; drafted.value = []; question.value = ''; formId.value = ''; collector.value = null; due.value = '';
  try {
    const value = (await request({ method: 'GET', url: `${props.base}/instrument`, alert: false })).data;
    if (!value || value.templateVersion !== 'investigation-backcheck@1' || !Number.isInteger(value.investigationRevision) || value.investigationRevision < 1 || !Number.isInteger(value.caseRevision) || value.caseRevision < 1 ||
      typeof value.canRequest !== 'boolean' || typeof value.canGenerateForm !== 'boolean' || !Array.isArray(value.items) || value.items.length > 20 || !value.items.every(item => Number.isSafeInteger(item.findingId) && item.findingId > 0 && Number.isInteger(item.ruleVersion) && typeof item.label === 'string' && typeof item.question === 'string')) throw new Error('Invalid instrument');
    const available = value.canRequest && value.items.length ? (await request({ method: 'GET', url: `/v1/field-data/review-queue/${encodeURIComponent(props.caseId)}/backcheck-forms`, alert: false })).data : [];
    if (!Array.isArray(available) || !available.every(form => typeof form.xmlFormId === 'string' && Array.isArray(form.assignees))) throw new Error('Invalid forms');
    if (current === generation) { data.value = value; forms.value = available; }
  } catch (failure) {
    if (current === generation && [403, 404].includes(failure.response?.status)) emit('unavailable');
    else if (current === generation) error.value = 'The instrument could not be prepared. Refresh to check the source, findings and permissions.';
  } finally { if (current === generation) busy.value = false; }
};
const draft = () => {
  const prompts = [...new Set(data.value.items.filter(item => selected.value.includes(item.findingId)).map(item => item.question))];
  question.value = ['Carry out a separate follow-up visit with consent. Record uncertainty and legitimate explanations.', ...prompts].join('\n\n');
  drafted.value = [...selected.value];
};
const generateForm = async () => {
  if (busy.value || pending.value || !selected.value.length) return;
  const current = generation; busy.value = true; error.value = ''; generated.value = null;
  try {
    const value = (await request({
      method: 'POST', url: `${props.base}/instrument/form-definition`, data: {
        investigationRevision: data.value.investigationRevision, caseRevision: data.value.caseRevision, templateVersion: data.value.templateVersion, findingIds: [...selected.value]
      }, alert: false
    })).data;
    if (value?.templateVersion !== data.value?.templateVersion || value?.definition?.schemaVersion !== 2 || typeof value.definition.formId !== 'string' || !Array.isArray(value.definition.questions) || !value.definition.questions.length || value.definition.questions.length > 12) throw new Error('Invalid generated form');
    if (current === generation) generated.value = value.definition;
  } catch (failure) {
    if (current === generation && [403, 404].includes(failure.response?.status)) emit('unavailable');
    else if (current === generation) error.value = 'The response form could not be generated. Refresh the instrument to recheck its findings and revisions.';
  } finally { if (current === generation) busy.value = false; }
};
const formCreated = form => { createdForm.value = form.xmlFormId; generated.value = null; };
const save = async () => {
  if (busy.value || !data.value) return; const current = generation; busy.value = true; error.value = '';
  pending.value ??= {
    revision: data.value.caseRevision, body: {
      requestId: crypto.randomUUID(), investigationRevision: data.value.investigationRevision,
      templateVersion: data.value.templateVersion, findingIds: [...selected.value], responseXmlFormId: formId.value, assignedTo: collector.value,
      question: question.value.trim(), dueAt: due.value ? `${due.value}T23:59:59Z` : null
    }
  };
  try {
    await request({ method: 'POST', url: `${props.base}/instrument/backchecks`, data: pending.value.body, headers: { 'If-Match': `"review-case-${pending.value.revision}"` }, alert: false });
    if (current === generation) { pending.value = null; data.value = null; emit('requested'); }
  } catch (failure) {
    if (current === generation && [403, 404].includes(failure.response?.status)) {
      data.value = null; forms.value = []; pending.value = null; selected.value = []; drafted.value = []; question.value = ''; formId.value = ''; collector.value = null; due.value = '';
      emit('unavailable');
    } else if (current === generation) error.value = [400, 409, 412, 428].includes(failure.response?.status)
      ? 'The case, investigation, finding or permissions changed. Refresh the instrument before making another request.'
      : 'The request could not be confirmed. Retry the same backcheck request or refresh the instrument.';
  } finally { if (current === generation) busy.value = false; }
};
onBeforeUnmount(() => { generation += 1; pending.value = null; data.value = null; forms.value = []; generated.value = null; createdForm.value = null; });
</script>
<style scoped>
.investigation-instrument { margin: 16px 0; padding: 12px; border: 1px solid #dce5e9; } label { display: block; margin: 10px 0; font-weight: normal; } legend { font-size: 15px; } p,label { overflow-wrap: anywhere; } select { max-width: 100%; } button { white-space: normal; }
</style>
