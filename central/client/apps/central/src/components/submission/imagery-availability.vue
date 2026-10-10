<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.

Satellite imagery availability (G1b): which Sentinel-2 scenes cover each located
Submission around its visit. Evidence for a reviewer, not a finding.
Contract: docs/field-intelligence/G1b-imagery-availability.md -->
<template>
  <section v-if="data != null" class="imagery-availability" aria-labelledby="imagery-title">
    <h2 id="imagery-title">Satellite imagery</h2>
    <p v-if="!data.enabled" class="imagery-off">
      Satellite imagery checks are off on this server. An operator can turn them on.
    </p>
    <template v-else>
      <p class="section-lead">
        Whether Sentinel-2 scenes cover each located Submission within {{ data.windowDays }} days of its visit, and how cloudy they were.
        Only the centre of a {{ data.cellDegrees }}° grid cell (about 5 km) and the day are sent to the imagery catalogue, never a Submission's location.
        This says whether imagery exists, not what it shows.
      </p>
      <p v-if="data.encrypted">This Form is encrypted, so its locations cannot be read.</p>
      <p v-else-if="data.coverage" class="imagery-coverage" role="status">
        {{ data.coverage.withClearScene }} of {{ data.coverage.checked }} checked Submissions have a scene under {{ data.clearBelow }}% cloud ·
        {{ data.coverage.withScene }} have any scene · {{ data.coverage.notChecked }} not checked yet · {{ data.coverage.noLocation }} without a location
      </p>
      <button v-if="canCheck && !data.encrypted" type="button" class="btn btn-default" :aria-disabled="busy" @click="check">
        Check imagery availability <spinner :state="busy"/>
      </button>
      <p v-if="report" class="imagery-report" role="status">
        {{ report.looked }} looked up, {{ report.cached }} already known<template v-if="report.truncated">, the first {{ report.considered }} located Submissions only</template>.
        <template v-if="report.unavailable.length > 0">The catalogue could not answer for {{ report.unavailable.length }} {{ report.unavailable.length === 1 ? 'place' : 'places' }}; try again later.</template>
      </p>
      <p v-if="error" role="alert" class="imagery-error">{{ error }}</p>

      <details v-if="checked.length > 0" class="imagery-list">
        <summary>Imagery by Submission ({{ checked.length }})</summary>
        <ul>
          <li v-for="s of checked" :key="s.instanceId">
            <router-link :to="submissionPath(s.instanceId)">{{ s.instanceId }}</router-link>:
            <template v-if="s.scenes === 0">no scene within {{ data.windowDays }} days</template>
            <template v-else>
              {{ s.scenes }} {{ s.scenes === 1 ? 'scene' : 'scenes' }};
              nearest {{ s.nearest.date }} ({{ days(s.nearest.daysFromVisit) }}{{ s.nearest.cloud == null ? '' : `, ${s.nearest.cloud}% cloud` }});
              clearest {{ s.clearest ? `${s.clearest.date} (${s.clearest.cloud}% cloud)` : 'unknown' }}
            </template>
            <span v-if="s.visitTime === 'receipt'" class="imagery-note"> · visit dated by receipt time</span>
          </li>
        </ul>
      </details>
    </template>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue';

import Spinner from '../spinner.vue';
import useRequest from '../../composables/request';

defineOptions({ name: 'ImageryAvailability' });
const props = defineProps({
  projectId: { type: String, required: true },
  xmlFormId: { type: String, required: true },
  canCheck: Boolean
});
const { request, awaitingResponse: busy } = useRequest();
const base = () => `/v1/projects/${props.projectId}/forms/${encodeURIComponent(props.xmlFormId)}/imagery`;

const data = ref(null); const report = ref(null); const error = ref('');
const load = () => request({ method: 'GET', url: base(), alert: false })
  // Shown only for an answer of the expected shape.
  .then(({ data: answer }) => { data.value = typeof answer?.enabled === 'boolean' ? answer : null; })
  .catch(() => { data.value = null; });
load();

const check = () => {
  error.value = '';
  return request({ method: 'POST', url: `${base()}/check`, alert: false })
    .then(({ data: answer }) => { report.value = answer; return load(); })
    .catch((e) => { error.value = e.response?.data?.message || 'Imagery availability could not be checked.'; });
};

const checked = computed(() => (data.value?.submissions ?? []).filter((s) => s.status === 'checked'));
const days = (n) => (n === 0 ? 'same day' : n > 0 ? `${n} days after the visit` : `${-n} days before the visit`);
const submissionPath = (instanceId) =>
  `/projects/${props.projectId}/forms/${encodeURIComponent(props.xmlFormId)}/submissions/${encodeURIComponent(instanceId)}`;
</script>

<style lang="scss">
@import '../../assets/scss/variables';

.imagery-availability {
  margin: 0 0 34px;
  overflow-wrap: anywhere;
  .imagery-off, .imagery-note { color: $color-text-secondary; }
  .imagery-error { color: $color-danger; }
  .imagery-list ul { margin: 6px 0 0; padding-left: 18px; }
}
</style>
