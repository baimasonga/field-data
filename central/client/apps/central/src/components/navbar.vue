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
    <nav class="navbar navbar-default">
      <div class="container-fluid">
        <div class="navbar-header">
          <button type="button" class="navbar-toggle collapsed"
            data-toggle="collapse" data-target=".navbar-collapse"
            aria-expanded="false">
            <span class="sr-only">{{ $t('action.toggle') }}</span>
            <span class="navbar-icon-bar"></span>
            <span class="navbar-icon-bar"></span>
            <span class="navbar-icon-bar"></span>
          </button>
          <router-link to="/" class="navbar-brand">
            <svg class="navbar-mark" viewBox="0 0 64 64" aria-hidden="true">
              <path fill="currentColor" fill-rule="evenodd" d="M32 3C18.75 3 8 13.75 8 27c0 15.5 24 34 24 34s24-18.5 24-34C56 13.75 45.25 3 32 3zM24 28a2.5 2.5 0 0 1 5 0v10a2.5 2.5 0 0 1-5 0V28zm8-6a2.5 2.5 0 0 1 5 0v16a2.5 2.5 0 0 1-5 0V22zm8-6a2.5 2.5 0 0 1 5 0v22a2.5 2.5 0 0 1-5 0V16z"/>
            </svg>
            <span>Field Data</span>
          </router-link>
        </div>
        <div class="collapse navbar-collapse">
          <div class="navbar-right">
            <a v-show="showsAnalyticsNotice" id="navbar-analytics-notice"
              href="#" @click.prevent="analyticsIntroduction.show()">
              {{ $t('analyticsNotice') }}
            </a>
            <ul class="nav navbar-nav">
              <navbar-help-dropdown/>
              <navbar-locale-dropdown/>
              <navbar-actions/>
            </ul>
          </div>
        </div>
      </div>
    </nav>
    <analytics-introduction v-if="config.loaded && config.showsAnalytics"
      v-bind="analyticsIntroduction" @hide="analyticsIntroduction.hide()"/>
  </div>
</template>

<script>
import { defineAsyncComponent } from 'vue';

import NavbarActions from './navbar/actions.vue';
import NavbarHelpDropdown from './navbar/help-dropdown.vue';
import NavbarLocaleDropdown from './navbar/locale-dropdown.vue';

import useRoutes from '../composables/routes';
import { loadAsync } from '../util/load-async';
import { modalData } from '../util/reactivity';
import { useRequestData } from '../request-data';

export default {
  name: 'Navbar',
  components: {
    AnalyticsIntroduction: defineAsyncComponent(loadAsync('AnalyticsIntroduction')),
    NavbarActions,
    NavbarHelpDropdown,
    NavbarLocaleDropdown
  },
  inject: ['config', 'visiblyLoggedIn'],
  setup() {
    // The component does not assume that this data will exist when the
    // component is created.
    const { currentUser, analyticsConfig } = useRequestData();
    const { canRoute } = useRoutes();
    return { currentUser, analyticsConfig, canRoute };
  },
  data() {
    return {
      analyticsIntroduction: modalData('AnalyticsIntroduction')
    };
  },
  computed: {
    showsAnalyticsNotice() {
      return this.config.loaded && this.config.showsAnalytics && this.visiblyLoggedIn &&
        this.canRoute('/system/analytics') && this.analyticsConfig.dataExists &&
        this.analyticsConfig.isEmpty() &&
        Date.now() - Date.parse(this.currentUser.createdAt) >= /* 14 days */ 1209600000;
    }
  }
};
</script>

<style lang="scss">
@import '../assets/scss/mixins';

.navbar-default {
  background-color: $color-accent-primary;
  border: none;
  box-shadow: var(--shadow-sm);
  margin-bottom: 0;
  min-height: var(--space-16);

  .navbar-brand {
    align-items: center;
    display: flex;
    float: left;
    font-size: var(--text-body);
    font-weight: 700;
    gap: var(--space-3);
    height: var(--space-16);
    letter-spacing: var(--tracking-title);
    padding-inline: 0;
    // Eight destinations crowd the bar; without this the product name is the
    // thing that wraps, which looks like a rendering fault rather than a
    // narrow window.
    white-space: nowrap;

    &, &:hover, &:focus { color: var(--gray-0); }
    &:focus { background-color: transparent; text-decoration: none; }
    &:focus-visible { box-shadow: var(--ring-focus); outline: none; }
  }

  .navbar-mark {
    color: var(--gray-0);
    flex: none;
    height: 26px;
    width: 26px;
  }

  .navbar-nav {
    font-size: var(--text-body-sm);

    > li > a {
      font-weight: 500;
      &, &:hover, &:focus { color: var(--gray-0); }
    }
  }
}

#navbar-analytics-notice {
  @include text-link;
  background-color: var(--warning-bg);
  border: var(--border-thin) solid var(--warning);
  border-radius: var(--radius-sm);
  color: var(--warning-text);
  float: left;
  font-size: var(--text-caption);
  margin-right: var(--space-6);
  padding: var(--space-1) var(--space-3);

  &:hover, &:focus {
    background-color: var(--warning-bg);
    border-color: var(--warning);
  }
}

// Navbar is not collapsed.
@media (min-width: 768px) {
  .navbar-default {
    border-radius: 0;

    // Bootstrap 3 floats these into place, which is what pinned the old bar to
    // 33px and left the items sitting on its top edge. A flex row centres them
    // in a bar tall enough to take a 44px target.
    .container-fluid {
      align-items: center;
      display: flex;
      gap: var(--space-8);
      min-height: var(--space-16);
      padding-inline: var(--space-6);
    }

    // Bootstrap declares `display: block !important` on this at wide widths,
    // which is why the row would not form and the right-hand group floated
    // onto a second line, doubling the bar's height.
    .navbar-collapse {
      align-items: center;
      display: flex !important;
      flex: 1;
      padding-block: 0;
      padding-inline: 0;
    }


    .navbar-right {
      align-items: center;
      display: flex;
      float: none;
      margin-left: auto;
      margin-right: 0;
    }

    .navbar-nav {
      align-items: center;
      display: flex;
      float: none;
      margin: 0;

      > li > a {
        align-items: center;
        border-radius: var(--radius-sm);
        display: flex;
        min-height: 40px;
        padding: var(--space-2) var(--space-4);
        transition: background-color 150ms ease;

        &:hover { background-color: var(--iris-700); }
        &:focus-visible { box-shadow: var(--ring-focus); outline: none; }
      }

      > li + li { margin-left: var(--space-1); }

      .active > a, .open > a {
        &, &:hover, &:focus {
          background-color: var(--iris-800);
          color: var(--gray-0);
        }
      }
    }

    #navbar-actions { margin-left: var(--space-2); }
  }
}

// Navbar is collapsed.
@media (max-width: 767px) {
  .navbar-default {
    .navbar-header { align-items: center; display: flex; min-height: var(--space-16); }

    .navbar-brand { margin-left: var(--space-2); }

    .navbar-toggle {
      align-items: center;
      border: none;
      border-radius: var(--radius-sm);
      display: flex;
      flex-direction: column;
      gap: 5px;
      justify-content: center;
      // A 44px target, which the old 30px bar could not contain.
      height: 44px;
      margin: 0 var(--space-2) 0 0;
      padding: 0;
      width: 44px;

      &:hover, &:focus { background-color: var(--iris-700); }
      &:focus-visible { box-shadow: var(--ring-focus); outline: none; }

      .navbar-icon-bar {
        background-color: var(--gray-0);
        border-radius: var(--radius-pill);
        display: block;
        height: 2px;
        width: 22px;
      }
    }

    .navbar-collapse {
      background-color: var(--iris-800);
      border: none;
      padding-block: var(--space-2);
      position: relative;
      z-index: 99;
    }

    .navbar-nav {
      margin-block: 0;

      > li > a {
        align-items: center;
        display: flex;
        min-height: 48px;
        padding-inline: var(--space-6);
      }

      .active > a, .open > a {
        border-left: 3px solid var(--gray-0);
        padding-left: calc(var(--space-6) - 3px);

        &, &:hover, &:focus {
          background-color: var(--iris-900);
          color: var(--gray-0);
        }
      }

      .open .dropdown-menu > li > a {
        &, &:hover, &:focus { color: var(--gray-0); }
      }
    }
  }

  #navbar-analytics-notice { display: none; }
}
</style>

<i18n lang="json5">
{
  "en": {
    "action": {
      // Used by screen readers to describe the button used to show or hide the navigation bar on small screens ("hamburger menu").
      "toggle": "Toggle navigation"
    },
    "analyticsNotice": "Help improve Field Data!"
  }
}
</i18n>

<!-- Autogenerated by destructure.js -->
<i18n>
{
  "cs": {
    "action": {
      "toggle": "Přepnout navigaci"
    },
    "analyticsNotice": "Pomozte zlepšit Central!"
  },
  "de": {
    "action": {
      "toggle": "Navigation umschalten"
    },
    "analyticsNotice": "Hilf Central zu verbessern!"
  },
  "es": {
    "action": {
      "toggle": "Alternar la navegación"
    },
    "analyticsNotice": "Ayuda a mejorar Central"
  },
  "fr": {
    "action": {
      "toggle": "Basculer la navigation"
    },
    "analyticsNotice": "Aidez à améliorer Central !"
  },
  "id": {
    "action": {
      "toggle": "Navigasi Toggle"
    },
    "analyticsNotice": "Bantu Memperbaiki Central!"
  },
  "it": {
    "action": {
      "toggle": "Attiva/disattiva navigazione"
    },
    "analyticsNotice": "Aiuta a migliorare Central"
  },
  "ja": {
    "action": {
      "toggle": "ナビゲーションを有効化"
    },
    "analyticsNotice": "Centralの改善を支援！"
  },
  "pt": {
    "action": {
      "toggle": "Ocultar ou exibir a barra de navegação"
    },
    "analyticsNotice": "Ajude a melhorar o Central!"
  },
  "sw": {
    "action": {
      "toggle": "Geuza urambazaji"
    },
    "analyticsNotice": "Saidia kuboresha Central"
  },
  "zh": {
    "action": {
      "toggle": "切换导航"
    },
    "analyticsNotice": "助力完善Central！"
  },
  "zh-Hant": {
    "action": {
      "toggle": "切換導航鈕"
    },
    "analyticsNotice": "幫忙改善 Central!"
  }
}
</i18n>
