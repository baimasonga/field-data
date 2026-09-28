<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

The application's primary navigation. It began inside the programme dashboard,
which meant it appeared on one screen and every other page fell back to a row
of links in the top bar -- two different navigations for one product. It lives
here so that every page has the same one.

Reports is deliberately absent: reports belong to a Project and are reached
from it. A rail entry would have to pick a Project on the user's behalf.
-->
<template>
  <nav id="app-rail" :aria-label="$t('label')">
    <router-link v-for="item in sections" :key="item.path" class="rail-link"
      :class="{ active: isActive(item) }" :to="item.path">
      <span :class="item.icon" aria-hidden="true"></span>
      <span>{{ item.label }}</span>
      <span v-if="isActive(item)" class="sr-only">{{ $t('current') }}</span>
    </router-link>
    <template v-if="admin != null">
      <router-link class="rail-link rail-admin" :class="{ active: adminIsActive }"
        :to="admin.path">
        <span class="icon-cog" aria-hidden="true"></span>
        <span>{{ $t('nav.administration') }}</span>
        <span v-if="adminIsActive" class="sr-only">{{ $t('current') }}</span>
      </router-link>
      <router-link v-for="child in adminIsActive ? adminChildren : []"
        :key="child.path" class="rail-child" :class="{ active: isActive(child) }"
        :to="child.path">
        {{ child.label }}
        <span v-if="isActive(child)" class="sr-only">{{ $t('current') }}</span>
      </router-link>
    </template>
  </nav>
</template>

<script>
import useRoutes from '../composables/routes';

// The work, in the order somebody meets it. Everything below the line is set
// up once and then left alone.
const SECTIONS = [
  { path: '/', labelKey: 'nav.dashboard', icon: 'icon-bar-chart', exact: true },
  { path: '/projects', labelKey: 'resource.projects', icon: 'icon-folder-open' },
  { path: '/forms', labelKey: 'resource.forms', icon: 'icon-file-text' },
  { path: '/submissions', labelKey: 'resource.submissions', icon: 'icon-database' },
  { path: '/maps', labelKey: 'fieldDataHome.tab.maps', icon: 'icon-map-marker' },
  { path: '/field-data/media', labelKey: 'nav.media', icon: 'icon-image', gated: true }
];

// Administration is a section, not a destination: Users and Integrations are
// administering the deployment rather than doing fieldwork with it, and they
// were competing with Projects for attention at the top level.
const ADMIN_CHILDREN = [
  { path: '/users', labelKey: 'resource.users' },
  { path: '/field-data/integrations', labelKey: 'nav.integrations' },
  { path: '/field-data/organizations', labelKey: 'nav.organizations' },
  { path: '/field-data/backups', labelKey: 'nav.backups' },
  // Audit log, customization and analytics are all one destination as far as
  // the rail is concerned; the page itself tabs between them.
  { path: '/system/audits', labelKey: 'nav.system', prefix: '/system' }
];

export default {
  name: 'AppRail',
  setup() {
    const { canRoute } = useRoutes();
    return { canRoute };
  },
  computed: {
    sections() {
      return SECTIONS
        .filter(item => !item.gated || this.canRoute(item.path))
        .map(item => ({ ...item, label: this.$t(item.labelKey) }));
    },
    adminChildren() {
      return ADMIN_CHILDREN
        .filter(child => this.canRoute(child.path))
        .map(child => ({ ...child, label: this.$t(child.labelKey) }));
    },
    // The section leads to its first reachable child, and disappears for
    // somebody who can reach none of them.
    admin() {
      return this.adminChildren.length === 0 ? null : this.adminChildren[0];
    },
    adminIsActive() {
      return this.adminChildren.some(child => this.isActive(child));
    }
  },
  methods: {
    isActive(item) {
      if (item.exact === true) return this.$route.path === item.path;
      const path = item.prefix ?? item.path;
      return this.$route.path === path || this.$route.path.startsWith(`${path}/`);
    }
  }
};
</script>

<style lang="scss">
#app-rail {
  align-self: flex-start;
  background: #fff;
  border-right: 1px solid #e0e0ea;
  display: flex;
  flex: 0 0 196px;
  flex-direction: column;
  gap: 4px;
  // Sticky, so navigation stays reachable down a long page. Stretched to the
  // content instead, Administration -- which sits at the bottom -- ends up
  // thousands of pixels below the fold on the dashboard.
  height: calc(100vh - var(--space-16));
  overflow-y: auto;
  padding: 20px 12px 18px;
  position: sticky;
  top: var(--space-16);

  .rail-link {
    align-items: center;
    border-radius: 8px;
    color: #303047;
    display: flex;
    font-size: 14px;
    font-weight: 500;
    gap: 14px;
    min-height: 44px;
    padding: 0 16px;
    text-decoration: none;
    transition: background-color 120ms ease, color 120ms ease;

    > span:first-child { font-size: 18px; width: 20px; }
    &:hover, &:focus { background: #f4f2ff; color: #4b3ccb; }
    &:focus-visible { box-shadow: var(--ring-focus); outline: none; }
    &.active { background: #eeebff; color: #513ee8; font-weight: 650; }
  }
  // Administration is set up once and then left alone, so it sits away from
  // the work rather than in the middle of it.
  .rail-admin { border-top: 1px solid #e9e9f1; margin-top: auto; padding-top: 12px; }

  // Its destinations, shown while the section is open. Indented to the width
  // of the icons above so the labels line up with them.
  .rail-child {
    border-radius: 6px;
    color: #4d4d5c;
    display: block;
    font-size: 13px;
    padding: 6px 16px 6px 50px;
    text-decoration: none;

    &:hover, &:focus { background: #f4f2ff; color: #4b3ccb; }
    &:focus-visible { box-shadow: var(--ring-focus); outline: none; }
    &.active { background: #eeebff; color: #513ee8; font-weight: 600; }
  }
  .sr-only { display: none; }
  .active .sr-only { display: block; }
}

// Below this the rail cannot hold a column without eating the screen, so it
// becomes a scrolling row above the content.
@media (max-width: 991px) {
  #app-rail {
    border-bottom: 1px solid #e0e0ea;
    border-right: 0;
    flex-direction: row;
    height: auto;
    overflow-x: auto;
    overflow-y: visible;
    padding: 8px 12px;
    position: static;

    .rail-link { flex: 0 0 auto; min-height: 40px; padding-inline: 12px; }
    .rail-admin { border: 0; margin: 0; padding-top: 0; }
    .rail-child { flex: 0 0 auto; padding: 6px 12px; }
  }
}
@media (prefers-reduced-motion: reduce) {
  #app-rail .rail-link { transition: none; }
}
</style>

<i18n lang="json5">
{
  "en": {
    "label": "Main navigation",
    // Used by screen readers to identify the currently-selected destination
    "current": "current",
    "nav": {
      "dashboard": "Dashboard",
      "media": "Media",
      "integrations": "Integrations",
      "organizations": "Organizations",
      "backups": "Backups",
      // The server itself: audit log and customization.
      "system": "System",
      "administration": "Administration"
    }
  }
}
</i18n>
