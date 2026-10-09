<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <li class="reverification-task">
    <span class="summary">{{ task.predicate }} · {{ task.status }} · Due {{ task.dueAt }}</span>
    <button type="button" class="btn btn-default btn-sm" :disabled="busy" :aria-expanded="open"
      @click="toggle">
{{ open ? 'Hide' : 'Manage' }}
</button>
    <div v-if="open" class="panel-body">
      <p v-if="busy" role="status">Loading or saving task…</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="notice" role="status">{{ notice }}</p>
      <template v-if="detail">
        <p>
          Status: <b>{{ detail.task.status }}</b>
          <template v-if="detail.task.assignee"> · Assigned to {{ detail.task.assignee.displayName }}</template>
          <template v-if="detail.task.visitBy"> · Visit by {{ detail.task.visitBy }}</template>
          <b v-if="detail.task.overdue"> · Overdue</b>
        </p>
        <p v-if="detail.task.status === 'cancelled'">Cancelled without a visit. This does not show the asset was checked.</p>
        <p v-if="detail.task.status === 'closed'">Closed by a collector visit that was received after dispatch.</p>
        <details>
          <summary>Task history ({{ detail.events.length }})</summary>
          <ol>
            <li v-for="event of detail.events" :key="event.id">
              {{ event.action }} · {{ event.recordedAt }}
              <template v-if="event.assigneeName"> · {{ event.assigneeName }}</template>
              <template v-if="event.reasonCode"> · {{ event.reasonCode }}</template>
              <p>{{ event.note }}</p>
            </li>
          </ol>
        </details>
        <template v-if="detail.allowed && ['queued', 'dispatched'].includes(detail.task.status)">
          <form @submit.prevent="dispatch">
            <fieldset :disabled="busy">
              <legend>{{ detail.task.status === 'queued' ? 'Dispatch to a collector' : 'Reassign or change deadline' }}</legend>
              <label>App User
                <select v-model.number="assigneeId" class="form-control" required>
                  <option :value="0" disabled>Choose an App User</option>
                  <option v-for="user of appUsers" :key="user.id" :value="user.id">{{ user.displayName }}</option>
                </select>
              </label>
              <label>Visit by (optional) <input v-model="visitBy" class="form-control" type="datetime-local"></label>
              <label>Instruction shown to the collector
                <textarea v-model="dispatchNote" class="form-control" required maxlength="2000"></textarea>
              </label>
              <p>The collector sees the asset, the fact to check and this instruction. They never see the earlier value. Changing only the deadline keeps visits already received; choosing a different collector restarts the evidence window.</p>
              <button type="submit" class="btn btn-primary">{{ detail.task.status === 'queued' ? 'Dispatch task' : 'Save assignment' }}</button>
            </fieldset>
          </form>
          <form v-if="detail.task.status === 'dispatched'" @submit.prevent="close">
            <fieldset :disabled="busy">
              <legend>Close with visit evidence</legend>
              <p v-if="detail.candidates.length">
                Submissions from the assigned collector since dispatch:
                <span v-for="candidate of detail.candidates" :key="candidate.claimVersionId" class="candidate">
                  {{ candidate.instanceId }} (received {{ candidate.receivedAt }}{{ candidate.capturedAt ? `, captured on device ${candidate.capturedAt}` : '' }})
                </span>
              </p>
              <p v-else>No submissions from the assigned collector have arrived since dispatch.</p>
              <label>Observation recorded from that submission
                <select v-model="observationId" class="form-control" required>
                  <option value="" disabled>Choose an observation</option>
                  <option v-for="record of closable" :key="record.id" :value="record.id">
                    {{ record.predicate }}: {{ record.state === 'known' ? record.value : record.state }} · recorded {{ record.recordedAt }}
                  </option>
                </select>
              </label>
              <p v-if="closable.length === 0">Record an asset observation from the collector's submission first (use the Review Queue to pick it as a source).</p>
              <label>Closing note <textarea v-model="closeNote" class="form-control" required maxlength="2000"></textarea></label>
              <p>The server accepts this only if the collector submitted it in the field after dispatch and its source is intact. Time is the server's receipt time, not the device clock.</p>
              <button type="submit" class="btn btn-primary">Close task</button>
            </fieldset>
          </form>
          <form @submit.prevent="cancel">
            <fieldset :disabled="busy">
              <legend>Cancel without a visit</legend>
              <label>Reason
                <select v-model="reasonCode" class="form-control" required>
                  <option value="" disabled>Choose a reason</option>
                  <option value="access-blocked">Site not reachable</option>
                  <option value="safety">Safety concern</option>
                  <option value="asset-removed">Asset no longer exists</option>
                  <option value="duplicate">Duplicate task</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>Note <textarea v-model="cancelNote" class="form-control" required maxlength="2000"></textarea></label>
              <p>Cancellation records that no visit evidence was obtained. It says nothing about the collector.</p>
              <button type="submit" class="btn btn-default">Cancel task</button>
            </fieldset>
          </form>
        </template>
      </template>
    </div>
  </li>
</template>
<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import useRequest from '../../composables/request';

defineOptions({ name: 'FieldDataReverificationTask' });
const props = defineProps({
  projectId: { type: String, required: true },
  task: { type: Object, required: true },
  history: { type: Array, default: () => [] }
});
const emit = defineEmits(['changed']);
const { request } = useRequest();
const root = `/v1/field-data/projects/${encodeURIComponent(props.projectId)}/reverification-tasks/${encodeURIComponent(props.task.id)}`;
const open = ref(false);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const detail = ref(null);
const appUsers = ref([]);
const assigneeId = ref(0);
const visitBy = ref('');
const dispatchNote = ref('');
const observationId = ref('');
const closeNote = ref('');
const reasonCode = ref('');
const cancelNote = ref('');
const retries = new Map();
let generation = 0;
onBeforeUnmount(() => { generation += 1; });

// Offer only observations that could plausibly close the task; the server decides.
const closable = computed(() => {
  if (detail.value?.task.dispatchedAt == null) return [];
  const since = new Date(detail.value.task.dispatchedAt);
  return props.history.filter(record => record.predicate === props.task.predicate &&
    ['known', 'not-applicable'].includes(record.state) && new Date(record.recordedAt) > since);
});

const read = async (current) => {
  const { data } = await request({ method: 'GET', url: root, alert: false });
  if (current !== generation) return;
  detail.value = data;
  if (data.task.assignee != null) assigneeId.value = data.task.assignee.id;
};
const perform = async (work) => {
  if (busy.value) return;
  const current = generation;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try { await work(current); } catch (failure) {
    if (current !== generation) return;
    const status = failure.response?.status;
    if (status === 412) {
      error.value = 'Another supervisor changed this task. Its latest state is shown; review it before saving again.';
      try { await read(current); } catch { /* the message above already explains */ }
    } else if (status === 409) {
      error.value = failure.response?.data?.message ?? 'The task is not in a state that allows that change.';
    } else {
      error.value = 'The task request failed. Check the assignee, dates and note, then retry.';
    }
  } finally { if (current === generation) busy.value = false; }
};
const toggle = () => {
  open.value = !open.value;
  if (!open.value || detail.value != null) return;
  perform(async (current) => {
    await read(current);
    if (current !== generation) return;
    const { data } = await request({ method: 'GET', url: `/v1/projects/${encodeURIComponent(props.projectId)}/app-users`, alert: false });
    if (current === generation) appUsers.value = data;
  });
};
const write = (name, data) => {
  const url = `${root}/${name}`;
  const etag = `"task-${detail.value.task.revision}"`;
  const signature = JSON.stringify({ url, data, etag });
  if (!retries.has(signature)) retries.set(signature, crypto.randomUUID());
  return request({
    method: 'POST', url, data: { ...data, requestId: retries.get(signature) },
    headers: { 'If-Match': etag }, alert: false
  });
};
const finish = async (current, message) => {
  await read(current);
  if (current !== generation) return;
  notice.value = message;
  emit('changed');
};
const dispatch = () => perform(async (current) => {
  await write('dispatch', {
    assigneeId: assigneeId.value, note: dispatchNote.value,
    ...(visitBy.value ? { visitBy: new Date(visitBy.value).toISOString() } : {})
  });
  await finish(current, 'Assignment saved. The collector sees it in their fieldwork inbox.');
});
const close = () => perform(async (current) => {
  await write('close', { observationId: observationId.value, note: closeNote.value });
  await finish(current, 'Task closed with the collector visit as evidence.');
});
const cancel = () => perform(async (current) => {
  await write('cancel', { reasonCode: reasonCode.value, note: cancelNote.value });
  await finish(current, 'Task cancelled. No visit evidence was recorded.');
});
</script>
<style scoped>
.reverification-task { margin: 8px 0; overflow-wrap: anywhere; }
.summary { margin-right: 8px; }
.panel-body { margin: 8px 0 16px; }
label { display: block; margin: 12px 0; }
fieldset { min-width: 0; margin-bottom: 16px; }
.candidate { display: block; }
</style>
