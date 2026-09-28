<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

The list of Projects. The dashboard took over "/" and left the Project list
with nowhere to live, which removed the only way to reach an archived Project,
create a new one, or search across them. This page gives it a route again.
-->
<template>
  <div id="projects-page">
    <page-body>
      <div v-if="config.home.title != null" id="projects-news-container">
        <home-config-section :title="config.home.title" :body="config.home.body"/>
      </div>
      <project-list/>
    </page-body>
  </div>
</template>

<script setup>
import { defineAsyncComponent, inject } from 'vue';

import PageBody from './page/body.vue';
import ProjectList from './project/list.vue';

import useProjects from '../request-data/projects';
import { loadAsync } from '../util/load-async';
import { noop } from '../util/util';

defineOptions({
  name: 'ProjectsPage'
});

const HomeConfigSection = defineAsyncComponent(loadAsync('HomeConfigSection'));

const projects = useProjects();
projects.request({ url: '/v1/projects?forms=true&datasets=true' }).catch(noop);

const config = inject('config');
</script>

<style lang="scss">
#projects-news-container {
  display: flex;
  > * { flex: 1; }
}
</style>
