<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

This file is part of Field Data, a distribution of ODK Central. It is subject to
the license terms in the LICENSE file found in the top-level directory of this
distribution and at https://www.apache.org/licenses/LICENSE-2.0.

Field Teams: per-enumerator performance (submissions, approval rate, coverage).
-->
<template>
  <div id="fd-team">
    <header class="fd-head">
      <h1>{{ $t('title') }}</h1>
      <p>{{ $t('subtitle') }}</p>
    </header>

    <loading :state="team.initiallyLoading"/>

    <template v-if="team.dataExists">
      <div class="fd-team-stats">
        <div class="s"><div class="n">{{ $n(team.data.totals.enumerators, 'default') }}</div><div class="l">{{ $t('stat.enumerators') }}</div></div>
        <div class="s"><div class="n">{{ $n(team.data.totals.submissions, 'default') }}</div><div class="l">{{ $t('stat.submissions') }}</div></div>
        <div class="s"><div class="n">{{ team.data.totals.avgApproval }}%</div><div class="l">{{ $t('stat.avgApproval') }}</div></div>
      </div>

      <div class="fd-panel">
        <table class="fd-table">
          <thead><tr>
            <th>{{ $t('th.name') }}</th>
            <th class="r">{{ $t('th.submissions') }}</th>
            <th class="r">{{ $t('th.approved') }}</th>
            <th class="r">{{ $t('th.rejected') }}</th>
            <th class="r">{{ $t('th.pending') }}</th>
            <th>{{ $t('th.approvalRate') }}</th>
            <th class="r">{{ $t('th.districts') }}</th>
            <th class="r">{{ $t('th.lastActive') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="m of members" :key="m.submitterId || m.name">
              <td class="name"><span class="ava">{{ initials(m.name) }}</span>{{ m.name }}</td>
              <td class="r"><b>{{ $n(m.total, 'default') }}</b></td>
              <td class="r good">{{ $n(m.approved, 'default') }}</td>
              <td class="r bad">{{ $n(m.rejected, 'default') }}</td>
              <td class="r">{{ $n(m.needsReview, 'default') }}</td>
              <td class="rate">
                <div class="bar"><span :style="{ width: rate(m) + '%' }"></span></div>
                <span class="rate-n">{{ rate(m) }}%</span>
              </td>
              <td class="r">{{ m.districts }}</td>
              <td class="r muted"><date-time v-if="m.lastActive" :iso="m.lastActive" relative="past"/><span v-else>-</span></td>
            </tr>
          </tbody>
        </table>
        <p v-if="members.length === 0" class="fd-empty">{{ $t('empty') }}</p>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue';

import DateTime from '../date-time.vue';
import Loading from '../loading.vue';

import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';
import { useRequestData } from '../../request-data';

defineOptions({ name: 'FieldDataTeam' });

const { createResource } = useRequestData();
const team = createResource('fieldDataTeam');
team.request({ url: apiPaths.fieldDataTeam() }).catch(noop);

const members = computed(() => (team.dataExists ? team.data.members : []));
const rate = (m) => {
  const decided = m.approved + m.rejected;
  return decided > 0 ? Math.round((m.approved / decided) * 100) : 0;
};
const initials = (name) => (name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
</script>

<i18n lang="json5">
{
  "en": {
    "title": "Field Teams",
    "subtitle": "Submission volume, approval rate, and coverage per enumerator.",
    "stat": { "enumerators": "Enumerators", "submissions": "Submissions", "avgApproval": "Avg. approval rate" },
    "th": { "name": "Enumerator", "submissions": "Submissions", "approved": "Approved", "rejected": "Rejected", "pending": "Pending", "approvalRate": "Approval rate", "districts": "Districts", "lastActive": "Last active" },
    "empty": "No enumerator activity yet."
  }
}
</i18n>

<style lang="scss">
@import '../../assets/scss/variables';

#fd-team {
  --b: #e4ebed; --muted: #667a80;
  .fd-head { margin-bottom: 20px;
    h1 { font-size: 24px; font-weight: 750; letter-spacing: -0.01em; margin: 0 0 4px; color: #143039; }
    p { margin: 0; color: var(--muted); font-size: 14px; } }

  .fd-team-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 22px;
    .s { background: #fff; border: 1px solid var(--b); border-radius: 12px; padding: 16px 18px; box-shadow: 0 1px 2px rgba(18,48,58,0.05);
      .n { font-size: 27px; font-weight: 750; letter-spacing: -0.01em; color: #143039; } .l { font-size: 12.5px; color: var(--muted); margin-top: 6px; } } }

  .fd-panel { background: #fff; border: 1px solid var(--b); border-radius: 14px; box-shadow: 0 1px 2px rgba(18,48,58,0.04); overflow-x: auto; }
  .fd-table { width: 100%; border-collapse: collapse;
    th { text-align: left; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); padding: 12px 16px; border-bottom: 1px solid var(--b); white-space: nowrap; &.r { text-align: right; } }
    td { padding: 12px 16px; border-bottom: 1px solid #f1f5f6; font-size: 14px; white-space: nowrap; &.r { text-align: right; font-variant-numeric: tabular-nums; } }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #f7fbfc; }
    .good { color: #1f6e45; font-weight: 600; } .bad { color: #b3210c; } .muted { color: var(--muted); }
    .name { font-weight: 600; color: #143039; }
    .ava { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; margin-right: 10px;
      background: linear-gradient(135deg, #0E7490, #2E8B5A); color: #fff; font-size: 11px; font-weight: 700; vertical-align: middle; } }

  .rate { min-width: 160px;
    .bar { display: inline-block; width: 90px; height: 7px; border-radius: 4px; background: #eef3f4; vertical-align: middle; overflow: hidden;
      span { display: block; height: 100%; background: linear-gradient(90deg, #2E8B5A, #0E7490); } }
    .rate-n { margin-left: 10px; font-weight: 600; font-size: 13px; color: #143039; } }

  .fd-empty { padding: 30px; text-align: center; color: var(--muted); }
}
</style>
