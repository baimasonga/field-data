<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="asset-passports" aria-label="Asset passports and re-verification">
    <h2>Asset passports and re-verification</h2>
    <p>Record physical asset observations with their source and validity dates. Expiry requests another check; it does not prove an asset changed.</p>
    <button type="button" class="btn btn-default" :disabled="busy" @click="loadAssets()">Load assets</button>
    <p v-if="busy" role="status">Loading or saving asset records…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <template v-if="loaded">
      <p v-if="items.length === 0">No accessible assets registered in this project.</p>
      <label :for="`asset-picker-${projectId}`">Asset</label><select :id="`asset-picker-${projectId}`" v-model="assetId" class="form-control" :disabled="busy" @change="loadAsset">
        <option value="">Choose an asset</option>
        <option v-for="item of items" :key="item.id" :value="item.id">{{ item.name }} · {{ item.externalId }}</option>
      </select>
      <button v-if="nextCursor" type="button" class="btn btn-default" :disabled="busy" @click="loadAssets(true)">Load more assets</button>
      <details v-if="allowed">
        <summary>Register physical asset</summary>
        <form @submit.prevent="register">
          <fieldset :disabled="busy">
            <label>Asset name <input v-model="draft.name" class="form-control" required maxlength="200"></label>
            <label>Asset type <input v-model="draft.assetType" class="form-control" required maxlength="100" placeholder="For example, water point"></label>
            <label>External asset identifier <input v-model="draft.externalId" class="form-control" required maxlength="200"></label>
            <p>Identifiers are exact and unique within this project. Similar names do not merge assets. Owning form: {{ xmlFormId }}</p>
            <button type="submit" class="btn btn-primary">Register asset</button>
          </fieldset>
        </form>
      </details>
    </template>
    <template v-if="detail">
      <h3>{{ detail.asset.name }} · {{ detail.asset.externalId }}</h3>
      <p>Revision {{ detail.asset.revision }} · {{ detail.asset.assetType }}</p>
      <form @submit.prevent="loadAsset">
        <fieldset :disabled="busy">
          <label>Valid at (optional ISO date and time) <input v-model="at" class="form-control" placeholder="2026-10-01T00:00:00Z"></label>
          <label>Known at (optional ISO date and time) <input v-model="knownAt" class="form-control" placeholder="2026-10-01T00:00:00Z"></label>
          <button class="btn btn-default" type="submit">Query dated facts</button>
        </fieldset>
      </form>
      <p>Selected validity time: {{ detail.at }} · Knowledge time: {{ detail.knownAt }}</p>
      <ul v-if="detail.facts.length">
        <li v-for="fact of detail.facts" :key="fact.id">
          <b>{{ fact.predicate }}</b>: {{ fact.state === 'known' ? fact.value : fact.state }} · {{ fact.freshness.status }}
          <p>Review due: {{ fact.freshness.dueAt }} · Expires: {{ fact.freshness.expiresAt }}</p>
          <p>{{ fact.freshness.limitations }}</p>
          <a :href="fact.sourceUrl">Pinned claim source</a> · Integrity: {{ fact.integrityStatus }}
        </li>
      </ul>
      <p v-else>No observations apply to the selected times.</p>
      <details>
        <summary>Observation history</summary>
        <ol>
<li v-for="record of detail.history" :key="record.id">
          {{ record.predicate }}: {{ record.state === 'known' ? record.value : record.state }}
          <p>Valid from {{ record.validFrom }} · Recorded {{ record.recordedAt }} · Actor {{ record.actorId }}</p>
          <p>{{ record.note }}</p><a :href="record.sourceUrl">Pinned claim source</a>
        </li>
</ol>
      </details>
      <details v-if="detail.allowed">
        <summary>Record asset observation</summary>
        <form @submit.prevent="observe">
          <fieldset :disabled="busy">
            <label>Source claim version ID <input v-model="observation.claimVersionId" class="form-control" required></label>
            <label>Fact / predicate <input v-model="observation.predicate" class="form-control" required maxlength="100" placeholder="For example, operating condition"></label>
            <label>Knowledge state <select v-model="observation.state" class="form-control">
              <option value="known">Known</option><option value="unknown">Unknown</option>
              <option value="not-observed">Not observed</option><option value="not-applicable">Not applicable</option>
            </select></label>
            <label v-if="observation.state === 'known'">Observed value <textarea v-model="observation.value" class="form-control" maxlength="2000"></textarea></label>
            <label>Valid from (ISO date and time) <input v-model="observation.validFrom" class="form-control" required placeholder="2026-10-01T00:00:00Z"></label>
            <label>Validity in days <input v-model.number="observation.validityDays" class="form-control" type="number" min="1" max="3650" required></label>
            <label>Grace period in days <input v-model.number="observation.graceDays" class="form-control" type="number" min="0" max="365" required></label>
            <label>Observation reason <textarea v-model="observation.note" class="form-control" required maxlength="2000"></textarea></label>
            <p>You declare the value and dates from the cited evidence. Saving preserves prior observations and does not change review decisions.</p>
            <button type="submit" class="btn btn-primary">Save observation</button>
          </fieldset>
        </form>
        <button type="button" class="btn btn-default" :disabled="busy" @click="refreshTasks">Generate due re-verification tasks</button>
      </details>
      <h4>Re-verification queue</h4>
      <p>Dispatch queued tasks to an App User and close them with the collector's visit as evidence. Superseded and cancelled tasks retain their history and do not indicate a completed field visit.</p>
      <ul>
<field-data-reverification-task v-for="task of detail.tasks" :key="task.id" :project-id="projectId"
        :task="task" :history="detail.history" @changed="reloadDetail"/>
</ul>
      <p v-if="detail.tasks.length === 0">No re-verification tasks recorded.</p>
    </template>
  </section>
</template>
<script setup>
import { onBeforeUnmount, reactive, ref, watch } from 'vue';
import useRequest from '../../composables/request';
import FieldDataReverificationTask from './reverification-task.vue';

defineOptions({ name: 'FieldDataAssets' });
const props = defineProps({
  projectId: { type: String, required: true },
  xmlFormId: { type: String, required: true },
  sourceClaimVersionId: { type: String, default: '' },
  // Ask the panel to open one asset, for example from the project queue. An object, so
  // asking for the same asset twice is still a new request.
  focus: { type: Object, default: null }
});
const { request } = useRequest();
const root = `/v1/field-data/projects/${encodeURIComponent(props.projectId)}/assets`;
const busy = ref(false);
const error = ref('');
const notice = ref('');
const loaded = ref(false);
const allowed = ref(false);
const items = ref([]);
const nextCursor = ref(null);
const assetId = ref('');
const detail = ref(null);
const at = ref('');
const knownAt = ref('');
const draft = reactive({ name: '', assetType: '', externalId: '' });
const observation = reactive({
  claimVersionId: '', predicate: '', state: 'known', value: '',
  validFrom: '', validityDays: 30, graceDays: 0, note: ''
});
watch(() => props.sourceClaimVersionId, value => { observation.claimVersionId = value; }, { immediate: true });
const retries = new Map();
let generation = 0;
onBeforeUnmount(() => { generation += 1; });
const perform = async work => {
  if (busy.value) return;
  const current = generation;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try { await work(current); } catch (e) {
    if (current === generation) error.value = e.response?.status === 412
      ? 'Another supervisor changed this asset. Reload its history and review the changes before saving.'
      : 'Asset request failed. Check source access, identifiers, dates and values, then retry.';
  } finally { if (current === generation) busy.value = false; }
};
const write = (url, data, etag) => {
  const signature = JSON.stringify({ url, data, etag });
  if (!retries.has(signature)) retries.set(signature, crypto.randomUUID());
  return request({
    method: 'POST', url, data: { ...data, requestId: retries.get(signature) },
    headers: etag == null ? {} : { 'If-Match': etag }, alert: false
  });
};
const readAsset = async current => {
  const query = new URLSearchParams();
  if (at.value) query.set('at', at.value);
  if (knownAt.value) query.set('knownAt', knownAt.value);
  const { data } = await request({ method: 'GET', url: `${root}/${assetId.value}?${query}`, alert: false });
  if (current === generation) detail.value = data;
};
const focusAsset = () => perform(async (current) => {
  const { data } = await request({ method: 'GET', url: root, alert: false });
  if (current !== generation) return;
  items.value = data.items;
  allowed.value = data.allowed;
  nextCursor.value = data.nextCursor;
  loaded.value = true;
  assetId.value = props.focus.assetId;
  detail.value = null;
  await readAsset(current);
  // The asset may sit beyond the first page of the list; keep it selectable.
  if (current === generation && detail.value != null && !items.value.some(item => item.id === assetId.value)) {
    items.value = [...items.value, detail.value.asset];
  }
});
watch(() => props.focus, (value) => { if (value?.assetId && value.xmlFormId === props.xmlFormId) focusAsset(); }, { immediate: true });
const reloadDetail = async () => {
  const current = generation;
  try { await readAsset(current); } catch { /* the task panel already reports its own outcome */ }
};
const loadAsset = () => perform(async current => {
  detail.value = null;
  if (assetId.value) await readAsset(current);
});
const loadAssets = (more = false) => perform(async current => {
  const { data } = await request({ method: 'GET', url: `${root}${more && nextCursor.value ? `?cursor=${nextCursor.value}` : ''}`, alert: false });
  if (current === generation) {
    items.value = more ? [...new Map([...items.value, ...data.items].map(item => [item.id, item])).values()] : data.items;
    allowed.value = data.allowed;
    nextCursor.value = data.nextCursor;
    loaded.value = true;
    if (!items.value.some(item => item.id === assetId.value)) { assetId.value = ''; detail.value = null; }
  }
});
const register = () => perform(async current => {
  const { data } = await write(root, { ...draft, xmlFormId: props.xmlFormId });
  const list = await request({ method: 'GET', url: root, alert: false });
  if (current === generation) {
    items.value = list.data.items;
    assetId.value = data.id;
    nextCursor.value = list.data.nextCursor;
    await readAsset(current);
    if (current === generation && !items.value.some(item => item.id === data.id)) items.value.push(detail.value.asset);
    notice.value = 'Asset registered.';
  }
});
const observe = () => perform(async current => {
  await write(`${root}/${assetId.value}/observations`, {
    ...observation,
    value: observation.state === 'known' ? observation.value : null
  }, `"asset-${detail.value.asset.revision}"`);
  if (current === generation) {
    await readAsset(current);
    notice.value = 'Observation saved. Prior evidence and review decisions are unchanged.';
  }
});
const refreshTasks = () => perform(async current => {
  const { data } = await request({ method: 'POST', url: `${root}/${assetId.value}/refresh`, alert: false });
  if (current === generation) {
    await readAsset(current);
    notice.value = `Generated ${data.generated} new re-verification tasks.`;
  }
});
</script>
<style scoped>
.asset-passports { margin-top: 24px; overflow-wrap: anywhere; }
label { display: block; margin: 12px 0; }
fieldset { min-width: 0; }
details { margin: 16px 0; }
</style>
