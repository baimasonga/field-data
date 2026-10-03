<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

This file is part of Field Data, a distribution of ODK Central. It is subject to
the license terms in the LICENSE file found in the top-level directory of this
distribution and at https://www.apache.org/licenses/LICENSE-2.0.

Review Queue: submissions awaiting review, with automatic data-quality flags and
one-click approve / reject (approval workflow).
-->
<template>
  <div id="fd-submission-review">
    <header class="fd-head">
      <h1>{{ $t('title') }}</h1>
      <p>{{ $t('subtitle') }}</p>
    </header>

    <loading :state="review.initiallyLoading"/>

    <template v-if="review.dataExists">
      <div class="fd-review-bar">
        <span class="chip"><b>{{ review.data.counts.pending }}</b> {{ $t('pending') }}</span>
        <span class="chip warn"><b>{{ review.data.counts.flagged }}</b> {{ $t('flagged') }}</span>
        <button type="button" class="btn btn-link" @click="reload">{{ $t('refresh') }}</button>
      </div>

      <div v-if="qualitySummary.length > 0" class="fd-quality-summary">
        <span v-for="s of qualitySummary" :key="s.key" class="qchip" :class="s.key">
          <b>{{ s.count }}</b> {{ s.label || $t(`flag.${s.key}`) }}
        </span>
      </div>

      <details class="fd-rule-panel">
        <summary>{{ $t('rules.title') }}</summary>
        <div class="rule-grid">
          <div v-for="rule of rules" :key="rule.key" class="rule-card">
            <label class="rule-toggle">
              <input type="checkbox" :checked="rule.active" :disabled="awaitingResponse" @change="toggleRule(rule, $event.target.checked)">
              <span>{{ rule.label || $t(`flag.${rule.key}`) }}</span>
            </label>
            <p>{{ rule.description }}</p>
            <div v-if="ruleFields(rule).length > 0" class="rule-fields">
              <label v-for="field of ruleFields(rule)" :key="field.key">
                {{ field.label }}
                <input type="number" class="form-control" :step="field.step || 1" :min="field.min || 0"
                  :value="rule.config[field.key]" :disabled="awaitingResponse"
                  @change="updateRuleConfig(rule, field.key, $event.target.value)">
              </label>
            </div>
          </div>
        </div>
      </details>

      <div class="fd-panel">
        <table class="fd-table">
          <thead>
<tr>
            <th>{{ $t('th.form') }}</th>
            <th>{{ $t('th.submitter') }}</th>
            <th>{{ $t('th.district') }}</th>
            <th>{{ $t('th.submitted') }}</th>
            <th>{{ $t('th.flags') }}</th>
            <th class="a">{{ $t('th.actions') }}</th>
          </tr>
</thead>
          <tbody>
            <tr v-for="item of items" :key="item.id" class="rowlink" @click="openSubmission(item)">
              <td class="form">
                <button type="button" class="submission-link" @click.stop="openSubmission(item)">
                  {{ item.formName || item.form }}
                </button>
              </td>
              <td>{{ item.submitter || $t('unassigned') }}</td>
              <td>{{ item.district || '-' }}</td>
              <td class="muted"><date-time :iso="item.createdAt" relative="past"/></td>
              <td>
                <span v-for="f of item.flags" :key="f" class="flag" :class="f">{{ $t(`flag.${f}`) }}</span>
                <span v-if="item.flags.length === 0" class="ok">{{ $t('flag.clean') }}</span>
                <p v-if="item.latestReviewNote" class="review-note">{{ item.latestReviewNote }}</p>
              </td>
              <td class="a">
                <button type="button" class="rbtn approve" :aria-disabled="awaitingResponse" @click.stop="act(item, 'approved')">{{ $t('action.approve') }}</button>
                <button type="button" class="rbtn issue" :aria-disabled="awaitingResponse" @click.stop="act(item, 'hasIssues')">{{ $t('action.correct') }}</button>
                <button type="button" class="rbtn reject" :aria-disabled="awaitingResponse" @click.stop="act(item, 'rejected')">{{ $t('action.reject') }}</button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="items.length === 0" class="fd-empty">{{ $t('empty') }}</p>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, inject } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import DateTime from '../date-time.vue';
import Loading from '../loading.vue';

import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';
import { useRequestData } from '../../request-data';

defineOptions({ name: 'FieldDataSubmissionReview' });

const { t } = useI18n();
const alert = inject('alert');
const router = useRouter();
const { request, awaitingResponse } = useRequest();
const { createResource } = useRequestData();
const review = createResource('fieldDataReview');

const reload = () => review.request({ url: apiPaths.fieldDataReview() }).catch(noop);
reload();

const items = computed(() => (review.dataExists ? review.data.items : []));
const qualitySummary = computed(() => (review.dataExists ? review.data.qualitySummary || [] : []));
const rules = computed(() => (review.dataExists ? review.data.rules || [] : []));

const RULE_FIELDS = {
  rapidSuccession: [{ key: 'minutes', label: 'Minutes', min: 1 }],
  possibleDuplicate: [{ key: 'minutes', label: 'Minutes', min: 1 }],
  offHours: [{ key: 'startHour', label: 'Start hour', min: 0 }, { key: 'endHour', label: 'End hour', min: 1 }],
  unusualVolume: [
    { key: 'minDailyCount', label: 'Minimum daily count', min: 1 },
    { key: 'multiplier', label: 'Multiplier', min: 1, step: 0.1 },
    { key: 'lookbackDays', label: 'Lookback days', min: 1 }
  ]
};
const ruleFields = (rule) => RULE_FIELDS[rule.key] || [];

const openSubmission = (item) => {
  router.push(`/projects/${item.projectId}/forms/${encodeURIComponent(item.form)}/submissions/${encodeURIComponent(item.instanceId)}`);
};

const saveRule = (rule, changes) => request({
  method: 'PATCH',
  url: apiPaths.fieldDataQualityRule(rule.key),
  data: changes
}).then(() => reload()).catch(noop);

const toggleRule = (rule, active) => { saveRule(rule, { active }); };
const updateRuleConfig = (rule, key, rawValue) => {
  const value = Number(rawValue);
  if (Number.isNaN(value)) return;
  saveRule(rule, { config: { [key]: value } });
};

const act = (item, decision) => {
  let note = null;
  if (decision === 'rejected' || decision === 'hasIssues') {
    // eslint-disable-next-line no-alert
    note = window.prompt(t(decision === 'rejected' ? 'rejectPrompt' : 'correctionPrompt', { form: item.formName || item.form }));
    if (note === null) return; // cancelled
  }
  request({ method: 'POST', url: apiPaths.fieldDataReview(), data: { submissionId: item.id, decision, note } })
    .then(() => {
      alert.success(t(`alert.${decision}`));
      reload();
    })
    .catch(noop);
};
</script>

<i18n lang="json5">
{
  "en": {
    "title": "Submission quality review",
    "subtitle": "Manage submission status and quality rules. These actions are separate from claim-version review decisions.",
    "pending": "pending review",
    "flagged": "flagged",
    "refresh": "Refresh",
    "unassigned": "(unassigned)",
    "th": { "form": "Form", "submitter": "Submitter", "district": "District", "submitted": "Submitted", "flags": "Quality flags", "actions": "Decision" },
    "flag": {
      "noLocation": "No location",
      "noSubmitter": "No submitter",
      "hasIssues": "Has issues",
      "rapidSuccession": "Rapid succession",
      "possibleDuplicate": "Possible duplicate",
      "offHours": "Off-hours",
      "unusualVolume": "Unusual volume",
      "clean": "Clean"
    },
    "action": { "approve": "Approve", "correct": "Request correction", "reject": "Reject" },
    "rules": { "title": "Quality rules" },
    "rejectPrompt": "Reason for rejecting this \"{form}\" submission (optional):",
    "correctionPrompt": "What should be corrected in this \"{form}\" submission?",
    "alert": { "approved": "Submission approved.", "rejected": "Submission rejected.", "hasIssues": "Correction requested." },
    "empty": "Nothing to review - all caught up."
  }
}
</i18n>

<style lang="scss">
@import '../../assets/scss/variables';

#fd-submission-review {
  --b: #e4ebed; --muted: #667a80;
  .fd-head { margin-bottom: 16px;
    h1 { font-size: 24px; font-weight: 750; letter-spacing: -0.01em; margin: 0 0 4px; color: #143039; }
    p { margin: 0; color: var(--muted); font-size: 14px; } }

  .fd-review-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px;
    .chip { background: #eef3f4; color: #33474d; border-radius: 20px; padding: 5px 14px; font-size: 13px; font-weight: 600; b { color: #0E7490; }
      &.warn { background: #fdf3e0; color: #9c6209; b { color: #9c6209; } } }
    .btn-link { margin-left: auto; color: #0E7490; } }

  .fd-quality-summary { display: flex; gap: 8px; flex-wrap: wrap; margin: -4px 0 16px;
    .qchip { border: 1px solid #e7edef; background: #fff; color: #33474d; border-radius: 18px; padding: 5px 11px; font-size: 12.5px; font-weight: 600;
      b { color: #143039; margin-right: 3px; }
      &.rapidSuccession, &.possibleDuplicate { border-color: #f3d3a6; background: #fff7ea; color: #8a5607; }
      &.offHours { border-color: #d9dcfb; background: #f1f2ff; color: #464a91; }
      &.unusualVolume { border-color: #c7dfef; background: #edf7fc; color: #155a86; } } }

  .fd-rule-panel { background: #fff; border: 1px solid var(--b); border-radius: 12px; padding: 12px 14px; margin-bottom: 16px;
    summary { cursor: pointer; font-size: 13.5px; font-weight: 700; color: #143039; }
    .rule-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
    .rule-card { border: 1px solid #edf2f4; border-radius: 10px; padding: 10px 12px; background: #fbfdfe;
      p { margin: 4px 0 8px; color: var(--muted); font-size: 12.5px; }
      .rule-toggle { display: flex; align-items: center; gap: 8px; font-weight: 700; color: #143039; } }
    .rule-fields { display: flex; flex-wrap: wrap; gap: 8px;
      label { color: var(--muted); font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; }
      .form-control { width: 90px; height: 30px; margin-top: 3px; font-size: 12.5px; } }
    @media (max-width: 900px) { .rule-grid { grid-template-columns: 1fr; } } }

  .fd-panel { background: #fff; border: 1px solid var(--b); border-radius: 14px; box-shadow: 0 1px 2px rgba(18,48,58,0.04); overflow-x: auto; }
  .fd-table { width: 100%; border-collapse: collapse;
    th { text-align: left; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); padding: 12px 16px; border-bottom: 1px solid var(--b); white-space: nowrap; &.a { text-align: right; } }
    td { padding: 12px 16px; border-bottom: 1px solid #f1f5f6; font-size: 14px; vertical-align: middle; &.a { text-align: right; white-space: nowrap; } }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #f7fbfc; }
    .rowlink { cursor: pointer; }
    .form { font-weight: 600; color: #143039; }
    .submission-link { border: 0; background: transparent; color: #002b3b; font: inherit; font-weight: 700; padding: 0; text-align: left; cursor: pointer;
      &:hover { color: #0E7490; text-decoration: underline; } }
    .muted { color: var(--muted); } }

  .flag { display: inline-block; padding: 2px 9px; border-radius: 20px; font-size: 11.5px; font-weight: 600; margin: 2px 4px 2px 0;
    background: #fdf3e0; color: #9c6209;
    &.noLocation { background: #fdecea; color: #b3210c; }
    &.hasIssues { background: #fdf3e0; color: #9c6209; }
    &.noSubmitter { background: #eef1f2; color: #566065; }
    &.rapidSuccession, &.possibleDuplicate { background: #fff0d9; color: #8a5607; }
    &.offHours { background: #eef0ff; color: #464a91; }
    &.unusualVolume { background: #e3f0f6; color: #155a86; } }
  .review-note { margin: 6px 0 0; color: #667a80; font-size: 12px; max-width: 360px; }
  .ok { color: #1f6e45; font-size: 12.5px; font-weight: 600; }

  .rbtn { border: none; border-radius: 8px; font-size: 13px; font-weight: 600; padding: 6px 14px; margin-left: 8px; cursor: pointer;
    &.approve { background: #e2f3ea; color: #1f6e45; &:hover { background: #d0ecdb; } }
    &.issue { background: #fdf3e0; color: #9c6209; &:hover { background: #f9e6bd; } }
    &.reject { background: #fdecea; color: #b3210c; &:hover { background: #fbdbd6; } } }

  .fd-empty { padding: 40px; text-align: center; color: var(--muted); font-size: 15px; }
}
</style>
