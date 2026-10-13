<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section v-if="collectors" class="backcheck-planning" aria-labelledby="backcheck-planning-title">
    <h3 id="backcheck-planning-title">Availability and route planning</h3>
    <p>Calendars use UTC dates. Zero visits means unavailable. Calendar changes affect future assignments; existing visits keep their dates.</p>
    <label>Planning collector
      <select v-model="actorId" class="form-control" @change="selectCollector">
        <option value="" disabled>Choose a collector</option>
        <option v-for="collector in collectors" :key="collector.id" :value="String(collector.id)">{{ collector.name }}</option>
      </select>
    </label>
    <p v-if="!collectors.length">No App Users in this project.</p>
    <template v-if="actorId">
      <p v-if="!configured">No calendar configured. Calendar-aware assignment will leave this collector unavailable until one is saved.</p>
      <form v-if="canManage" class="calendar-form" @submit.prevent="saveCalendar">
        <fieldset>
          <legend>Weekly visit capacity (UTC)</legend>
          <label v-for="(day, index) in weekdays" :key="day">{{ day }} visits
            <input v-model.number="weeklyCapacity[index]" type="number" min="0" max="100" required class="form-control">
          </label>
        </fieldset>
        <fieldset>
          <legend>Dated exceptions</legend>
          <div v-for="(exception, index) in exceptions" :key="index" class="calendar-exception">
            <label>Exception date <input v-model="exception.date" type="date" required class="form-control"></label>
            <label>Exception visits <input v-model.number="exception.maxVisits" type="number" min="0" max="100" required class="form-control"></label>
            <button type="button" class="btn btn-link" @click="exceptions.splice(index, 1)">Remove exception</button>
          </div>
          <button type="button" class="btn btn-default" :disabled="exceptions.length >= 366" @click="exceptions.push({ date: date, maxVisits: 0 })">Add dated exception</button>
        </fieldset>
        <button type="submit" class="btn btn-default" :disabled="busy">Save calendar</button>
      </form>
      <p v-else>Weekly visits, Sunday to Saturday: {{ weeklyCapacity.join(', ') }}. Dated exceptions: {{ exceptions.length }}.</p>
      <p v-if="saved" role="status">Calendar saved.</p>
      <form v-if="canManage" class="route-form" @submit.prevent="preview">
        <h4>Visit itinerary preview</h4>
        <p>Suggested stop order and straight-line distance, returning to the start. Review roads, travel time, access and safety separately.</p>
        <label>Route date (UTC) <input v-model="date" type="date" required class="form-control"></label>
        <label>Start latitude <input v-model.number="startLat" type="number" min="-90" max="90" step="any" required class="form-control"></label>
        <label>Start longitude <input v-model.number="startLon" type="number" min="-180" max="180" step="any" required class="form-control"></label>
        <label>Minutes per visit <input v-model.number="visitMinutes" type="number" min="1" max="480" required class="form-control"></label>
        <label>Available minutes including travel <input v-model.number="dayMinutes" type="number" min="1" max="1440" required class="form-control"></label>
        <button type="submit" class="btn btn-default" :disabled="busy">Preview itinerary</button>
      </form>
      <p v-if="error" role="alert">{{ error }}</p>
      <div v-if="plan" class="route-result">
        <p role="status">
{{ plan.route.stops.length }} located stops · {{ plan.route.distanceKm }} km straight-line total, including return.
          Daily capacity: {{ plan.capacity == null ? 'unknown' : plan.capacity }}; {{ plan.used }} visits reserved or completed; {{ plan.unplanned }} pending visits without a date.
</p>
        <p v-if="plan.needsReview" class="route-review" role="status">
Review required: {{ plan.truncated ? 'the task list was truncated; ' : '' }}{{ omitted }} excluded tasks;
          {{ plan.uncertainLocations }} uncertain locations. Check capacity, missing locations and access before fieldwork.
</p>
        <p v-if="plan.capacity != null && plan.used > plan.capacity">This day is over capacity. Calendar edits do not reschedule existing visits.</p>
        <template v-if="plan.road">
          <p v-if="plan.road.status !== 'ok'" role="status">Road estimates unavailable ({{ plan.road.status }}). Travel time remains unknown.</p>
          <template v-else>
            <p>{{ plan.road.distanceKm }} km by road · {{ plan.road.travelMinutes }} minutes driving, including return. Driving estimates exclude traffic and access delays.</p>
            <p>{{ plan.timing.totalMinutes }} minutes including {{ plan.timing.visitMinutes }} minutes per visit; {{ plan.timing.dayMinutes }} minutes available.</p>
            <p v-if="plan.timing.overBudget" role="status">This itinerary exceeds the available time. Reduce or reschedule visits before fieldwork.</p>
            <p v-if="plan.road.maxSnapMeters > 100" role="status">A location is more than 100 metres from the routed road. Review access before fieldwork.</p>
          </template>
        </template>
        <dl><template v-for="(count, reason) in plan.excluded" :key="reason"><dt>{{ reasons[reason] }}</dt><dd>{{ count }}</dd></template></dl>
        <div class="itinerary-table">
          <table class="table">
            <caption>Suggested itinerary for {{ plan.actor.name }} on {{ plan.date }}</caption>
            <thead><tr><th scope="col">Stop</th><th scope="col">Source Submission</th><th scope="col">Latitude</th><th scope="col">Longitude</th><th scope="col">Accuracy (m)</th><th scope="col">Straight-line leg (km)</th><th scope="col">Road leg (km)</th><th scope="col">Driving leg (minutes)</th></tr></thead>
            <tbody>
<tr v-for="stop in plan.route.stops" :key="stop.id">
<th scope="row">{{ stop.order }}</th><td>{{ stop.instanceId }}</td>
              <td>{{ stop.location.latitude }}</td><td>{{ stop.location.longitude }}</td><td>{{ stop.location.accuracy ?? 'unknown' }}{{ stop.uncertain ? ' · review' : '' }}</td><td>{{ stop.legKm }}</td>
              <td>{{ plan.road?.legs?.[stop.order - 1]?.distanceKm ?? 'unknown' }}</td><td>{{ plan.road?.legs?.[stop.order - 1]?.travelMinutes ?? 'unknown' }}</td>
</tr>
</tbody>
          </table>
        </div>
        <p>Return to start: {{ plan.route.returnKm }} km straight-line.</p>
        <button type="button" class="btn btn-default" @click="download">Download itinerary CSV</button>
        <p>The preview does not dispatch, reschedule or change a visit.</p>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue';
import useRequest from '../../composables/request';

defineOptions({ name: 'BackcheckPlanning' });
const props = defineProps({ projectId: { type: String, required: true }, canManage: Boolean });
const { request, awaitingResponse: busy } = useRequest();
const base = () => `/v1/projects/${props.projectId}`;
const collectors = ref(null); const actorId = ref(''); const weeklyCapacity = ref([0, 0, 0, 0, 0, 0, 0]); const exceptions = ref([]);
const configured = ref(false); const saved = ref(false); const error = ref(''); const plan = ref(null);
const date = ref(new Date().toISOString().slice(0, 10)); const startLat = ref(''); const startLon = ref('');
const visitMinutes = ref(30); const dayMinutes = ref(480);
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const reasons = {
  permission: 'Unreadable source or response Form', inactive: 'Source or review no longer current',
  collectorUnavailable: 'Collector or response Form unavailable', encryptedSource: 'Encrypted source',
  sourceUnverified: 'Source integrity unavailable or over size limit', missingLocation: 'No usable source location'
};
const omitted = computed(() => Object.values(plan.value?.excluded ?? {}).reduce((sum, n) => sum + n, 0));
const selectCollector = () => {
  const collector = collectors.value.find(c => c.id === Number(actorId.value));
  configured.value = collector?.settings != null;
  weeklyCapacity.value = [...(collector?.settings?.weeklyCapacity ?? [0, 0, 0, 0, 0, 0, 0])];
  exceptions.value = (collector?.settings?.exceptions ?? []).map(e => ({ ...e })); plan.value = null; saved.value = false; error.value = '';
};
request({ method: 'GET', url: `${base()}/backcheck-calendars`, alert: false })
  .then(({ data }) => { if (Array.isArray(data)) collectors.value = data; }).catch(() => {});
const saveCalendar = () => {
  if (busy.value) return Promise.resolve();
  error.value = ''; saved.value = false;
  if (new Set(exceptions.value.map(e => e.date)).size !== exceptions.value.length) { error.value = 'Use each exception date once.'; return Promise.resolve(); }
  return request({
    method: 'PUT', url: `${base()}/backcheck-calendars/${actorId.value}`, alert: false,
    data: { weeklyCapacity: weeklyCapacity.value, exceptions: exceptions.value }
  })
    .then(({ data }) => {
      collectors.value = collectors.value.map(c => (c.id === Number(actorId.value) ? { ...c, settings: data.settings } : c));
      configured.value = true; saved.value = true; plan.value = null;
    }).catch(e => { error.value = e.response?.data?.message || 'Calendar could not be saved.'; });
};
const preview = () => {
  if (busy.value) return Promise.resolve();
  error.value = ''; plan.value = null;
  return request({
    method: 'GET', url: `${base()}/backcheck-route?${new URLSearchParams({
      actorId: actorId.value,
      date: date.value, startLat: String(startLat.value), startLon: String(startLon.value),
      visitMinutes: String(visitMinutes.value), dayMinutes: String(dayMinutes.value)
    })}`, alert: false
  })
    .then(({ data }) => { plan.value = data; }).catch(e => { error.value = e.response?.data?.message || 'Itinerary could not be planned.'; });
};
const download = () => {
  const text = value => {
    let s = String(value ?? ''); if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replaceAll('"', '""')}"`;
  };
  const rows = [['Preview only: straight-line distances; review excluded tasks, accuracy and capacity before fieldwork'],
    ['Date', 'Collector', 'Stop', 'Source Submission', 'Latitude', 'Longitude', 'Accuracy (m)', 'Straight-line leg (km)', 'Road leg (km)', 'Driving leg (minutes)'],
    ...plan.value.route.stops.map(s => [plan.value.date, plan.value.actor.name, s.order, s.instanceId, s.location.latitude, s.location.longitude, s.location.accuracy, s.legKm,
      plan.value.road?.legs?.[s.order - 1]?.distanceKm, plan.value.road?.legs?.[s.order - 1]?.travelMinutes]),
    ['Starting latitude', plan.value.start?.latitude ?? startLat.value], ['Starting longitude', plan.value.start?.longitude ?? startLon.value],
    ['Return to start (km)', plan.value.route.returnKm], ['Total straight-line km', plan.value.route.distanceKm],
    ['Road estimate status', plan.value.road?.status ?? 'unknown'], ['Road distance km', plan.value.road?.distanceKm],
    ['Driving minutes including return', plan.value.road?.travelMinutes], ['Maximum road snap distance metres', plan.value.road?.maxSnapMeters],
    ['Minutes per visit', plan.value.timing?.visitMinutes], ['Available minutes', plan.value.timing?.dayMinutes],
    ['Total estimated minutes', plan.value.timing?.totalMinutes], ['Over time budget', plan.value.timing?.overBudget],
    ['Daily capacity', plan.value.capacity], ['Reserved or completed', plan.value.used], ['Unplanned pending', plan.value.unplanned],
    ['Review required', plan.value.needsReview], ['Truncated', plan.value.truncated], ['Uncertain locations', plan.value.uncertainLocations],
    ...Object.entries(plan.value.excluded).map(([reason, count]) => [reasons[reason], count])];
  const url = URL.createObjectURL(new Blob([rows.map(r => r.map(text).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `itinerary-${plan.value.date}.csv`; link.click(); URL.revokeObjectURL(url);
};
</script>

<style lang="scss">
.backcheck-planning {
  margin-top: 24px;
  fieldset { flex-basis: 100%; }
  fieldset label, .calendar-exception { display: inline-flex; gap: 8px; margin-right: 12px; }
  .calendar-form, .route-form { margin: 16px 0; }
  .calendar-form input[type="number"] { max-width: 100px; }
  .itinerary-table { overflow-x: auto; }
  dt, dd { display: inline; margin-right: 8px; }
}
</style>
