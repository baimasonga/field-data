<template>
  <section id="fd-form-builder">
    <h1>Form Builder</h1>
    <p>Create forms with groups, repeats, calculations, validation rules, cascading choices, and translations.</p>
    <p v-if="loading" role="status">Loading projects…</p>
    <div v-else-if="error" role="alert">
      <p>{{ error }}</p>
      <button type="button" class="btn btn-default" @click="load">Retry</button>
    </div>
    <template v-else-if="projects.length">
      <label for="builder-project">Project</label>
      <select id="builder-project" v-model="projectId" class="form-control">
        <option value="" disabled>Select a project</option>
        <option v-for="project of projects" :key="project.id" :value="project.id">{{ project.name }}</option>
      </select>
      <router-link v-if="projectId" class="btn btn-primary"
        :to="`/projects/${projectId}/new-form?builder=advanced`">
Open Advanced Form Builder
</router-link>
      <p>Select a project, then create a draft or load an existing builder definition. Validate the form before publishing.</p>
    </template>
    <p v-else>You need permission to create forms in a project. Ask a project manager for access.</p>
  </section>
</template>

<script setup>
import { ref } from 'vue';
import useRequest from '../../composables/request';

defineOptions({ name: 'FieldDataFormBuilder' });
const { request } = useRequest();
const projects = ref([]);
const projectId = ref('');
const loading = ref(false);
const error = ref('');
const load = async () => {
  loading.value = true;
  error.value = '';
  try {
    const { data } = await request({ method: 'GET', url: '/v1/projects', extended: true, alert: false });
    projects.value = data.filter(project => project.verbs?.includes('form.create'));
  } catch {
    error.value = 'Projects could not be loaded. Retry to open the form builder.';
  } finally {
    loading.value = false;
  }
};
load();
</script>

<style scoped>
#fd-form-builder { max-width: 800px; }
select { margin: 8px 0 20px; }
.btn { margin-bottom: 16px; }
</style>
