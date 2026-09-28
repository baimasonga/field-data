<!--
Copyright 2022 ODK Central Developers
See the NOTICE file at the top-level directory of this distribution and at
https://github.com/getodk/central-frontend/blob/master/NOTICE.

This file is part of ODK Central. It is subject to the license terms in
the LICENSE file found in the top-level directory of this distribution and at
https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
including this file, may be copied, modified, propagated, or distributed
except according to the terms contained in the LICENSE file.

Field Data: each Project is now a white card with a header (name + summary +
"Open project") and a properly labelled Forms table, replacing the original
unlabelled icon columns. Entity lists keep their existing rendering.
-->
<template>
  <div class="fd-project-card">
    <div class="fd-project-head">
      <router-link :to="projectPath(project.id)" class="fd-project-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
      </router-link>
      <div class="fd-project-title">
        <div class="nm-row">
          <router-link :to="projectPath(project.id)" class="nm">{{ project.name }}</router-link>
          <template v-if="project.keyId">
            <span class="fd-enc" aria-hidden="true" v-tooltip.sr-only>
              <span class="icon-lock"></span>{{ $t('encrypted') }}
            </span>
            <span class="sr-only">{{ $t('encryptionTip') }}</span>
          </template>
        </div>
        <div class="mt">{{ $tcn('summary.forms', numForms) }} · {{ $tcn('summary.subs', totalSubmissions) }}</div>
      </div>
      <router-link :to="projectPath(project.id)" class="fd-project-open">
        {{ $t('openProject') }}<span class="icon-angle-right"></span>
      </router-link>
    </div>

    <table v-if="visibleForms.length > 0" class="fd-forms-table">
      <thead>
        <tr>
          <th>{{ $t('th.form') }}</th>
          <th class="r">{{ $t('th.submissions') }}</th>
          <th class="r">{{ $t('th.needsReview') }}</th>
          <th class="r">{{ $t('th.lastSubmission') }}</th>
          <th class="r">{{ $t('th.status') }}</th>
        </tr>
      </thead>
      <tbody>
        <project-form-row v-for="form of visibleForms" :key="form.xmlFormId"
          :form="form" :project="project"/>
        <tr v-if="showExpander" class="fd-expand">
          <td colspan="5">
            <a href="#" role="button" @click.prevent="toggleExpanded">
              <template v-if="!formExpanded">{{ $tcn('showMore', numForms) }}<span class="icon-angle-down"></span></template>
              <template v-else>{{ $tcn('showFewer', numForms) }}<span class="icon-angle-up"></span></template>
            </a>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Entity lists (datasets) keep their original rendering. -->
    <table v-if="visibleDataset.length > 0" class="project-table table fd-dataset-table">
      <project-dataset-row v-for="(dataset, index) of visibleDataset" :key="dataset.name"
        :dataset="dataset" :project="project" :show-icon="index === 0"/>
      <tr v-if="showDatasetExpander" class="project-dataset-row transparent-bg">
        <td class="col-icon"></td>
        <td colspan="2" class="expand-button-container">
          <a href="#" role="button" class="expand-button" @click.prevent="toggleDatasetExpanded">
            <template v-if="!datasetExpanded">{{ $tcn('showMoreDatasets', numDatasets) }}<span class="icon-angle-down"></span></template>
            <template v-else>{{ $tcn('showFewerDatasets', numDatasets) }}<span class="icon-angle-up"></span></template>
          </a>
        </td>
        <td v-if="hiddenConflicts > 0" colspan="2" class="conflicts-count">
          <a href="#" role="button" class="btn btn-danger" @click.prevent="toggleDatasetExpanded">
            {{ $tcn('entity.conflictsCount', hiddenConflicts) }}<span class="icon-warning"></span>
          </a>
        </td>
        <td v-if="hiddenConflicts > 0" colspan="2" class="conflict-caption">
          <span>{{ $t('hidden') }}</span>
        </td>
      </tr>
    </table>

    <p v-if="visibleForms.length === 0 && visibleDataset.length === 0" class="fd-project-empty">
      {{ $t('noForms') }}
    </p>
  </div>
</template>

<script>
import ProjectFormRow from './form-row.vue';
import ProjectDatasetRow from './dataset-row.vue';

import useRoutes from '../../composables/routes';

export default {
  name: 'ProjectHomeBlock',
  components: { ProjectFormRow, ProjectDatasetRow },
  props: {
    project: { type: Object, required: true },
    sortFunc: { type: Function, required: true },
    maxForms: { type: Number, default: 3 },
    maxDatasets: { type: Number, default: 3 }
  },
  setup() {
    const { projectPath } = useRoutes();
    return { projectPath };
  },
  data() {
    return { formExpanded: false, datasetExpanded: false };
  },
  computed: {
    visibleForms() {
      const sortedForms = this.project.formList.filter((f) => f.state !== 'closed');
      sortedForms.sort(this.sortFunc);
      return this.formExpanded ? sortedForms : sortedForms.slice(0, this.maxForms);
    },
    totalSubmissions() {
      return this.project.formList.reduce((n, f) => n + (f.submissions || 0), 0);
    },
    sortedDatasets() {
      return [...this.project.datasetList].sort(this.sortFunc);
    },
    visibleDataset() {
      return this.datasetExpanded ? this.sortedDatasets : this.sortedDatasets.slice(0, this.maxDatasets);
    },
    hiddenConflicts() {
      return this.datasetExpanded ? 0 : this.sortedDatasets.slice(this.maxDatasets).reduce((n, { conflicts }) => n + conflicts, 0);
    },
    showExpander() {
      return this.numForms > this.maxForms;
    },
    numForms() {
      return this.project.formList.filter((f) => f.state !== 'closed').length;
    },
    showDatasetExpander() {
      return this.numDatasets > this.maxDatasets;
    },
    numDatasets() {
      return this.project.datasetList.length;
    }
  },
  methods: {
    toggleExpanded() { this.formExpanded = !this.formExpanded; },
    toggleDatasetExpanded() { this.datasetExpanded = !this.datasetExpanded; }
  }
};
</script>

<style lang="scss">
@import '../../assets/scss/mixins';

.fd-project-card {
  background: #fff;
  border: 1px solid #e4ebed;
  border-radius: 14px;
  box-shadow: 0 1px 2px rgba(18, 48, 58, 0.05);
  margin-bottom: 20px;
  overflow: hidden;
  transition: box-shadow 0.18s;

  &:hover { box-shadow: 0 8px 24px rgba(18, 48, 58, 0.09); }

  .fd-project-head {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 16px 22px;
    border-bottom: 1px solid #eef3f4;
  }
  .fd-project-mark {
    width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(135deg, rgba(14,116,144,0.13), rgba(46,139,90,0.14));
    color: #0E7490;
    svg { width: 20px; height: 20px; }
  }
  .fd-project-title { flex: 1; min-width: 0; }
  .nm-row { display: flex; align-items: center; gap: 9px; }
  .nm {
    font-size: 16.5px; font-weight: 700; color: #12303a; letter-spacing: -0.01em;
    &:hover { color: #0E7490; }
  }
  .fd-enc {
    font-size: 11px; font-weight: 600; color: #1f6e45;
    background: #e2f3ea; border-radius: 5px; padding: 1px 7px;
  }
  .mt { font-size: 13px; color: #5f7278; margin-top: 2px; }
  .fd-project-open {
    color: #0E7490; font-weight: 600; font-size: 13.5px; white-space: nowrap;
    display: inline-flex; align-items: center; gap: 4px;
    .icon-angle-right { font-size: 15px; }
    &:hover { color: #0A5A72; }
  }

  .fd-forms-table {
    width: 100%;
    border-collapse: collapse;

    thead th {
      text-align: left;
      font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
      color: #8fa1a7;
      padding: 11px 16px;
      border-bottom: 1px solid #eef3f4;
      &.r { text-align: right; }
    }
  }

  .fd-expand td {
    padding: 10px 16px;
    border-top: 1px solid #eef3f4;
    a { @include text-link; font-size: 13.5px; color: #0E7490; font-weight: 600; }
    .icon-angle-down, .icon-angle-up { margin-left: 5px; }
  }

  .fd-project-empty {
    padding: 20px 22px; color: #8fa1a7; font-size: 14px; margin: 0;
  }

  // Entity-list table keeps its original look.
  .fd-dataset-table {
    margin: 6px 12px 12px;
    .transparent-bg { background: transparent !important; }
    .col-icon {
      width: 35px; background: #e3e4e4; padding: 5px 0; text-align: center;
      border-right: 2px solid #2E8B5A;
      span { color: #2E8B5A; margin-left: 0; }
    }
    .project-dataset-row:nth-child(3n + 1) { background: #f4f7f8; }
    .expand-button-container { padding-left: 6px; font-size: 14px; color: #888; }
    .expand-button { @include text-link; &:focus { background-color: transparent; } }
    .conflicts-count { text-align: right; .btn-danger { color: #fff; font-size: 14px; padding: 2px 7px; } }
    .conflict-caption { font-size: 14px; color: #888; padding: 6px 10px; }
  }
}
</style>


<i18n lang="json5">
{
  "en": {
    "encrypted": "Encrypted",
    "encryptionTip": "This Project uses managed encryption.",
    "openProject": "Open project",
    "noForms": "This project has no forms yet.",
    "th": {
      "form": "Form",
      "submissions": "Submissions",
      "needsReview": "Needs review",
      "lastSubmission": "Last submission",
      "status": "Status"
    },
    "summary": {
      "forms": "{count} form | {count} forms",
      "subs": "{count} submission | {count} submissions"
    },
    "showMore": "Show {count} total Form | Show {count} total Forms",
    "showMoreDatasets": "Show {count} total Entity List | Show {count} total Entity Lists",
    "showFewer": "Show fewer of {count} total Form | Show fewer of {count} total Forms",
    "showFewerDatasets": "Show fewer of {count} total Entity List | Show fewer of {count} total Entity Lists",
    "hidden": "hidden"
  }
}
</i18n>
