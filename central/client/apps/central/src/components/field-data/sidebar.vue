<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

This file is part of Field Data, a distribution of ODK Central. It is subject to
the license terms in the LICENSE file found in the top-level directory of this
distribution and at https://www.apache.org/licenses/LICENSE-2.0.

The Field Data left navigation rail. Links point at real Field Data routes; groups
whose features don't exist yet in Field Data are intentionally omitted rather than
shown as dead links.
-->
<template>
  <aside id="fd-sidebar">
    <div class="fd-brand">
      <img src="../../assets/images/field-data-logo.png" alt="Field Data">
      <span class="fd-brand-sub">{{ $t('platform') }}</span>
    </div>

    <nav class="fd-nav">
      <template v-for="group of groups" :key="group.key">
        <p v-if="group.items.some(i => i.show)" class="fd-nav-heading">{{ group.label }}</p>
        <router-link v-for="item of group.items.filter(i => i.show)" :key="item.to"
          :to="item.to" class="fd-nav-item"
          :class="{ active: isActive(item) }">
          <!-- Icons come from the static iconPaths map below. -->
          <!-- eslint-disable vue/no-v-html -->
          <svg class="fd-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
            v-html="iconPaths[item.icon]"/>
          <!-- eslint-enable vue/no-v-html -->
          <span class="fd-nav-label">{{ item.label }}</span>
        </router-link>
      </template>
    </nav>

    <div class="fd-status">
      <span class="fd-status-dot" style="background: #64748b"></span>
      <div class="fd-status-text">
        <span class="fd-status-title">Service status available in Operations</span>
        <span class="fd-status-ver">Field Data {{ version }}</span>
      </div>
    </div>
  </aside>
</template>

<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

import { useRequestData } from '../../request-data';

defineOptions({ name: 'FieldDataSidebar' });

const { t } = useI18n();
const route = useRoute();
const { currentUser, centralVersion } = useRequestData();

const can = (verb) => currentUser.dataExists && currentUser.can(verb);
const version = computed(() => (centralVersion.dataExists
  ? (centralVersion.versionText || '').split('\n')[0].replace(/^v/, '') : ''));

const iconPaths = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  projects: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  media: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  explore: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  templates: '<path d="M4 4h7v7H4z"/><path d="M13 4h7v7h-7z"/><path d="M4 13h7v7H4z"/><path d="M13 13h7v7h-7z"/>',
  review: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  cleaning: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/><path d="M5 21h14"/>',
  team: '<circle cx="12" cy="8" r="6"/><polyline points="8.5 13 7 22 12 19 17 22 15.5 13"/>',
  cases: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  report: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 17l3-4 2 2 3-5"/>',
  assignments: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M9 15l2 2 4-4"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  dhis2: '<path d="M4 4h6v6H4z"/><path d="M14 4h6v6h-6z"/><path d="M4 14h6v6H4z"/><path d="M14 14h6v6h-6z"/><path d="M10 7h4"/><path d="M7 10v4"/><path d="M17 10v4"/><path d="M10 17h4"/>',
  webhooks: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  audits: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  backups: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'
};

const groups = computed(() => [
  {
    key: 'main', label: t('group.overview'), items: [
      { to: '/field-data', icon: 'dashboard', label: t('nav.dashboard'), show: true, exact: true },
      { to: '/field-data/review', icon: 'review', label: t('nav.review'), show: true },
      { to: '/field-data/report', icon: 'report', label: t('nav.report'), show: true }
    ]
  },
  {
    key: 'collection', label: t('group.collection'), items: [
      { to: '/', icon: 'projects', label: t('nav.projects'), show: true, exact: true },
      { to: '/field-data/templates', icon: 'templates', label: t('nav.templates'), show: can('project.create') },
      { to: '/field-data/catalog', icon: 'report', label: 'Public catalogue', show: can('project.create') },
      { to: '/field-data/analysis', icon: 'explore', label: 'Analysis', show: true },
      { to: '/field-data/explore', icon: 'explore', label: t('nav.explore'), show: true },
      { to: '/field-data/media', icon: 'media', label: t('nav.media'), show: can('project.create') }
    ]
  },
  {
    key: 'casework', label: t('group.casework'), items: [
      { to: '/field-data/cleaning', icon: 'cleaning', label: t('nav.cleaning'), show: can('project.create') },
      { to: '/field-data/cases', icon: 'cases', label: t('nav.cases'), show: can('project.create') },
      { to: '/field-data/assignments', icon: 'assignments', label: t('nav.assignments'), show: can('project.create') }
    ]
  },
  {
    key: 'access', label: t('group.access'), items: [
      { to: '/users', icon: 'users', label: t('nav.users'), show: can('user.list') },
      { to: '/field-data/team', icon: 'team', label: t('nav.team'), show: true }
    ]
  },
  {
    key: 'system', label: t('group.system'), items: [
      { to: '/field-data/dhis2', icon: 'dhis2', label: t('nav.dhis2'), show: can('project.create') },
      { to: '/field-data/webhooks', icon: 'webhooks', label: t('nav.webhooks'), show: can('config.set') },
      { to: '/system/audits', icon: 'audits', label: t('nav.audits'), show: can('audit.read') },
      { to: '/field-data/operations', icon: 'settings', label: 'Operations', show: can('backup.run') },
      { to: '/field-data/backups', icon: 'backups', label: t('nav.backups'), show: can('backup.run') },
      { to: '/account/edit', icon: 'settings', label: t('nav.settings'), show: true }
    ]
  }
]);

const isActive = (item) => (item.exact
  ? route.path === item.to
  : route.path === item.to || route.path.startsWith(`${item.to}/`));
</script>

<i18n lang="json5">
{
  "en": {
    "platform": "Field Data Platform",
    "operational": "All Systems Operational",
    "group": {
      "overview": "Overview",
      "collection": "Data Collection",
      "casework": "Case Management",
      "access": "Users & Access",
      "integrations": "Integrations",
      "system": "System"
    },
    "nav": {
      "dashboard": "Dashboard",
      "review": "Review Queue",
      "cleaning": "Data Cleaning",
      "report": "Reports",
      "projects": "Projects",
      "templates": "Project Templates",
      "explore": "Data Explorer",
      "cases": "Cases",
      "assignments": "Assignments",
      "team": "Field Teams",
      "media": "Media Library",
      "users": "Users",
      "dhis2": "DHIS2 Mapping",
      "webhooks": "Webhooks",
      "audits": "Audit Logs",
      "backups": "Backups",
      "settings": "Settings"
    }
  }
}
</i18n>

<style lang="scss">
#fd-sidebar {
  --sb-bg: #ffffff;
  --sb-border: #e4ebed;
  --sb-teal: #0E7490;
  --sb-muted: #6a7c82;
  width: 248px;
  flex: 0 0 248px;
  background: var(--sb-bg);
  border-right: 1px solid var(--sb-border);
  height: 100vh;
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;

  .fd-brand {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 18px 20px 16px;
    border-bottom: 1px solid var(--sb-border);
    img { height: 40px; width: auto; align-self: flex-start; }
    .fd-brand-sub { font-size: 11px; color: var(--sb-muted); letter-spacing: 0.02em; }
  }

  .fd-nav { flex: 1 1 auto; padding: 12px 12px 20px; }
  .fd-nav-heading {
    font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--sb-muted); font-weight: 700; margin: 16px 10px 6px;
  }
  .fd-nav-item {
    display: flex; align-items: center; gap: 11px;
    padding: 9px 12px; border-radius: 9px; margin-bottom: 2px;
    color: #2a3b41; font-size: 14px; font-weight: 500; text-decoration: none;
    &:hover { background: #f1f6f7; color: var(--sb-teal); }
    &.active { background: #e6f1f4; color: var(--sb-teal); font-weight: 600; }
    .fd-nav-icon { width: 18px; height: 18px; flex-shrink: 0; opacity: 0.85; }
    &.active .fd-nav-icon { opacity: 1; }
  }

  .fd-status {
    display: flex; align-items: center; gap: 10px;
    margin: 10px 14px 16px; padding: 12px 14px;
    background: #eef6f1; border: 1px solid #d6e9dd; border-radius: 10px;
    .fd-status-dot { width: 9px; height: 9px; border-radius: 50%; background: #2E8B5A; box-shadow: 0 0 0 3px rgba(46,139,90,0.18); flex-shrink: 0; }
    .fd-status-text { display: flex; flex-direction: column; line-height: 1.3; }
    .fd-status-title { font-size: 12.5px; font-weight: 600; color: #1f6e45; }
    .fd-status-ver { font-size: 11px; color: var(--sb-muted); }
  }
}

@media (max-width: 900px) {
  #fd-sidebar { display: none; }
}
</style>
