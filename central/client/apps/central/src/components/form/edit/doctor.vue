<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.

Survey doctor (S1): static checks of the draft (or, with no draft, the published
version). It reports what it can establish from the form definition and says
what it could not check. It never blocks anything.
Contract: docs/field-intelligence/S1-survey-doctor.md -->
<template>
  <form-edit-section id="form-edit-doctor">
    <template #title>Form check</template>
    <template #subtitle>
      Checks the {{ target === 'draft' ? 'Draft' : 'published' }} form's logic for questions that can never be shown, answers that can never be given, and calculations that cannot settle. It does not prove a form is correct.
    </template>
    <template #actions>
      <button type="button" class="btn btn-default btn-sm" :aria-disabled="awaitingResponse" @click="load">
        {{ report == null && !error ? 'Check form' : 'Check again' }} <spinner :state="awaitingResponse"/>
      </button>
    </template>
    <template #body>
      <p v-if="error" role="alert" class="doctor-error">{{ error }}</p>
      <p v-else-if="report == null && !awaitingResponse" class="doctor-idle">Not checked yet.</p>
      <template v-else-if="report != null">
        <p class="doctor-summary" role="status">
          <span :class="report.summary.errors > 0 ? 'doctor-count-error' : ''">{{ plural(report.summary.errors, 'error') }}</span> ·
          {{ plural(report.summary.warnings, 'warning') }} ·
          {{ plural(report.summary.notes, 'note') }}
          <span class="doctor-scope">({{ plural(report.summary.questions, 'question') }}, {{ plural(report.summary.expressions, 'expression') }} checked)</span>
        </p>
        <p v-if="report.summary.errors === 0 && report.summary.warnings === 0" class="doctor-clean">
          No errors or warnings found.
        </p>

        <template v-for="group of groups" :key="group.severity">
          <details v-if="group.items.length > 0" class="doctor-group" :class="`doctor-${group.severity}`" :open="group.severity !== 'note'">
            <summary>{{ group.title }} ({{ group.items.length }})</summary>
            <ul class="doctor-list">
              <li v-for="(f, i) of group.items" :key="i" class="doctor-finding">
                <div class="doctor-head">
                  <span :class="icon(f.severity)" aria-hidden="true"></span>
                  <code class="doctor-path">{{ f.path }}</code>
                  <span class="doctor-code">{{ CODE_NAMES[f.code] ?? f.code }}</span>
                </div>
                <p class="doctor-message">{{ f.message }}</p>
                <p v-if="f.expression" class="doctor-expression"><span>{{ f.attribute }}:</span> <code>{{ f.expression.trim() }}</code></p>
              </li>
            </ul>
          </details>
        </template>

        <details v-if="report.notChecked.length > 0" class="doctor-group doctor-not-checked">
          <summary>Not checked ({{ report.notChecked.reduce((n, x) => n + x.paths.length, 0) }})</summary>
          <ul class="doctor-list">
            <li v-for="item of report.notChecked" :key="item.reason">
              {{ NOT_CHECKED[item.reason] ?? item.reason }}
              <code v-for="p of item.paths" :key="p" class="doctor-path">{{ p }}</code>
            </li>
          </ul>
        </details>
      </template>
    </template>
  </form-edit-section>
</template>

<script setup>
import { computed, ref, watch } from 'vue';

import FormEditSection from './section.vue';
import Spinner from '../../spinner.vue';

import useRequest from '../../../composables/request';
import { apiPaths } from '../../../util/request';

defineOptions({ name: 'FormEditDoctor' });
const props = defineProps({
  projectId: { type: String, required: true },
  xmlFormId: { type: String, required: true },
  target: { type: String, default: 'draft' },
  // Changes when the definition changes, so the check is run again.
  definitionKey: { type: String, default: null }
});
const emit = defineEmits(['report']);
const { request, awaitingResponse } = useRequest();

const CODE_NAMES = {
  'unknown-reference': 'Unknown question',
  cycle: 'Depends on itself',
  'never-shown': 'Never shown',
  'impossible-constraint': 'Impossible constraint',
  'unanswerable-required': 'Cannot be answered',
  'duplicate-choice': 'Duplicate choice',
  'forward-reference': 'Depends on a later question',
  'missing-translation': 'Missing translation',
  'duplicate-choice-label': 'Choices look the same',
  'empty-choice-list': 'No choices',
  'number-without-range': 'No range'
};
const NOT_CHECKED = {
  'relevance-not-evaluated': 'Relevance using functions the check does not model:',
  'external-or-filtered-choices': 'Choices from a file, a filter or a search, not checked for missing values:',
  'unreadable-expression': 'Expressions the check could not read:'
};

const report = ref(null); const error = ref('');
const load = () => {
  const base = apiPaths.form(props.projectId, props.xmlFormId);
  return request({ method: 'GET', url: props.target === 'draft' ? `${base}/draft/doctor` : `${base}/doctor`, alert: false })
    .then(({ data }) => {
      report.value = data; error.value = '';
      emit('report', data);
    })
    .catch((e) => {
      report.value = null;
      error.value = e.response?.data?.message || 'The form could not be checked.';
      emit('report', null);
    });
};
// The draft is checked as soon as it is shown and whenever it changes. The
// published version is checked on request: it is what the page shows right
// after publishing, when nothing about it needs attention.
watch(() => [props.target, props.definitionKey], () => {
  report.value = null; error.value = '';
  if (props.target === 'draft') load();
}, { immediate: true });

const groups = computed(() => [
  { severity: 'error', title: 'Errors', items: report.value.findings.filter((f) => f.severity === 'error') },
  { severity: 'warning', title: 'Warnings', items: report.value.findings.filter((f) => f.severity === 'warning') },
  { severity: 'note', title: 'Notes', items: report.value.findings.filter((f) => f.severity === 'note') }
]);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const icon = (severity) => (severity === 'error' ? 'icon-times-circle'
  : severity === 'warning' ? 'icon-exclamation-triangle' : 'icon-info-circle');
</script>

<style lang="scss">
@import '../../../assets/scss/variables';

#form-edit-doctor {
  overflow-wrap: anywhere;

  .doctor-summary { margin-bottom: 8px; }
  .doctor-count-error { color: $color-danger; font-weight: bold; }
  .doctor-scope { color: $color-text-secondary; }
  .doctor-clean { color: $color-success; }
  .doctor-error { color: $color-danger; }
  .doctor-group { margin: 8px 0; summary { cursor: pointer; font-weight: bold; } }
  .doctor-list { list-style: none; margin: 6px 0 0; padding: 0; }
  .doctor-finding { border-left: 3px solid #e9e9f1; margin: 8px 0; padding-left: 10px; }
  .doctor-error .doctor-finding { border-left-color: $color-danger; }
  .doctor-warning .doctor-finding { border-left-color: $color-warning; }
  .doctor-head { align-items: baseline; display: flex; flex-wrap: wrap; gap: 6px; }
  .doctor-code { color: $color-text-secondary; font-size: 12px; }
  .doctor-message { margin: 4px 0; }
  .doctor-expression { color: $color-text-secondary; font-size: 12px; margin: 0; code { white-space: pre-wrap; } }
  .doctor-not-checked .doctor-path { margin-left: 6px; }
}
</style>
