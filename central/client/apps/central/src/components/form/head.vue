<!--
Copyright 2020 ODK Central Developers
See the NOTICE file at the top-level directory of this distribution and at
https://github.com/getodk/central-frontend/blob/master/NOTICE.

This file is part of ODK Central. It is subject to the license terms in
the LICENSE file found in the top-level directory of this distribution and at
https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
including this file, may be copied, modified, propagated, or distributed
except according to the terms contained in the LICENSE file.
-->
<template>
  <div id="form-head">
    <breadcrumbs v-if="project.dataExists" :links="breadcrumbLinks"/>
    <page-head>
      <template #title>{{ form.dataExists ? form.nameOrId : '' }}</template>
      <template #infonav>
        <infonav v-if="project.dataExists && formDatasetDiff.dataExists && publishedAttachments.dataExists
          && uniqueDatasetCount > 0">
          <template #title>
            <span class="icon-magic"></span>{{ $tc('infoNav.entityLists', uniqueDatasetCount) }}
          </template>
          <template #dropdown>
            <li v-if="formDatasetDiff.length > 0">
              <span class="dropdown-header">{{ $t('infoNav.updatedDatasets') }}</span>
            </li>
            <li v-for="dataset in formDatasetDiff" :key="dataset.name">
              <dataset-link :name="dataset.name" :project-id="project.id"/>
            </li>
            <li v-if="formDatasetDiff.length > 0 && publishedAttachments.linkedDatasets.length > 0"><hr class="dropdown-divider"></li>
            <li v-if="publishedAttachments.linkedDatasets.length > 0">
              <span class="dropdown-header">{{ $t('infoNav.attachedDatasets') }}</span>
            </li>
            <li v-for="dataset in publishedAttachments.linkedDatasets" :key="dataset">
              <dataset-link :name="dataset" :project-id="project.id"/>
            </li>
          </template>
        </infonav>
        <infonav v-if="appUserCount.dataExists" :link="projectPath('form-access')">
          <template #title><span class="icon-user"></span>{{ $tc('infoNav.appUsers', appUserCount.data) }}</template>
        </infonav>
      </template>
      <template #tabs>
        <!-- Four groups rather than ten tabs. Every view still has its own
        route and its own URL; what changed is that the page stops asking
        somebody to choose between ten of them before they have read a row. -->
        <li v-for="group in formTabGroups" :key="group.key"
          :class="groupClass(group)" role="presentation">
          <router-link :to="tabPath(group.primary)"
            v-tooltip.aria-describedby="group.disabled ? formTabDescription : null">
            {{ group.label }}
            <span v-if="group.badge != null" class="badge">{{ group.badge }}</span>
          </router-link>
        </li>
      </template>
    </page-head>
    <nav v-if="subtabs.length > 1" id="form-subtabs" :aria-label="$t('subnav.label')">
      <router-link v-for="view in subtabs" :key="view.path" :to="tabPath(view.path)"
        :class="{ active: $route.path === tabPath(view.path), disabled: view.disabled }"
        v-tooltip.aria-describedby="view.disabled ? formTabDescription : null">
        {{ view.label }}
        <span v-if="view.path === 'draft'" class="icon-pencil" aria-hidden="true"></span>
      </router-link>
    </nav>
  </div>
</template>

<script>
import Breadcrumbs from '../breadcrumbs.vue';
import Infonav from '../infonav.vue';
import DatasetLink from '../dataset/link.vue';
import PageHead from '../page/head.vue';

import useRoutes from '../../composables/routes';
import useTabs from '../../composables/tabs';
import { useRequestData } from '../../request-data';

// Ten views, grouped by how often anybody opens them. Order within a group is
// the order of the secondary row; the first one that works is where the tab
// itself goes.
const TAB_GROUPS = [
  {
    key: 'data', labelKey: 'group.data', local: true,
    // Verification reads the evidence behind Submissions and takes
    // submission.list, so it belongs with the data rather than under
    // Settings, where a Project viewer would have been shown a tab full of
    // settings they cannot change.
    members: ['submissions', 'summary', 'charts', 'photos', 'verification']
  },
  {
    key: 'share', labelKey: 'group.share', local: true,
    members: ['public-links', 'filtered-datasets']
  },
  {
    key: 'versions', labelKey: 'formHead.tab.versions', local: false,
    members: ['versions', 'draft']
  },
  {
    key: 'settings', labelKey: 'common.tab.settings', local: false,
    members: ['settings']
  }
];

const MEMBER_LABELS = {
  submissions: 'resource.submissions',
  summary: 'formHead.tab.summary',
  charts: 'formHead.tab.charts',
  photos: 'formHead.tab.photos',
  'public-links': 'formHead.tab.publicAccess',
  'filtered-datasets': 'formHead.tab.filteredData',
  versions: 'formHead.tab.versions',
  draft: 'formHead.tab.editForm',
  settings: 'common.tab.settings',
  verification: 'formHead.tab.verification'
};

export default {
  name: 'FormHead',
  components: { Breadcrumbs, DatasetLink, Infonav, PageHead },
  setup() {
    // The component does not assume that this data will exist when the
    // component is created.
    const { project, form, formDatasetDiff, publishedAttachments, appUserCount } = useRequestData();

    const { projectPath, formPath, canRoute } = useRoutes();
    const { tabPath, tabClass } = useTabs(formPath());
    return {
      project, form,
      formDatasetDiff, publishedAttachments, appUserCount,
      projectPath, formPath, canRoute, tabPath, tabClass
    };
  },
  computed: {
    rendersFormTabs() {
      return this.project.dataExists && this.project.permits(['form.update']);
    },
    formTabGroups() {
      const groups = [];
      for (const group of TAB_GROUPS) {
        const members = group.members
          .filter(path => this.tabVisible(path))
          .map(path => ({
            path,
            label: this.$t(MEMBER_LABELS[path]),
            disabled: this.tabDisabled(path)
          }));
        if (members.length === 0) continue; // eslint-disable-line no-continue
        // A Form without a published version can only be edited, and every
        // other view is disabled. The tab leads with the view that still
        // works, so the draft editor does not end up behind a dead link.
        const usable = members.find(member => !member.disabled) ?? members[0];
        groups.push({
          key: group.key,
          label: this.$t(group.labelKey),
          members,
          primary: usable.path,
          disabled: usable.disabled,
          badge: this.groupBadge(group.key)
        });
      }
      return groups;
    },
    activeGroup() {
      return this.formTabGroups.find(group => group.members
        .some(member => this.$route.path === this.tabPath(member.path)));
    },
    subtabs() {
      return this.activeGroup == null ? [] : this.activeGroup.members;
    },
    formTabDescription() {
      return this.form.dataExists && this.form.publishedAt == null
        ? this.$t('formNav.tabTitle')
        : null;
    },
    breadcrumbLinks() {
      return [
        { text: this.project.dataExists ? this.project.nameWithArchived : this.$t('resource.project'), path: this.projectPath(), icon: 'icon-archive' },
        { text: this.form.dataExists ? this.form.nameOrId : this.$t('resource.form'), path: this.form.publishedAt != null ? this.formPath() : '', icon: 'icon-file' }
      ];
    },
    uniqueDatasetCount() {
      const uniqueDatasets = new Set([
        ...this.formDatasetDiff.map(dataset => dataset.name),
        ...this.publishedAttachments.linkedDatasets
      ]);
      return uniqueDatasets.size;
    }
  },
  methods: {
    // Submissions and Versions render for anybody who can reach the Form.
    // Public Access and Settings use the Project right rather than canRoute(),
    // because they render for a Form without a published version, where
    // canRoute() is false.
    tabVisible(path) {
      if (path === 'submissions' || path === 'versions') return true;
      if (path === 'public-links' || path === 'settings') return this.rendersFormTabs;
      return this.canRoute(this.tabPath(path));
    },
    tabDisabled(path) {
      return path !== 'draft' && this.form.dataExists &&
        this.form.publishedAt == null;
    },
    groupBadge(key) {
      if (!this.form.dataExists) return null;
      if (key === 'data') return this.$n(this.form.submissions, 'default');
      if (key === 'share') return this.$n(this.form.publicLinks, 'default');
      if (key === 'settings') return this.$t(`formState.${this.form.state}`);
      return null;
    },
    groupClass(group) {
      const htmlClass = this.tabClass(...group.members.map(member => member.path));
      if (group.disabled) htmlClass.disabled = true;
      return htmlClass;
    }
  }
};
</script>

<style lang="scss">
// The views inside the open group. Quieter than the tabs above it: this is a
// choice of lens on one thing, not a choice of what to look at.
#form-subtabs {
  background: #fff;
  border-bottom: 1px solid #e0e0ea;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 15px;

  a {
    align-items: center;
    border-radius: 6px;
    color: #4d4d5c;
    column-gap: 5px;
    display: flex;
    font-size: 13px;
    padding: 5px 11px;
    text-decoration: none;

    &:hover, &:focus { background: #f1f1f6; color: #303047; }
    &.active { background: #eeebff; color: #4b3ccb; font-weight: 600; }
    &.disabled {
      color: #9a9aad;
      cursor: not-allowed;
      pointer-events: none;
    }
  }

  .icon-pencil { font-size: 14px; }
}
</style>

<i18n lang="json5">
{
  "en": {
    "projectNav": {
      "action": {
        "back": "Back to Project Overview"
      }
    },
    "subnav": {
      // Names the row of views inside the open Form tab, for screen readers.
      "label": "Views"
    },
    "group": {
      // Tab grouping the Form's Submissions, summary, charts and photos.
      "data": "Data",
      // Tab grouping the ways this Form's data is shared outside the Project:
      // public links and filtered datasets.
      "share": "Share"
    },
    "formNav": {
      // Tooltip text that will be shown when hovering over tabs for Submissions, Public Access, etc.
      "tabTitle": "Publish this Draft Form to enable these functions"
    },
    "infoNav": {
      "entityLists": "{count} Linked Entity List | {count} Linked Entity Lists",
      // This text is shown as a header in a dropdown about related entity lists updated by this form.
      "updatedDatasets": "Updates",
      // This text is shown as a header in a dropdown about related entity lists that are used as attachments by this form.
      "attachedDatasets": "Uses",
      "appUsers": "{count} App User assigned | {count} App Users assigned"
    }
  }
}
</i18n>

<!-- Autogenerated by destructure.js -->
<i18n>
{
  "cs": {
    "projectNav": {
      "action": {
        "back": "Zpět na přehled projektu"
      }
    }
  },
  "de": {
    "projectNav": {
      "action": {
        "back": "Zurück zur Projektübersicht"
      }
    },
    "formNav": {
      "tabTitle": "Veröffentlichen Sie diesen Formularentwurf, um diese Funktionen zu aktivieren"
    },
    "infoNav": {
      "entityLists": "{count} Verknüpfter Objektliste | {count} Verknüpfter Objektlisten",
      "updatedDatasets": "Aktualisierungen",
      "attachedDatasets": "Verwendet",
      "appUsers": "{count} App-Benutzer zugewiesen | {count} App-Benutzer zugewiesen"
    }
  },
  "es": {
    "projectNav": {
      "action": {
        "back": "Volver a la descripción general del proyecto."
      }
    },
    "formNav": {
      "tabTitle": "Publique este borrador de formulario para habilitar estas funciones"
    },
    "infoNav": {
      "entityLists": "{count} Lista de entidades conectada | {count} Listas de entidades conectadas | {count} Listas de entidades conectadas",
      "updatedDatasets": "Actualizaciones",
      "attachedDatasets": "Usos",
      "appUsers": "{count} Usuario de la aplicación asignados | {count} Usuarios de la aplicación asignados | {count} Usuarios de la aplicación asignados"
    }
  },
  "fr": {
    "projectNav": {
      "action": {
        "back": "Retourner à l'aperçu du projet"
      }
    },
    "formNav": {
      "tabTitle": "Publier cette Ébauche de Formulaire pour activer ces fonctions"
    },
    "infoNav": {
      "entityLists": "{count} liste d'entités liée | {count} listes d'entités liées | {count} de listes d'entités liées",
      "updatedDatasets": "Mises à jour",
      "attachedDatasets": "Utilise",
      "appUsers": "{count} Utilisateur mobile assigné | {count} Utilisateurs mobile assignés | {count} Utilisateur(s) mobile assigné(s)"
    }
  },
  "id": {
    "projectNav": {
      "action": {
        "back": "Kembali ke Gambaran Proyek"
      }
    }
  },
  "it": {
    "projectNav": {
      "action": {
        "back": "Torna alla panoramica del progetto"
      }
    },
    "formNav": {
      "tabTitle": "Pubblicare questa bozza di formulario per abilitare queste funzioni"
    },
    "infoNav": {
      "entityLists": "{count} Elenco di entità collegata | {count} Elenchi di entità collegate | {count} Elenchi di entità collegate",
      "updatedDatasets": "Aggiornamenti",
      "attachedDatasets": "Utilizzi",
      "appUsers": "{count} Utente App assegnato | {count} Utenti App assegnati | {count} Utenti App assegnati"
    }
  },
  "ja": {
    "projectNav": {
      "action": {
        "back": "プロジェクトの概要に戻る"
      }
    }
  },
  "pt": {
    "projectNav": {
      "action": {
        "back": "Voltar à visão geral do projeto"
      }
    },
    "formNav": {
      "tabTitle": "Publique esse Rascunho do formulário para habilitar essas funções"
    },
    "infoNav": {
      "updatedDatasets": "Atualizações",
      "attachedDatasets": "Utiliza"
    }
  },
  "sw": {
    "projectNav": {
      "action": {
        "back": "Rudi kwa Muhtasari wa Mradi"
      }
    }
  },
  "zh": {
    "projectNav": {
      "action": {
        "back": "返回项目概览"
      }
    },
    "formNav": {
      "tabTitle": "发布此草稿表单以启用这些功能"
    },
    "infoNav": {
      "updatedDatasets": "更新",
      "attachedDatasets": "用途",
      "appUsers": "已分配{count}个应用用户"
    }
  },
  "zh-Hant": {
    "projectNav": {
      "action": {
        "back": "返回專案概覽"
      }
    },
    "formNav": {
      "tabTitle": "發布此表格草稿以啟用這些功能"
    },
    "infoNav": {
      "updatedDatasets": "更新",
      "attachedDatasets": "用途",
      "appUsers": "已指派{count}位 App 使用者"
    }
  }
}
</i18n>
