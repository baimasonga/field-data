<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section class="investigation-cases" aria-label="Related review cases">
    <h4>Related review cases</h4>
    <p>Link cases to inspect their live decisions and backchecks alongside this investigation. Linking or removing a case changes no decision or disposition.</p>
    <button class="btn btn-default" type="button" :disabled="loading || busy" @click="load">Refresh linked cases</button>
    <p v-if="loading" role="status">Loading case links…</p><p v-if="error" role="alert">{{ error }}</p>
    <template v-if="data">
      <p>{{ data.items.length }} active links · {{ data.eventCount }} of 500 history events. Up to 100 active links; removal capacity is reserved.</p>
      <p v-if="!data.canLink">Adding links is unavailable for a closed/archived investigation or when link capacity is reached.</p>
      <p v-if="!data.items.length">No review case is linked.</p>
      <ul class="linked-cases">
<li v-for="item of data.items" :key="item.linkId">
        <template v-if="item.available">
          <strong>{{ item.case.xmlFormId }} · {{ item.case.instanceId }}</strong> · {{ item.case.status }} · claim version {{ item.case.ordinal }}
          <span v-if="!item.case.current"> · historical source</span>
          <p>Linked by {{ item.actorName }} · <record-date-time :iso="item.linkedAt"/> · {{ item.reason }}</p>
          <button type="button" class="btn btn-default" :disabled="busy" @click="inspect(item)">Inspect linked case</button>
        </template><p v-else>Linked case unavailable. Source identifiers and link reasons are withheld until access is restored.</p>
        <button v-if="data.canRemove" type="button" class="btn btn-link" :disabled="busy || pending != null" @click="remove(item.linkId)">Remove this case link</button>
        <div v-if="inspection?.linkId === item.linkId" class="case-inspection">
          <h5>Live case status: {{ inspection.case.status }}</h5>
          <p>Source {{ inspection.case.xmlFormId }} · {{ inspection.case.instanceId }} · claim version {{ inspection.case.ordinal }} · {{ inspection.case.current ? 'current source' : 'historical source' }}</p>
          <p>Submission review state: {{ inspection.case.submissionReviewState ?? 'received' }}. This is separate from the investigation disposition.</p>
          <router-link :to="submissionPath(inspection.case.xmlFormId, inspection.case.instanceId)">Open source submission</router-link> ·
          <a :href="versionPath(inspection.case.xmlFormId, inspection.case.instanceId, inspection.case.versionInstanceId)" target="_blank" rel="noopener noreferrer">Download pinned source XML</a>
          <field-data-investigation-instrument :key="inspection.linkId" :base="`${base}/${encodeURIComponent(inspection.linkId)}`" :case-id="inspection.case.id" :project-id="projectId" @requested="inspect(item)" @unavailable="instrumentUnavailable"/>
          <h5>Review decision history</h5><p v-if="!inspection.decisions.length">No review decision recorded.</p>
          <ol>
<li v-for="decision in inspection.decisions" :key="decision.id">
<strong>{{ decision.outcome }}</strong> · {{ decision.reasonCode }}<template v-if="decision.override"> · supervisor override</template>
            <p>{{ decision.reviewerName ?? 'Unknown reviewer' }} · <record-date-time :iso="decision.createdAt"/></p><p>{{ decision.note }}</p>
</li>
</ol>
          <p v-if="inspection.decisionsOmitted">{{ inspection.decisionsOmitted }} older decisions omitted from this view.</p>
          <h5>Related backchecks</h5><p v-if="!inspection.backchecks.length">No readable backcheck is available.</p>
          <ul>
<li v-for="backcheck in inspection.backchecks" :key="backcheck.id">
            <strong>{{ backcheck.status }}</strong> · {{ backcheck.responseXmlFormId }}<template v-if="backcheck.assigneeName"> · {{ backcheck.assigneeName }}</template>
            <p>{{ backcheck.question }}</p><p v-if="backcheck.dueAt">Due <record-date-time :iso="backcheck.dueAt"/></p>
            <template v-if="backcheck.status === 'linked'">
              <p><router-link :to="submissionPath(backcheck.responseXmlFormId, backcheck.responseInstanceId)">Open backcheck response</router-link><template v-if="!backcheck.responseCurrent"> · pinned response is historical</template></p>
              <submission-backcheck-comparison :case-id="inspection.case.id" :backcheck-id="backcheck.id"/>
            </template>
          </li>
</ul><p v-if="inspection.hiddenBackchecks">{{ inspection.hiddenBackchecks }} backchecks withheld because their sources are unavailable or unreadable.</p>
          <p v-if="inspection.backchecksOmitted">{{ inspection.backchecksOmitted }} further readable backchecks omitted.</p>
        </div>
      </li>
</ul>
      <form v-if="data.canLink" @submit.prevent="search(false)">
        <fieldset :disabled="busy || pending != null">
          <label>Find review cases <input v-model="q" class="form-control" maxlength="200" placeholder="Form, source instance or case ID"></label>
          <label>Candidate status <select v-model="status" class="form-control"><option value="">All statuses</option><option value="open">Open</option><option value="in-review">In review</option><option value="resolved">Resolved</option><option value="superseded">Superseded</option></select></label>
          <button type="submit" class="btn btn-default">Search readable cases</button>
        </fieldset>
        <p v-if="searched && !candidates.length">No matching readable review cases.</p>
        <button v-if="nextCursor" type="button" class="btn btn-default" :disabled="busy || pending != null || queryChanged" @click="search(true)">Next candidate page</button>
      </form>
      <form v-if="data.canLink && candidates.length && !removing" @submit.prevent="save(false)">
        <fieldset :disabled="busy || pending != null">
          <label>Case to link <select v-model="caseId" class="form-control" required><option disabled value="">Choose a case…</option><option v-for="candidate in candidates" :key="candidate.id" :value="candidate.id" :disabled="candidate.linked">{{ candidate.xmlFormId }} · {{ candidate.instanceId }} · {{ candidate.status }} · version {{ candidate.ordinal }}{{ candidate.linked ? ' · already linked' : '' }}</option></select></label>
          <label>Reason for linking <textarea v-model="reason" class="form-control" required minlength="10" maxlength="2000" rows="2"></textarea></label>
        </fieldset>
        <button class="btn btn-primary" type="submit" :disabled="busy">{{ pending ? 'Retry same case link' : 'Link review case' }}</button>
      </form>
      <form v-if="removing && data.canRemove" @submit.prevent="save(true)">
        <fieldset :disabled="busy || pending != null"><label>Reason for removing this link <textarea v-model="reason" class="form-control" required minlength="10" maxlength="2000" rows="2"></textarea></label></fieldset>
        <p>The association and its removal stay in history.</p><button class="btn btn-default" type="submit" :disabled="busy">{{ pending ? 'Retry same link removal' : 'Confirm link removal' }}</button>
        <button type="button" class="btn btn-link" :disabled="busy || pending != null" @click="removing = null">Cancel link removal</button>
      </form>
      <details v-if="data.history.length" class="case-link-history">
<summary>Case link history</summary><ol>
<li v-for="event in data.history" :key="event.id">
        <strong>{{ event.action === 'linked' ? 'Case linked' : 'Case link removed' }}</strong> · investigation revision {{ event.investigationRevision }}
        <template v-if="event.available"><p>{{ event.case.xmlFormId }} · {{ event.case.instanceId }} · {{ event.actorName }} · <record-date-time :iso="event.createdAt"/></p><p>{{ event.reason }}</p></template>
        <p v-else>Case details and reason withheld: source unavailable or unreadable.</p>
      </li>
</ol><button v-if="data.nextBefore != null" class="btn btn-default" type="button" :disabled="busy || pending != null" @click="earlier">Load earlier case link history</button>
</details>
    </template>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import RecordDateTime from '../date-time.vue';
import SubmissionBackcheckComparison from '../submission/backcheck-comparison.vue';
import FieldDataInvestigationInstrument from './investigation-instrument.vue';
import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';

defineOptions({ name: 'FieldDataInvestigationCases' });
const props = defineProps({ projectId: { type: [String, Number], required: true }, investigationId: { type: String, required: true }, revision: { type: Number, required: true } });
const emit = defineEmits(['changed']); const { request } = useRequest();
const base = computed(() => `/v1/projects/${props.projectId}/investigations/${encodeURIComponent(props.investigationId)}/cases`);
const data = ref(null); const loading = ref(false); const busy = ref(false); const error = ref(''); const pending = ref(null); const inspection = ref(null);
const q = ref(''); const status = ref(''); const candidates = ref([]); const searched = ref(false); const nextCursor = ref(null); const caseId = ref(''); const reason = ref(''); const removing = ref(null);
let generation = 0; const lastQuery = ref(''); const lastStatus = ref('');
const queryChanged = computed(() => q.value.trim() !== lastQuery.value || status.value !== lastStatus.value);
const validCase = row => row && typeof row.id === 'string' && typeof row.xmlFormId === 'string' && typeof row.instanceId === 'string' && typeof row.versionInstanceId === 'string' && ['open', 'in-review', 'resolved', 'superseded'].includes(row.status) && Number.isInteger(row.ordinal) && row.ordinal > 0;
const validState = value => value && Number.isInteger(value.revision) && value.revision > 0 && typeof value.canLink === 'boolean' && typeof value.canRemove === 'boolean' &&
  Number.isInteger(value.eventCount) && value.eventCount >= 0 && value.eventCount <= 500 && Array.isArray(value.items) && value.items.length <= 100 && value.items.every(item => item && typeof item.linkId === 'string' && typeof item.available === 'boolean' && (!item.available || validCase(item.case))) &&
  Array.isArray(value.history) && value.history.length <= 50 && value.history.every(e => e && typeof e.id === 'string' && ['linked', 'removed'].includes(e.action) && typeof e.available === 'boolean' && (!e.available || validCase(e.case)));
const load = async () => {
  generation += 1; const current = generation; data.value = null; inspection.value = null; pending.value = null; candidates.value = []; searched.value = false; nextCursor.value = null; caseId.value = ''; removing.value = null; reason.value = ''; error.value = ''; busy.value = false; loading.value = true;
  try {
    const value = (await request({ method: 'GET', url: base.value, alert: false })).data; if (!validState(value)) throw new Error('Invalid case links'); if (current === generation) data.value = value;
  } catch { if (current === generation) error.value = 'Case links could not be loaded. Refresh to check your access.'; } finally { if (current === generation) loading.value = false; }
};
const search = async more => {
  if (busy.value || pending.value) return; const current = generation; busy.value = true; error.value = ''; caseId.value = '';
  const params = { ...(q.value.trim() ? { q: q.value.trim() } : {}), ...(status.value ? { status: status.value } : {}), ...(more && nextCursor.value ? { cursor: nextCursor.value } : {}) };
  try {
    const value = (await request({ method: 'GET', url: `${base.value}/candidates`, params, alert: false })).data;
    if (!value || !Array.isArray(value.items) || value.items.length > 50 || !value.items.every(validCase) || (value.nextCursor != null && typeof value.nextCursor !== 'string')) throw new Error('Invalid case candidates');
    if (current === generation) { candidates.value = value.items; searched.value = true; nextCursor.value = value.nextCursor; lastQuery.value = q.value.trim(); lastStatus.value = status.value; }
  } catch { if (current === generation) { candidates.value = []; nextCursor.value = null; error.value = 'Readable cases could not be loaded. Search again after checking access.'; } } finally { if (current === generation) busy.value = false; }
};
const instrumentUnavailable = () => { generation += 1; busy.value = false; loading.value = false; pending.value = null; removing.value = null; reason.value = ''; caseId.value = ''; searched.value = false; inspection.value = null; data.value = null; candidates.value = []; nextCursor.value = null; error.value = 'Instrument access changed. Refresh linked cases to check the source and response-form permissions.'; };
const remove = id => { removing.value = id; reason.value = ''; inspection.value = null; error.value = ''; };
const save = async deleting => {
  if (busy.value || !data.value) return; const current = generation; busy.value = true; error.value = '';
  pending.value ??= {
    path: deleting ? `${base.value}/${encodeURIComponent(removing.value)}/remove` : base.value, revision: data.value.revision,
    body: { requestId: crypto.randomUUID(), ...(deleting ? {} : { caseId: caseId.value }), reason: reason.value.trim() }
  };
  try {
    await request({ method: 'POST', url: pending.value.path, data: pending.value.body, headers: { 'If-Match': `"investigation-${pending.value.revision}"` }, alert: false });
    if (current === generation) { const next = generation + 1; await load(); if (next === generation) emit('changed'); }
  } catch (failure) {
    if (current === generation) error.value = [400, 403, 404, 409, 412, 428].includes(failure.response?.status) ? 'Investigation, link capacity or source access changed. Refresh linked cases before making another change.' : 'Case-link change could not be confirmed. Retry the same change or refresh linked cases.';
  } finally { if (current === generation) busy.value = false; }
};
const inspect = async item => {
  if (busy.value) return; const current = generation; inspection.value = null; busy.value = true; error.value = '';
  try {
    const value = (await request({ method: 'GET', url: `${base.value}/${encodeURIComponent(item.linkId)}`, alert: false })).data;
    if (!value || value.linkId !== item.linkId || !validCase(value.case) || !Array.isArray(value.decisions) || value.decisions.length > 50 || !Array.isArray(value.backchecks) || value.backchecks.length > 50) throw new Error('Invalid case detail');
    if (current === generation) inspection.value = value;
  } catch { if (current === generation) error.value = 'Linked case could not be opened. Its source or permissions may have changed; refresh linked cases.'; } finally { if (current === generation) busy.value = false; }
};
const earlier = async () => {
  if (busy.value || data.value?.nextBefore == null) return; const current = generation; const before = data.value.nextBefore; busy.value = true; inspection.value = null; error.value = '';
  try {
    const value = (await request({ method: 'GET', url: base.value, params: { before }, alert: false })).data; if (!validState(value)) throw new Error('Invalid case history');
    if (current === generation) { data.value = value; }
  } catch { if (current === generation) error.value = 'Earlier link history could not be loaded. Refresh to check access.'; } finally { if (current === generation) busy.value = false; }
};
const submissionPath = (formId, instanceId) => `/projects/${props.projectId}/forms/${encodeURIComponent(formId)}/submissions/${encodeURIComponent(instanceId)}`;
const versionPath = (formId, instanceId, versionId) => `${apiPaths.submission(props.projectId, formId, instanceId)}/versions/${encodeURIComponent(versionId)}.xml`;
watch(() => [props.projectId, props.investigationId, props.revision], load, { immediate: true });
onBeforeUnmount(() => { generation += 1; pending.value = null; inspection.value = null; });
</script>
<style scoped>
.investigation-cases { margin: 20px 0; padding: 16px 0; border-top: 1px solid #dce5e9; border-bottom: 1px solid #dce5e9; }
form { max-width: 600px; margin: 12px 0; } label { display: block; margin: 10px 0; font-weight: normal; } li,p,a { overflow-wrap: anywhere; } button { white-space: normal; margin: 4px 0; }
.linked-cases { padding-left: 20px; } .linked-cases > li { padding: 12px 0; border-bottom: 1px solid #e5eaed; } h5 { font-size: 15px; font-weight: bold; } summary { cursor: pointer; padding: 8px 0; }
</style>
