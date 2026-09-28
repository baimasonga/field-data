<!--
Copyright 2017 ODK Central Developers
See the NOTICE file at the top-level directory of this distribution and at
https://github.com/getodk/central-frontend/blob/master/NOTICE.

This file is part of ODK Central. It is subject to the license terms in
the LICENSE file found in the top-level directory of this distribution and at
https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
including this file, may be copied, modified, propagated, or distributed
except according to the terms contained in the LICENSE file.
-->
<template>
  <div>
    <breadcrumbs v-if="project.dataExists" :links="breadcrumbLinks"/>
    <page-head v-show="project.dataExists">
      <template v-if="project.dataExists" #title>
        {{ project.nameWithArchived }}
      </template>
      <template #description>
        <project-overview-description v-if="project.dataExists"
        :description="project.description" :can-update="canUpdate"/>
      </template>
        <template #tabs>
        <!-- Four groups rather than nine tabs. Every view keeps its own route;
        the ones inside the open group are in the row below. -->
        <li v-for="group in tabGroups" :key="group.key" :class="groupClass(group)"
          role="presentation">
          <router-link :to="tabPath(group.primary)">
            {{ group.label }}
            <span v-if="group.badge != null" class="badge">{{ group.badge }}</span>
          </router-link>
        </li>
      </template>
    </page-head>
    <nav v-if="subtabs.length > 1" id="project-subtabs" class="page-subtabs"
      :aria-label="$t('subnav.label')">
      <router-link v-for="view in subtabs" :key="view.path" :to="tabPath(view.path)"
        :class="{ active: $route.path === tabPath(view.path) }">
        {{ view.label }}
        <span v-if="view.badge != null" class="badge">{{ view.badge }}</span>
      </router-link>
    </nav>
    <page-body>
      <loading :state="project.initiallyLoading"/>
      <!-- <router-view> may send its own requests before the server has
      responded to ProjectShow's request for the project. -->
      <router-view v-show="project.dataExists" @fetch-project="fetchProject"
        @fetch-forms="fetchForms" @fetch-field-keys="fetchFieldKeys"
        @fetch-actor-properties="fetchActorProperties"/>
    </page-body>
  </div>
</template>

<script>
import Breadcrumbs from '../breadcrumbs.vue';
import Loading from '../loading.vue';
import PageBody from '../page/body.vue';
import PageHead from '../page/head.vue';
import ProjectOverviewDescription from './overview/description.vue';

import useDatasets from '../../request-data/datasets';
import useProject from '../../request-data/project';
import useRoutes from '../../composables/routes';
import useTabs from '../../composables/tabs';
import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';
import { useRequestData } from '../../request-data';

// Nine tabs, grouped by what somebody came to the Project to do. Order within
// a group is the order of the row beneath the tabs.
const TAB_GROUPS = [
  {
    key: 'forms', labelKey: 'resource.forms',
    // The Forms list is the Project's own page, and creating a Form is part
    // of it rather than a destination of its own.
    members: [{ path: '', alsoActive: ['new-form'] }]
  },
  {
    key: 'data', labelKey: 'group.data',
    members: [
      { path: 'summary', labelKey: 'projectShow.tab.summary' },
      { path: 'merged-datasets', labelKey: 'projectShow.tab.mergedDatasets' },
      { path: 'reports', labelKey: 'projectShow.tab.reports' }
    ]
  },
  // Entity Lists stays a tab of its own rather than joining Data. It is
  // reference data the Forms read and write, not something produced by
  // analysing them, and its count is a signal worth keeping in the tab bar.
  {
    key: 'entity-lists', labelKey: 'resource.entityLists',
    members: [{ path: 'entity-lists', badge: 'datasets' }]
  },
  // Who may collect, and what they may see: Custom Properties controls which
  // Entities an App User or Public Link can reach, and Form Access is which
  // Forms they get, so both are about people rather than about the Project.
  {
    key: 'people', labelKey: 'group.people',
    members: [
      { path: 'users', labelKey: 'resource.projectRoles' },
      { path: 'app-users', labelKey: 'resource.appUsers' },
      { path: 'form-access', labelKey: 'projectShow.tab.formAccess' },
      { path: 'custom-properties', labelKey: 'projectShow.tab.customProperties' }
    ]
  },
  {
    key: 'settings', labelKey: 'common.tab.settings',
    members: [{ path: 'settings' }]
  }
];

export default {
  name: 'ProjectShow',
  components: { Breadcrumbs, Loading, PageBody, PageHead, ProjectOverviewDescription },
  props: {
    projectId: {
      type: String,
      required: true
    }
  },
  setup() {
    const { createResource } = useRequestData();
    const { project, forms, fieldKeys } = useProject();
    const { datasets, deletedDatasets } = useDatasets();
    const { projectPath, canRoute } = useRoutes();
    const { tabPath, tabClass } = useTabs(projectPath());
    const actorProperties = createResource('actorProperties');

    return {
      project, forms, datasets, deletedDatasets, fieldKeys, actorProperties,
      tabPath, tabClass, projectPath, canRoute
    };
  },
  computed: {
    tabGroups() {
      const groups = [];
      for (const group of TAB_GROUPS) {
        // The Forms list is reachable by anyone who can open the Project; the
        // rest each carry their own guard.
        const members = group.members
          .filter(member => member.path === '' || this.canRoute(this.tabPath(member.path)))
          .map(member => ({
            ...member,
            label: member.labelKey != null ? this.$t(member.labelKey) : null,
            badge: this.memberBadge(member)
          }));
        if (members.length === 0) continue; // eslint-disable-line no-continue
        groups.push({
          key: group.key,
          label: this.$t(group.labelKey),
          members,
          primary: members[0].path,
          // A group holding one view is that view, so its count belongs on
          // the tab: otherwise somebody who can only reach Entity Lists never
          // sees how many there are, because the row below is not drawn for a
          // single view.
          badge: this.groupBadge(group, members)
        });
      }
      return groups;
    },
    activeGroup() {
      return this.tabGroups.find(group => group.members.some(member =>
        this.$route.path === this.tabPath(member.path) ||
        (member.alsoActive ?? []).some(path => this.$route.path === this.tabPath(path))));
    },
    subtabs() {
      return this.activeGroup == null ? [] : this.activeGroup.members;
    },
    breadcrumbLinks() {
      return [
        { text: this.project.dataExists ? this.project.nameWithArchived : this.$t('resource.project'), path: this.projectPath(), icon: 'icon-archive' }
      ];
    },
    canUpdate() {
      return this.project.dataExists && this.project.permits('project.update');
    }
  },
  created() {
    this.fetchProject(false);
  },
  methods: {
    groupBadge(group, members) {
      if (group.key === 'forms') {
        return this.project.dataExists
          ? this.$n(this.project.forms, 'default')
          : null;
      }
      return members.length === 1 ? members[0].badge : null;
    },
    memberBadge(member) {
      if (member.badge !== 'datasets' || !this.project.dataExists) return null;
      return this.$n(this.project.datasets, 'default');
    },
    groupClass(group) {
      const paths = group.members
        .flatMap(member => [member.path, ...(member.alsoActive ?? [])]);
      return this.tabClass(...paths);
    },
    fetchProject(resend) {
      this.project.request({
        url: apiPaths.project(this.projectId),
        extended: true,
        resend
      }).catch(noop);
    },
    fetchForms(resend) {
      this.forms.request({
        url: apiPaths.forms(this.projectId),
        extended: true,
        resend
      }).catch(noop);

      // If we send a request for this.forms, then we also clear this.datasets
      // in case a change to this.forms has also changed this.datasets.
      if (!this.forms.dataExists) {
        this.datasets.data = null;
        this.deletedDatasets.data = null;
      }
    },
    fetchFieldKeys(resend) {
      this.fieldKeys.request({
        url: apiPaths.fieldKeys(this.projectId),
        extended: true,
        resend
      }).catch(noop);
    },
    fetchActorProperties() {
      this.actorProperties.request({
        url: apiPaths.actorProperties(this.projectId),
        resend: false
      }).catch(noop);
    }
  }
};
</script>

<i18n lang="json5">
{
  "en": {
    "subnav": {
      // Names the row of views inside the open Project tab, for screen readers.
      "label": "Views"
    },
    "group": {
      // Tab grouping the Project's summary, merged datasets, reports and
      // Entity Lists.
      "data": "Data",
      // Tab grouping who may work on this Project: its roles, App Users, Form
      // Access and Custom Properties.
      "people": "People"
    }
  }
}
</i18n>
