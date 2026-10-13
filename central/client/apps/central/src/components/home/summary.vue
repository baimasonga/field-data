<!--
Copyright 2022 ODK Central Developers
See the NOTICE file at the top-level directory of this distribution and at
https://github.com/getodk/central-frontend/blob/master/NOTICE.

This file is part of ODK Central. It is subject to the license terms in
the LICENSE file found in the top-level directory of this distribution and at
https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
including this file, may be copied, modified, propagated, or distributed
except according to the terms contained in the LICENSE file.

Field Data: a greeting + a compact orientation strip replaces the original four
Project/Users/Docs/Forum cards. Help links now live in a quiet footer on the
home page.
-->
<template>
  <div id="fd-home-summary">
    <div class="fd-greet">
      <h1>{{ greeting }}</h1>
      <p>{{ $t('subtitle') }}</p>
    </div>
    <div class="fd-home-stats">
      <div v-for="s of statCards" :key="s.key" class="fd-hstat">
        <div class="fd-hstat-top">
          <span class="l">{{ s.label }}</span>
</div>
        <div class="n"><template v-if="s.ready"><template v-if="s.value != null">{{ $n(s.value, 'default') }}</template><span v-else class="stat-unavailable">Unavailable</span></template><spinner v-else inline/></div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import Spinner from '../spinner.vue';

import { noop } from '../../util/util';
import { useRequestData } from '../../request-data';

defineOptions({ name: 'HomeSummary' });

const { t } = useI18n();
const { currentUser, projects, createResource } = useRequestData();
const users = createResource('users');
if (currentUser.can('user.list')) users.request({ url: '/v1/users' }).catch(noop);

const sumArray = (arr) => arr.reduce((a, b) => a + b, 0);
const ready = computed(() => projects.dataExists);
const projectCount = computed(() => (projects.dataExists ? projects.filter(p => !p.archived).length : 0));
const formCount = computed(() => (projects.dataExists
  ? sumArray(projects.map(p => (p.formList ? p.formList.filter(f => f.publishedAt != null).length : 0)))
  : 0));
const submissionCount = computed(() => (projects.dataExists
  ? sumArray(projects.map(p => (p.formList ? sumArray(p.formList.map(f => f.submissions || 0)) : 0)))
  : 0));

const greeting = computed(() => {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'morning' : (hour < 18 ? 'afternoon' : 'evening');
  const dn = currentUser.dataExists ? (currentUser.displayName || '') : '';
  const name = (dn && !dn.includes('@')) ? dn : null;
  return name ? t(`greet.${part}Name`, { name }) : t(`greet.${part}`);
});

const statCards = computed(() => {
  const cards = [
    { key: 'projects', label: t('stat.projects'), value: projectCount.value, ready: ready.value, icon: 'folder', tone: 'blue' },
    { key: 'forms', label: t('stat.forms'), value: formCount.value, ready: ready.value, icon: 'file', tone: 'teal' },
    { key: 'subs', label: t('stat.submissions'), value: submissionCount.value, ready: ready.value, icon: 'inbox', tone: 'green' }
  ];
  if (currentUser.can('user.list'))
    cards.push({ key: 'users', label: t('stat.users'), value: users.dataExists ? users.length : null, ready: !users.initiallyLoading, icon: 'users', tone: 'violet' });
  return cards;
});
</script>

<style lang="scss">
@import '../../assets/scss/variables';

#fd-home-summary {
  margin-bottom: 6px;

  .fd-greet {
    h1 { font-size: 25px; font-weight: 750; letter-spacing: -0.015em; margin: 0 0 4px; color: #12303a; }
    p { margin: 0 0 22px; color: #5f7278; font-size: 15px; }
  }

  .fd-home-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
    margin-bottom: 30px;

    @media (max-width: $screen-sm-min) { grid-template-columns: repeat(2, 1fr); }
  }
  .fd-hstat {
    background: #fff;
    border: 1px solid #e4ebed;
    border-radius: 12px;
    padding: 15px 18px 17px;
    box-shadow: 0 1px 2px rgba(18, 48, 58, 0.05);

    .fd-hstat-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
    .l { font-size: 12.5px; color: #5f7278; font-weight: 600; }
    .fd-hstat-icon {
      width: 32px; height: 32px; border-radius: 9px; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
      svg { width: 16px; height: 16px; }
      &.tone-blue { background: #e3f0f6; color: #1C6FA6; }
      &.tone-teal { background: #e0f0f2; color: #0E7490; }
      &.tone-green { background: #e2f3ea; color: #2E8B5A; }
      &.tone-violet { background: #eee9f7; color: #6b4fb0; }
    }
    .n { font-size: 27px; font-weight: 750; letter-spacing: -0.01em; line-height: 1; color: #12303a; }
  }
}
</style>

<i18n lang="json5">
{
  "en": {
    "greet": {
      "morning": "Good morning",
      "afternoon": "Good afternoon",
      "evening": "Good evening",
      "morningName": "Good morning, {name}",
      "afternoonName": "Good afternoon, {name}",
      "eveningName": "Good evening, {name}"
    },
    "subtitle": "Here's what's happening across your field operations.",
    "stat": {
      "projects": "Active projects",
      "forms": "Published forms",
      "submissions": "Total submissions",
      "users": "Team members"
    }
  }
}
</i18n>

<style lang="scss">
#fd-home-summary {
  .fd-home-stats { display: flex; flex-wrap: wrap; gap: 0; background: #fff; border: 1px solid #e1e9ec; border-radius: 10px; margin-bottom: 24px; }
  .fd-hstat { display: flex; align-items: center; gap: 14px; flex: 1 1 180px; box-shadow: none; border: 0; border-radius: 0; padding: 14px 18px; }
  .fd-hstat-top { margin: 0; gap: 10px; align-items: center; }
  .fd-hstat:has(.stat-unavailable) { flex-direction: column; align-items: flex-start; gap: 6px; }
  .stat-unavailable { font-size: 12px; }
  .fd-hstat .n { font-size: 22px; margin-left: auto; }
  .fd-hstat-icon { display: none; }
}
@media (max-width: 600px) { #fd-home-summary .fd-hstat { flex-basis: 50%; min-width: 0; padding: 12px; } }
</style>
