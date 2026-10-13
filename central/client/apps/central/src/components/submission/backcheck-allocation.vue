<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section v-if="data" class="backcheck-allocation" aria-labelledby="backcheck-allocation-title">
    <h3 id="backcheck-allocation-title">Automatic independent assignment</h3>
    <p>
Assign sampled Submissions to the least-loaded eligible App User, never the original collector.
      Capacity counts all their pending backchecks. Manual requests can override these limits.
</p>
    <p v-if="data.policy" role="status">{{ data.policy.enabled ? 'Enabled' : 'Paused' }} · response Form: {{ data.policy.settings.responseXmlFormId }}</p>
    <p v-else>No automatic assignment policy configured.</p>
    <form v-if="canConfigure" @submit.prevent="save">
      <label>Automatic response Form
        <select v-model="settings.responseXmlFormId" class="form-control" required @change="loadCollectors">
          <option value="" disabled>Choose a response Form</option>
          <option v-for="form in data.forms" :key="form.id" :value="form.xmlFormId">{{ form.name || form.xmlFormId }}</option>
        </select>
      </label>
      <label>Backcheck instructions
        <textarea v-model="settings.question" maxlength="1500" required class="form-control"></textarea>
      </label>
      <label>Due within (days)
        <input v-model.number="settings.dueDays" type="number" min="1" max="90" required class="form-control">
      </label>
      <label>Default pending capacity
        <input v-model.number="settings.maxPending" type="number" min="0" max="100" required class="form-control">
      </label>
      <div class="allocation-capacities">
        <table v-if="data.collectors.length" class="table">
          <caption>Collector capacity (zero means unavailable)</caption>
          <thead><tr><th scope="col">Collector</th><th scope="col">Pending</th><th scope="col">Override</th></tr></thead>
          <tbody>
<tr v-for="collector in data.collectors" :key="collector.id">
            <th scope="row">{{ collector.name }}</th><td>{{ collector.pending }}</td>
            <td>
<input v-model="overrides[collector.id]" type="number" min="0" max="100" class="form-control"
              :aria-label="`Pending capacity for ${collector.name}`" :placeholder="String(settings.maxPending)">
</td>
          </tr>
</tbody>
        </table>
        <p v-else>No eligible collectors for this response Form.</p>
      </div>
      <label><input v-model="settings.respectCalendar" type="checkbox"> Respect calendar availability and daily visit quotas</label>
      <label><input v-model="settings.enabled" type="checkbox"> Enable automatic assignment</label>
      <button type="submit" class="btn btn-default" :disabled="busy">Save allocation policy <spinner :state="busy"/></button>
    </form>
    <p v-if="saved" role="status">Allocation policy saved.</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-if="data.policy?.report" class="allocation-report" role="status">
      <p v-if="data.policy.report.failure">{{ data.policy.report.failure }}</p>
      <p v-else>
Last run {{ data.policy.report.at }}: {{ data.policy.report.assigned }} assigned of {{ data.policy.report.examined }} considered;
        {{ data.policy.report.noIndependentCollector }} waiting for an independent collector;
        {{ data.policy.report.atCapacity }} waiting for capacity; {{ data.policy.report.noCalendarSlot || 0 }} waiting for a calendar slot.
</p>
    </div>
    <backcheck-planning :project-id="projectId" :can-manage="canConfigure"/>
    <p>
Runs every five minutes. Enabling assigns open sampled cases to the configuring manager for review.
      Cases already owned by another reviewer and cases with any earlier backcheck are left alone.
      Each request includes its source Submission reference; answers are not copied.
</p>
  </section>
</template>

<script setup>
import { reactive, ref } from 'vue';
import Spinner from '../spinner.vue';
import BackcheckPlanning from './backcheck-planning.vue';
import useRequest from '../../composables/request';

defineOptions({ name: 'BackcheckAllocation' });
const props = defineProps({ projectId: { type: String, required: true }, xmlFormId: { type: String, required: true }, canConfigure: Boolean });
const { request, awaitingResponse: busy } = useRequest();
const base = () => `/v1/projects/${props.projectId}/forms/${encodeURIComponent(props.xmlFormId)}/backcheck-allocation`;
const data = ref(null); const error = ref(''); const saved = ref(false);
const settings = reactive({ enabled: false, responseXmlFormId: '', question: '', dueDays: 14, maxPending: 5, respectCalendar: false });
const overrides = reactive({});
const loadCollectors = () => request({ method: 'GET', url: `${base()}?responseXmlFormId=${encodeURIComponent(settings.responseXmlFormId)}`, alert: false })
  .then(({ data: answer }) => { data.value.collectors = answer.collectors; })
  .catch(() => { error.value = 'Collector workload could not be loaded.'; });
const apply = (answer) => {
  if (!Array.isArray(answer?.forms) || !Array.isArray(answer?.collectors)) return;
  data.value = answer;
  if (answer.policy) {
    Object.assign(settings, answer.policy.settings, { enabled: answer.policy.enabled });
    for (const id of Object.keys(overrides)) delete overrides[id];
    for (const limit of answer.policy.settings.collectorLimits ?? []) overrides[limit.actorId] = String(limit.maxPending);
  }
};
request({ method: 'GET', url: base(), alert: false }).then(({ data: answer }) => apply(answer)).catch(() => {});
const save = () => {
  if (busy.value) return Promise.resolve();
  error.value = ''; saved.value = false;
  return request({
    method: 'PUT', url: base(), alert: false, data: {
      enabled: settings.enabled, responseXmlFormId: settings.responseXmlFormId, question: settings.question,
      dueDays: settings.dueDays, maxPending: settings.maxPending, respectCalendar: settings.respectCalendar,
      collectorLimits: Object.entries(overrides).filter(([, value]) => value !== '').map(([actorId, value]) => ({ actorId: Number(actorId), maxPending: Number(value) }))
    }
  }).then(({ data: answer }) => { apply(answer); saved.value = true; })
    .catch(e => { error.value = e.response?.data?.message || 'The allocation policy could not be saved.'; });
};
</script>

<style lang="scss">
.backcheck-allocation {
  margin: 24px 0;
  form { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
  label { display: flex; flex-direction: column; font-weight: normal; max-width: 320px; }
  .allocation-capacities { flex-basis: 100%; overflow-x: auto; }
  .allocation-capacities input { max-width: 100px; }
}
</style>
