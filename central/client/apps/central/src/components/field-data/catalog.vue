<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section id="fd-catalog">
    <h1>{{ manage ? 'Publish to the public catalogue' : 'Public data catalogue' }}</h1>
    <p>Only explicitly published, protected aggregate snapshots appear here. Public downloads carry the displayed licence and attribution.</p>
    <template v-if="manage">
      <p>Do not publish personal or sensitive choice names. Previously downloaded public files cannot be recalled. Each release contains one categorical distribution; raw records, media and locations are excluded.</p>
      <label>Project<select v-model="projectId" class="form-control"><option value="">Choose project</option><option v-for="p of projects" :key="p.id" :value="String(p.id)">{{ p.name }}</option></select></label>
      <label>Published form<select v-model="formId" class="form-control"><option value="">Choose form</option><option v-for="f of forms" :key="f.id" :value="String(f.id)">{{ f.name }}</option></select></label>
      <label>Single-choice field<select v-model="column" class="form-control"><option value="">Choose a field</option><option v-for="f of fields" :key="f.path" :value="f.path">{{ f.path }}</option></select></label>
      <label v-for="field of ['title', 'description', 'label', 'attribution']" :key="field">Public {{ field }}<input v-model="config[field]" class="form-control" @input="invalidate"></label>
      <label>Licence<select v-model="config.license" class="form-control" @change="invalidate"><option v-for="license of ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0']" :key="license">{{ license }}</option></select></label>
      <label>Approved category names (one per line)<textarea v-model="categoryText" class="form-control" rows="4" @input="invalidate"></textarea></label>
      <button type="button" class="btn btn-default" :disabled="busy || !formId" @click="preview">Preview exact public release</button>
      <div v-if="previewResult">
<pre>{{ JSON.stringify({ metadata: previewResult.metadata, release: previewResult.release }, null, 2) }}</pre>
        <label><input v-model="confirmed" type="checkbox"> I reviewed the licence, attribution and every released value, and approve public discovery and download.</label>
        <button type="button" class="btn btn-primary" :disabled="busy || !confirmed || previewResult.release.suppressed" @click="publish">Publish this snapshot</button>
      </div>
      <h2>Project publication history</h2>
      <p v-for="r of history" :key="r.id">
{{ r.metadata.title }} · {{ r.published ? 'Published' : 'Revoked' }}
        <button v-if="r.published" type="button" class="btn btn-default" @click="revoke(r.id)">Unpublish and revoke URL</button>
</p>
      <a href="/catalog">Browse anonymous catalogue</a>
    </template>
    <template v-else>
      <form @submit.prevent="search"><label>Search published titles and descriptions<input v-model="term" class="form-control" maxlength="100"></label><button type="submit" class="btn btn-primary" :disabled="busy">Search</button></form>
      <p v-if="!busy && !records.length">No published releases found.</p>
      <article v-for="r of records" :key="r.id"><h2><button type="button" class="btn btn-link" @click="open(r.id)">{{ r.title }}</button></h2><p>{{ r.description }}</p><p>{{ r.license }} · {{ r.attribution }} · {{ r.publishedAt }}</p></article>
      <article v-if="detail">
<h2>{{ detail.title }}</h2><p>{{ detail.release.label }}</p><p>{{ detail.release.disclosure }}</p>
        <table class="table"><thead><tr><th>Approved category</th><th>Records</th></tr></thead><tbody><tr v-for="v of detail.release.values" :key="v.value"><td>{{ v.value }}</td><td>{{ v.count }}</td></tr></tbody></table>
        <p>Download under {{ detail.license }} with attribution: {{ detail.attribution }}.</p><button type="button" class="btn btn-default" @click="download">Accept terms and download JSON</button>
</article>
    </template>
    <p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
  </section>
</template>
<script setup>
import { reactive, ref, watch } from 'vue';
import useRequest from '../../composables/request';

defineOptions({ name: 'FieldDataCatalog' });
const props = defineProps({ manage: Boolean }); const { request } = useRequest();
const busy = ref(false); const error = ref(''); const notice = ref(''); const term = ref(''); const records = ref([]); const detail = ref(null);
const projects = ref([]); const projectId = ref(''); const formId = ref(''); const forms = ref([]); const fields = ref([]); const column = ref(''); const history = ref([]);
const config = reactive({ title: '', description: '', label: '', attribution: '', license: 'CC-BY-4.0' }); const categoryText = ref(''); const previewResult = ref(null); const confirmed = ref(false);
let generation = 0; const projectGeneration = 0; let formGeneration = 0; let publicationId = null;
const invalidate = () => { previewResult.value = null; confirmed.value = false; publicationId = null; };
const base = () => `/v1/projects/${projectId.value}/catalog`;
const payload = () => ({ ...config, source: { kind: 'form', id: Number(formId.value) }, column: column.value, categories: categoryText.value.split('\n').map(v => v.trim()).filter(Boolean) });
const attempt = async fn => { busy.value = true; error.value = ''; try { await fn(); } catch (e) { error.value = e.response?.data?.message || 'The catalogue request failed. Retry after checking the selection.'; } finally { busy.value = false; } };
const search = () => attempt(async () => { generation += 1; const current = generation; const { data } = await request({ method: 'GET', url: `/v1/field-data/catalog?q=${encodeURIComponent(term.value)}`, alert: false }); if (current === generation) records.value = data; });
const open = id => attempt(async () => { detail.value = null; detail.value = (await request({ method: 'GET', url: `/v1/field-data/catalog/${id}`, alert: false })).data; });
const download = () => attempt(async () => { const { data } = await request({ method: 'GET', url: `/v1/field-data/catalog/${detail.value.id}`, alert: false }); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `public-release-${data.id}.json`; a.click(); URL.revokeObjectURL(url); });
const loadHistory = async () => { history.value = (await request({ method: 'GET', url: base(), alert: false })).data; };
const preview = () => attempt(async () => { invalidate(); previewResult.value = (await request({ method: 'POST', url: `${base()}/preview`, data: payload(), alert: false })).data; });
const publish = () => attempt(async () => { publicationId ||= crypto.randomUUID(); await request({ method: 'POST', url: `${base()}/publish`, data: { ...payload(), previewHash: previewResult.value.hash, confirmPublication: confirmed.value, id: publicationId }, alert: false }); invalidate(); notice.value = 'Snapshot published. Its public release is now discoverable.'; await loadHistory(); });
const revoke = id => attempt(async () => { await request({ method: 'DELETE', url: `${base()}/${id}`, alert: false }); await loadHistory(); notice.value = 'Publication revoked. Previously downloaded files cannot be recalled.'; });
watch(projectId, async () => {
  generation += 1; const current = generation; forms.value = []; formId.value = ''; fields.value = []; history.value = []; invalidate(); if (!projectId.value) return;
  await attempt(async () => { const [sources, releases] = await Promise.all([request({ method: 'GET', url: `/v1/projects/${projectId.value}/analysis/sources`, alert: false }), request({ method: 'GET', url: base(), alert: false })]); if (current === projectGeneration) { forms.value = sources.data.forms; history.value = releases.data; } });
});
watch(formId, async () => { formGeneration += 1; const current = formGeneration; fields.value = []; column.value = ''; invalidate(); if (!formId.value) return; await attempt(async () => { const { data } = await request({ method: 'POST', url: `/v1/projects/${projectId.value}/analysis/query`, data: { source: { kind: 'form', id: Number(formId.value) }, limit: 1 }, alert: false }); if (current === formGeneration) fields.value = data.fields.filter(f => f.type === 'string' && !f.selectMultiple); }); });
watch(column, invalidate);
if (props.manage) attempt(async () => { projects.value = (await request({ method: 'GET', url: '/v1/projects', extended: true })).data.filter(p => p.verbs?.includes('project.update')); }); else search();
</script>
<style>#fd-catalog label { display: block; margin: 12px 0; max-width: 720px; } #fd-catalog pre { white-space: pre-wrap; } #fd-catalog article { padding: 12px; border-bottom: 1px solid #ddd; }</style>
