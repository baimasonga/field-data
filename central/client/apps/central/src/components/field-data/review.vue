<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <div id="fd-review">
    <header>
      <h1>{{ $t('title') }}</h1>
      <p>{{ $t('subtitle') }}</p>
    </header>
    <loading :state="projects.initiallyLoading"/>
    <div v-if="loadFailed" role="alert">
      <p>{{ $t('loadFailed') }}</p>
      <button type="button" class="btn btn-default" @click="reload">{{ $t('retry') }}</button>
    </div>
    <template v-if="projects.dataExists">
      <p v-if="availableProjects.length === 0">{{ $t('noProjects') }}</p>
      <template v-else>
        <div class="review-scope">
          <label for="review-project">{{ $t('project') }}
            <select id="review-project" v-model="projectId" class="form-control">
              <option v-for="project of availableProjects" :key="project.id" :value="String(project.id)">
                {{ project.name }}
              </option>
            </select>
          </label>
          <label for="review-form">{{ $t('form') }}
            <select id="review-form" v-model="xmlFormId" class="form-control" :disabled="forms.length === 0">
              <option v-for="form of forms" :key="form.xmlFormId" :value="form.xmlFormId">
                {{ form.name || form.xmlFormId }}
              </option>
            </select>
          </label>
          <button type="button" class="btn btn-default" :disabled="projects.awaitingResponse" @click="reload">
            {{ $t('refresh') }}
          </button>
        </div>
        <p v-if="forms.length === 0">{{ $t('noForms') }}</p>
        <submission-review-queue v-else :key="`${projectId}:${xmlFormId}`"
          :project-id="projectId" :xml-form-id="xmlFormId" :can-review="canReview"
          @asset-source="sourceClaimVersionId = $event"/>
        <field-data-findings-inbox v-if="projectId" :key="`findings:${projectId}`" :project-id="projectId"/>
        <field-data-collector-groups v-if="projectId" :key="`collectors:${projectId}`" :project-id="projectId"/>
        <field-data-project-search v-if="projectId" :key="`search:${projectId}`" :project-id="projectId" @open="openFromQueue"/>
        <field-data-asset-status v-if="projectId" :key="`status:${projectId}`" :project-id="projectId" @open="openFromQueue"/>
        <field-data-reverification-queue v-if="projectId" :key="`queue:${projectId}`"
          :project-id="projectId" @open="openFromQueue"/>
        <field-data-assets v-if="projectId && xmlFormId" :key="`assets:${projectId}:${xmlFormId}`"
          :project-id="projectId" :xml-form-id="xmlFormId" :source-claim-version-id="sourceClaimVersionId"
          :focus="assetFocus"/>
      </template>
    </template>
    <details v-if="canManageQuality" class="submission-quality" @toggle="qualityOpen = $event.target.open">
      <summary>{{ $t('qualityChecks') }}</summary>
      <field-data-submission-review v-if="qualityOpen"/>
    </details>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import Loading from '../loading.vue';
import SubmissionReviewQueue from '../submission/review-queue.vue';
import FieldDataSubmissionReview from './submission-review.vue';
import FieldDataAssets from './assets.vue';
import FieldDataReverificationQueue from './reverification-queue.vue';
import FieldDataFindingsInbox from './findings-inbox.vue';
import FieldDataCollectorGroups from './collector-groups.vue';
import FieldDataProjectSearch from './project-search.vue';
import FieldDataAssetStatus from './asset-status.vue';
import { useRequestData } from '../../request-data';

defineOptions({ name: 'FieldDataReview' });
const { createResource, currentUser } = useRequestData();
const qualityOpen = ref(false);
const canManageQuality = computed(() => currentUser.dataExists && currentUser.can('project.create'));
const projects = createResource('reviewProjects');
const projectId = ref('');
const xmlFormId = ref('');
const sourceClaimVersionId = ref('');
const assetFocus = ref(null);
watch(projectId, () => { assetFocus.value = null; });
watch(() => [projectId.value, xmlFormId.value], () => {
  sourceClaimVersionId.value = '';
  // A request to open an asset belongs to one form; drop it once the selection moves elsewhere.
  if (assetFocus.value != null && assetFocus.value.xmlFormId !== xmlFormId.value) assetFocus.value = null;
});
// Opening a task from the project queue (or an asset from the search or status table) selects the form it
// belongs to and asks the asset panel to show that asset, where a task can be dispatched,
// closed or cancelled.
const openFromQueue = (task) => {
  xmlFormId.value = task.xmlFormId;
  assetFocus.value = { assetId: task.assetId, xmlFormId: task.xmlFormId, at: Date.now() };
};
const loadFailed = ref(false);
const availableProjects = computed(() => (projects.dataExists
  ? projects.data.filter(project => project.verbs?.includes('submission.read')) : []));
const selectedProject = computed(() => availableProjects.value.find(project => String(project.id) === projectId.value));
const forms = computed(() => selectedProject.value?.formList || []);
const canReview = computed(() => selectedProject.value?.verbs?.includes('submission.update') === true);
const reload = () => {
  loadFailed.value = false;
  return projects.request({ url: '/v1/projects?forms=true', extended: true, resend: true })
    .catch(() => { loadFailed.value = true; });
};
watch(availableProjects, value => {
  if (!value.some(project => String(project.id) === projectId.value))
    projectId.value = value.length === 0 ? '' : String(value[0].id);
});
watch(forms, value => {
  if (!value.some(form => form.xmlFormId === xmlFormId.value))
    xmlFormId.value = value[0]?.xmlFormId || '';
});
reload();
</script>

<i18n lang="json5">
{
  "en": {
    "title": "Review Queue",
    "subtitle": "Choose a project and form to inspect claim versions, evidence, provenance, decisions and back-checks.",
    "qualityChecks": "Submission quality checks and rules",
    "project": "Project", "form": "Form", "refresh": "Refresh projects", "retry": "Try again",
    "loadFailed": "Projects could not be loaded. Please try again.",
    "noProjects": "No projects with submission read access are available.",
    "noForms": "No forms are available in this project."
  }
}
</i18n>

<style lang="scss">
#fd-review {
  header { margin-bottom: 20px; }
  h1 { font-size: 24px; margin: 0 0 8px; }
  .submission-quality { margin-top: 24px; summary { cursor: pointer; margin-bottom: 16px; } }
  .review-scope {
    display: flex; flex-wrap: wrap; align-items: flex-end; gap: 16px; margin-bottom: 24px;
    label { flex: 1; min-width: 180px; margin: 0; }
    select { margin-top: 6px; }
  }
}
</style>
