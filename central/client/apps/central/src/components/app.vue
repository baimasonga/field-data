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
    <!-- If the user's session is restored during the initial navigation, that
    will affect how the navbar is rendered. -->
    <navbar v-show="routerReady && !$route.meta.standalone"/>
    <alerts/>
    <feedback-button v-if="showsFeedbackButton"/>
    <div class="app-body">
      <app-rail v-if="showsRail"/>
      <div ref="containerEl" class="container-fluid">
        <router-view/>
      </div>
    </div>

    <div id="modals"></div>
    <div id="tooltips"></div>
    <hover-cards/>
  </div>
</template>

<script>
import { defineAsyncComponent, inject, useTemplateRef } from 'vue';

import { START_LOCATION } from 'vue-router';

import Alerts from './alerts.vue';
import AppRail from './app-rail.vue';
import Navbar from './navbar.vue';

import useCallWait from '../composables/call-wait';
import useDisabled from '../composables/disabled';
import { loadAsync } from '../util/load-async';
import { useAlert } from '../alert';
import { useRequestData } from '../request-data';
import { useSessions } from '../util/session';

export default {
  name: 'App',
  components: {
    Alerts,
    AppRail,
    HoverCards: defineAsyncComponent(loadAsync('HoverCards')),
    Navbar,
    FeedbackButton: defineAsyncComponent(loadAsync('FeedbackButton'))
  },
  inject: ['alert', 'config', 'location'],
  setup() {
    const { toast } = inject('container');

    const { visiblyLoggedIn } = useSessions();
    useDisabled();

    const containerEl = useTemplateRef('containerEl');
    useAlert(toast, containerEl);

    const { centralVersion } = useRequestData();
    const { callWait } = useCallWait();
    return { visiblyLoggedIn, centralVersion, callWait };
  },
  computed: {
    routerReady() {
      return this.$route !== START_LOCATION;
    },
    showsFeedbackButton() {
      return this.config.loaded && this.config.showsFeedbackButton &&
        this.visiblyLoggedIn;
    },
    // The rail names destinations inside the application, so it appears once
    // the user is in it: not on the login screen, and not on a standalone
    // route like a public link, which has no application around it.
    showsRail() {
      return this.routerReady && this.visiblyLoggedIn &&
        this.$route.meta.standalone !== true;
    },
  },
  created() {
    this.callWait('checkVersion', this.checkVersion, (tries) =>
      (tries === 0 ? 15000 : 60000));
  },
  methods: {
    checkVersion() {
      const previousVersion = this.centralVersion.versionText;
      return this.centralVersion.request({
        url: '/version.txt',
        clear: false,
        alert: false
      })
        .then(() => {
          if (previousVersion == null || this.centralVersion.versionText === previousVersion)
            return false;

          // Alert the user about the version change, then keep alerting them.
          // One benefit of this approach is that the user should see the toast
          // even if there is another toast (say, about session expiration).
          this.callWait(
            'versionChange',
            () => {
              this.alert.info(this.$t('alert.versionChange'))
                .cta(this.$t('action.refreshPage'), () => { this.location.reload(); });
            },
            (count) => (count === 0 ? 0 : 60000)
          );
          return true;
        })
        // This error could be the result of logout, which will cancel all
        // requests.
        .catch(error =>
          (error.response != null && error.response.status === 404));
    }
  }
};
</script>

<style lang="scss">
// The rail and the page beside it. Rail first in the source so it comes first
// for a screen reader and for the keyboard, and first on the screen when the
// two stack at narrow widths.
.app-body {
  align-items: stretch;
  display: flex;
  min-height: calc(100vh - var(--space-16));

  > .container-fluid { flex: 1 1 auto; min-width: 0; }
}

// With the rail carrying the destinations, the top bar is left holding the
// name, help, locale and account: a quiet strip rather than a second
// navigation competing with the first.
body:has(#app-rail) .navbar-default {
  background: #fff;
  border-bottom: 1px solid #e0e0ea;
  box-shadow: none;

  .navbar-brand {
    &, &:hover, &:focus { color: #20202b; }
  }
  .navbar-mark { color: #5d4ee0; }
  .navbar-nav > li > a {
    &, &:hover, &:focus { color: #303047; }
    &:hover { background: #f1f1f6; }
  }
  .navbar-nav .open > a {
    &, &:hover, &:focus { background: #eeebff; color: #4b3ccb; }
  }
  .navbar-toggle .navbar-icon-bar { background: #303047; }
}

@media (max-width: 991px) {
  .app-body { display: block; }
}
</style>
