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
    <router-link class="rail-link" :class="{ active: $route.path === '/' }" to="/">
      <span class="icon-bar-chart" aria-hidden="true"></span>
      <span>{{ $t('nav.dashboard') }}</span>
      <span v-if="$route.path === '/'" class="sr-only">{{ $t('current') }}</span>
    </router-link>
    <router-link class="rail-link" :class="{ active: startsWith('/projects') }"
      to="/projects">
      <span class="icon-folder-open" aria-hidden="true"></span>
      <span>{{ $t('resource.projects') }}</span>
      <span v-if="startsWith('/projects')" class="sr-only">{{ $t('current') }}</span>
    </router-link>
    <router-link class="rail-link" :class="{ active: startsWith('/forms') }" to="/forms">
      <span class="icon-file-text" aria-hidden="true"></span>
      <span>{{ $t('resource.forms') }}</span>
      <span v-if="startsWith('/forms')" class="sr-only">{{ $t('current') }}</span>
    </router-link>
    <router-link class="rail-link" :class="{ active: startsWith('/submissions') }"
      to="/submissions">
      <span class="icon-database" aria-hidden="true"></span>
      <span>{{ $t('resource.submissions') }}</span>
      <span v-if="startsWith('/submissions')" class="sr-only">{{ $t('current') }}</span>
    </router-link>
    <router-link v-if="canRoute('/field-data/media')" class="rail-link"
      :class="{ active: startsWith('/field-data/media') }" to="/field-data/media">
      <span class="icon-image" aria-hidden="true"></span>
      <span>{{ $t('nav.media') }}</span>
      <span v-if="startsWith('/field-data/media')" class="sr-only">{{ $t('current') }}</span>
    </router-link>
    <router-link v-if="canRoute('/field-data/integrations')" class="rail-link"
      :class="{ active: startsWith('/field-data/integrations') }"
      to="/field-data/integrations">
      <span class="icon-exchange" aria-hidden="true"></span>
      <span>{{ $t('nav.integrations') }}</span>
      <span v-if="startsWith('/field-data/integrations')" class="sr-only">{{ $t('current') }}</span>
    </router-link>
    <router-link v-if="canRoute('/users')" class="rail-link"
      :class="{ active: startsWith('/users') }" to="/users">
      <span class="icon-user-circle" aria-hidden="true"></span>
      <span>{{ $t('resource.users') }}</span>
      <span v-if="startsWith('/users')" class="sr-only">{{ $t('current') }}</span>
    </router-link>
    <router-link v-if="canRoute('/system/audits')" class="rail-link rail-admin"
      :class="{ active: adminIsActive }" to="/system/audits">
      <span class="icon-cog" aria-hidden="true"></span>
      <span>{{ $t('nav.administration') }}</span>
      <span v-if="adminIsActive" class="sr-only">{{ $t('current') }}</span>
    </router-link>
  </nav>
</template>

<script>
import useRoutes from '../composables/routes';

export default {
  name: 'AppRail',
  setup() {
    const { canRoute } = useRoutes();
    return { canRoute };
  },
  computed: {
    adminIsActive() {
      return this.startsWith('/system') ||
        this.startsWith('/field-data/organizations') ||
        this.startsWith('/field-data/backups');
    }
  },
  methods: {
    startsWith(path) {
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
  .rail-admin { border-top: 1px solid #e9e9f1; margin-top: auto; padding-top: 4px; }
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
      "administration": "Administration"
    }
  }
}
</i18n>
