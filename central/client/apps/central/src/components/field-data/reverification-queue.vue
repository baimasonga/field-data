<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="reverification-queue" aria-label="Re-verification queue">
    <h2>Re-verification queue</h2>
    <p>Tasks that ask for an asset to be checked again, across every form in this project that you can read. Open one to dispatch it, close it with a collector's visit, or cancel it.</p>
    <button type="button" class="btn btn-default" :disabled="busy" @click="reload">Refresh queue</button>
    <p v-if="busy" role="status">Loading the queue…</p>
    <div v-if="error" role="alert">
      <p>{{ error }}</p>
      <button type="button" class="btn btn-default" :disabled="busy" @click="reload">Retry</button>
    </div>

    <template v-if="summary">
      <p class="counts">
        <b>{{ summary.counts.queued }}</b> waiting for dispatch ·
        <b>{{ summary.counts.dispatched }}</b> dispatched ·
        <b>{{ summary.counts.overdue }}</b> overdue ·
        {{ summary.counts.closed }} closed ·
        {{ summary.counts.cancelled }} cancelled
      </p>
      <details v-if="summary.workload.length" open>
        <summary>Open work by collector</summary>
        <p>A count of tasks currently dispatched to each collector, to help spread the work. It is not a measure of performance: a task can stay open because a road is blocked or a site is unsafe.</p>
        <ul class="workload">
          <li v-for="person of summary.workload" :key="person.assignee.id">
            {{ person.assignee.displayName }} — {{ person.open }} open<template v-if="person.overdue"> ({{ person.overdue }} overdue)</template>
          </li>
        </ul>
        <p v-if="summary.truncated">Only the 200 collectors with the most open work are shown.</p>
      </details>
    </template>

    <form class="filters" @submit.prevent="reload">
      <!-- Not disabled while loading: on a slow connection people should be able to change
           their mind, and only the newest answer is ever shown. -->
      <fieldset>
        <legend>Filter the queue</legend>
        <label>Status
          <select v-model="status" class="form-control">
            <option value="">Any status</option>
            <option value="queued">Waiting for dispatch</option>
            <option value="dispatched">Dispatched</option>
            <option value="closed">Closed</option>
            <option value="cancelled">Cancelled</option>
            <option value="superseded">Superseded</option>
          </select>
        </label>
        <label>Collector
          <select v-model="assigneeId" class="form-control">
            <option value="">Any collector</option>
            <option v-for="person of collectors" :key="person.id" :value="String(person.id)">{{ person.displayName }}</option>
          </select>
        </label>
        <label class="inline"><input v-model="overdueOnly" type="checkbox"> Overdue only</label>
      </fieldset>
    </form>

    <p v-if="loaded && items.length === 0 && !busy && !error">No tasks match these filters.</p>
    <ul class="queue-items">
      <li v-for="task of items" :key="task.id">
        <b>{{ task.assetName }}</b> · {{ task.externalId }} · {{ task.predicate }}
        <p>
          {{ labels[task.status] || task.status }}<template v-if="task.assignee"> · {{ task.assignee.displayName }}</template>
          <template v-if="task.visitBy"> · visit by {{ task.visitBy }}</template>
          <b v-if="task.overdue"> · Overdue</b>
          · due {{ task.dueAt }}
        </p>
        <button type="button" class="btn btn-default btn-sm" @click="$emit('open', task)">Open asset</button>
      </li>
    </ul>
    <button v-if="nextCursor" type="button" class="btn btn-default" :disabled="busy" @click="more">Load more</button>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import useRequest from '../../composables/request';

defineOptions({ name: 'FieldDataReverificationQueue' });
const props = defineProps({ projectId: { type: String, required: true } });
defineEmits(['open']);
const { request } = useRequest();
const root = `/v1/field-data/projects/${encodeURIComponent(props.projectId)}/reverification-tasks`;
const labels = { queued: 'Waiting for dispatch', dispatched: 'Dispatched', closed: 'Closed', cancelled: 'Cancelled', superseded: 'Superseded' };

const busy = ref(false);
const error = ref('');
const loaded = ref(false);
const summary = ref(null);
const items = ref([]);
const nextCursor = ref(null);
const status = ref('');
const assigneeId = ref('');
const overdueOnly = ref(false);
const collectors = computed(() => (summary.value?.workload ?? []).map(person => person.assignee));

// Only the newest request may change what is shown: changing a filter while an
// older answer is still on its way must not bring the older rows back.
let latest = 0;
let alive = true;
onBeforeUnmount(() => { alive = false; });

const query = (cursor) => {
  const params = new URLSearchParams();
  if (status.value) params.set('status', status.value);
  if (assigneeId.value) params.set('assigneeId', assigneeId.value);
  if (overdueOnly.value) params.set('overdue', 'true');
  if (cursor) params.set('cursor', cursor);
  const text = params.toString();
  return text ? `?${text}` : '';
};
const load = async (cursor = null) => {
  latest += 1;
  const mine = latest;
  busy.value = true;
  error.value = '';
  try {
    const [list, counts] = await Promise.all([
      request({ method: 'GET', url: `${root}${query(cursor)}`, alert: false }),
      cursor ? Promise.resolve(null) : request({ method: 'GET', url: `${root}/summary`, alert: false })
    ]);
    if (!alive || mine !== latest) return;
    // Show nothing rather than crash on an answer that is not the queue's shape.
    if (!Array.isArray(list.data?.items) || (counts != null && counts.data?.counts == null)) throw new Error('Unexpected queue response');
    items.value = cursor ? [...items.value, ...list.data.items] : list.data.items;
    nextCursor.value = list.data.nextCursor;
    if (counts != null) summary.value = counts.data;
    loaded.value = true;
  } catch {
    if (alive && mine === latest) error.value = 'The queue could not be loaded. Check your connection and try again.';
  } finally {
    if (alive && mine === latest) busy.value = false;
  }
};
const reload = () => load();
const more = () => load(nextCursor.value);
watch([status, assigneeId, overdueOnly], reload);
load();
</script>
<style scoped>
.reverification-queue { margin-top: 24px; overflow-wrap: anywhere; }
label { display: block; margin: 12px 0; }
label.inline { display: flex; gap: 8px; align-items: center; }
fieldset { min-width: 0; }
.queue-items { padding-left: 0; list-style: none; }
.queue-items li { margin: 12px 0; padding-bottom: 12px; border-bottom: 1px solid #ddd; }
</style>
