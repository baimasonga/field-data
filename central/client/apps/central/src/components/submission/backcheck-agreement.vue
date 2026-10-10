<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.

Backcheck agreement (O5): the linked backchecks of this Form, each compared as
its comparison view does, added up by collector and by question.
Contract: docs/field-intelligence/O5-backcheck-agreement.md -->
<template>
  <section class="backcheck-agreement" aria-labelledby="backcheck-agreement-title">
    <h2 id="backcheck-agreement-title">Backcheck agreement</h2>
    <p class="section-lead">
      How often a revisit gave the same answers as the original Submission, from every linked backcheck of this Form.
      Only questions the Form asks are compared (not start and end times or calculations), or the mapped pairs when the
      backcheck used another Form. A difference is a reason to look, not a verdict: answers can change between visits,
      and a few backchecks say little.
    </p>
    <button type="button" class="btn btn-default" :aria-disabled="busy" @click="load">Refresh <spinner :state="busy"/></button>
    <p v-if="error" role="alert" class="backcheck-agreement-error">{{ error }}</p>

    <template v-if="result != null">
      <p class="backcheck-agreement-totals">
        {{ totals }}
        <template v-if="result.backchecks.truncated"> Only the most recent {{ result.backchecks.used }} were used.</template>
      </p>
      <p v-if="result.collectors.length === 0" class="backcheck-agreement-empty">
        No backcheck of this Form could be compared yet.
      </p>
      <template v-else>
        <h3>By collector</h3>
        <table class="table backcheck-agreement-collectors">
          <thead><tr><th>Collector</th><th>Backchecks with a difference</th><th>Answers that differ</th><th>Unanswered on either side</th></tr></thead>
          <tbody>
            <tr v-for="c of result.collectors" :key="c.actorId ?? 'unknown'">
              <td>{{ c.displayName ?? 'Unknown collector' }}</td>
              <td>{{ ratio(c.withDifferences, c.backchecks, 'backcheck') }}</td>
              <td>{{ ratio(c.different, c.fields, 'answer') }}</td>
              <td>{{ c.missing }}</td>
            </tr>
          </tbody>
        </table>
        <h3>By question</h3>
        <table class="table backcheck-agreement-questions">
          <thead><tr><th>Question</th><th>Answers that differ</th><th>Unanswered on either side</th></tr></thead>
          <tbody>
            <tr v-for="q of result.questions" :key="q.question">
              <td>{{ q.label }}<span v-if="q.question.startsWith('mapped:')" class="backcheck-agreement-mapped"> (mapped)</span></td>
              <td>{{ ratio(q.different, q.fields, 'answer') }}</td>
              <td>{{ q.missing }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </template>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue';

import Spinner from '../spinner.vue';
import useRequest from '../../composables/request';

defineOptions({ name: 'BackcheckAgreement' });
const props = defineProps({
  projectId: { type: [String, Number], required: true },
  xmlFormId: { type: String, required: true }
});
const { request, awaitingResponse: busy } = useRequest();
const result = ref(null); const error = ref('');

const REASONS = { 'source-integrity': 'failed the integrity check', 'size-limit': 'too large to compare',
  'no-mapping': 'answered on another Form with no field mapping yet', 'form-definition': 'Form version could not be read',
  'unsupported-xml': 'could not be read' };

const load = () => {
  error.value = '';
  return request({ method: 'GET', url: `/v1/projects/${props.projectId}/forms/${encodeURIComponent(props.xmlFormId)}/backcheck-agreement`, alert: false })
    .then(({ data }) => {
      if (data?.backchecks == null || !Array.isArray(data.collectors) || !Array.isArray(data.questions)) throw new Error('Unexpected response');
      result.value = data;
    })
    .catch(() => { result.value = null; error.value = 'Backcheck agreement could not be loaded. Try again.'; });
};
load();

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const ratio = (part, whole, word) => (whole === 0 ? `no ${word}s compared` : `${part} of ${plural(whole, word)} (${Math.round((100 * part) / whole)}%)`);
const totals = computed(() => {
  const { linked, compared, unavailable, notReadable } = result.value.backchecks;
  const parts = [`${plural(linked, 'linked backcheck')}, ${compared} compared.`];
  for (const [reason, n] of Object.entries(unavailable)) parts.push(`${n} not compared: ${REASONS[reason] ?? reason}.`);
  if (notReadable > 0) parts.push(`${notReadable} answered on a Form you may not read.`);
  return parts.join(' ');
});
</script>

<style lang="scss">
@import '../../assets/scss/variables';

.backcheck-agreement {
  margin: 24px 0;
  overflow-wrap: anywhere;
  .backcheck-agreement-error { color: $color-danger; }
  .backcheck-agreement-empty, .backcheck-agreement-mapped { color: $color-text-secondary; }
  .backcheck-agreement-totals { margin-top: 12px; }
  table { display: block; max-width: 100%; overflow-x: auto; }
}
</style>
