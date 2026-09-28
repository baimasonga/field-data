<!--
Copyright 2022 ODK Central Developers
See the NOTICE file at the top-level directory of this distribution and at
https://github.com/getodk/central-frontend/blob/master/NOTICE.

This file is part of ODK Central. It is subject to the license terms in
the LICENSE file found in the top-level directory of this distribution and at
https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
including this file, may be copied, modified, propagated, or distributed
except according to the terms contained in the LICENSE file.

Field Data: reworked into a clean, labelled row (Form · Submissions · Needs
review · Last submission · Status) instead of the original cryptic icon columns.
-->
<template>
  <tr class="fd-form-row">
    <td class="f-name">
      <span class="f-dot"></span>
      <template v-if="canLinkToDraftStatus">
        <form-link :form="form"/>
      </template>
      <template v-else-if="canLinkToSubmissions">
        <form-link :form="form" :to="submissionsPath.all"/>
      </template>
      <template v-else-if="canLinkToEnketo">
        <a :href="enketoPath" target="_blank">{{ form.nameOrId }}</a>
      </template>
      <template v-else>{{ form.nameOrId }}</template>
      <span v-if="showIdForDuplicateName" class="dup-id">{{ form.xmlFormId }}</span>
    </td>

    <template v-if="form.publishedAt != null">
      <td class="f-num">
        <router-link v-if="canLinkToSubmissions" :to="submissionsPath.all">{{ $n(form.submissions, 'default') }}</router-link>
        <template v-else>{{ $n(form.submissions, 'default') }}</template>
      </td>
      <td class="f-num">
        <template v-if="needsReview > 0">
          <router-link v-if="canLinkToSubmissions" :to="submissionsPath.received" class="review-link">
            {{ $n(needsReview, 'default') }}<span class="f-sub">{{ $t('toReview') }}</span>
          </router-link>
          <template v-else>{{ $n(needsReview, 'default') }}<span class="f-sub">{{ $t('toReview') }}</span></template>
        </template>
        <span v-else class="f-none">0</span>
      </td>
      <td class="f-when">
        <template v-if="form.lastSubmission != null">
          <date-time :iso="form.lastSubmission" relative="past" :tooltip="false"/>
        </template>
        <span v-else class="f-none">{{ $t('submission.noSubmission') }}</span>
      </td>
      <td class="f-status"><span class="fd-pill" :class="statusClass">{{ statusLabel }}</span></td>
    </template>
    <template v-else>
      <td class="f-num"><span class="f-none">—</span></td>
      <td class="f-num"><span class="f-none">—</span></td>
      <td class="f-when"><span class="f-none">{{ $t('submission.noSubmission') }}</span></td>
      <td class="f-status"><span class="fd-pill draft">{{ $t('formState.unpublished') }}</span></td>
    </template>
  </tr>
</template>

<script>
import DateTimeComponent from '../date-time.vue';
import FormLink from '../form/link.vue';

import useRoutes from '../../composables/routes';
import { useRequestData } from '../../request-data';

export default {
  name: 'ProjectFormRow',
  components: { DateTime: DateTimeComponent, FormLink },
  props: {
    form: { type: Object, required: true },
    project: { type: Object, required: true },
    // Kept for API compatibility with the caller; no longer used for a separate
    // icon column.
    showIcon: { type: Boolean, default: false }
  },
  setup() {
    const { projects } = useRequestData();
    const { duplicateFormNamesPerProject } = projects.toRefs();
    const { formPath, newSubmissionPath } = useRoutes();
    return { duplicateFormNamesPerProject, formPath, newSubmissionPath };
  },
  computed: {
    canLinkToDraftStatus() {
      return this.form.publishedAt == null && this.project.permits('form.update');
    },
    canLinkToSubmissions() {
      return this.project.permits('submission.list');
    },
    canLinkToEnketo() {
      return this.form.publishedAt != null && this.form.state === 'open' && this.form.enketoId !== null;
    },
    // Submissions not yet resolved (received / has issues / edited).
    needsReview() {
      const rs = this.form.reviewStates || {};
      return (rs.received || 0) + (rs.hasIssues || 0) + (rs.edited || 0);
    },
    statusLabel() {
      return this.$t(`formState.${this.form.state}`);
    },
    statusClass() {
      if (this.form.state === 'open') return 'open';
      if (this.form.state === 'closing') return 'closing';
      return 'closed';
    },
    submissionsPath() {
      const submissionPath = this.formPath(this.form.projectId, this.form.xmlFormId, 'submissions');
      return {
        received: `${submissionPath}?reviewState=null`,
        all: submissionPath
      };
    },
    enketoPath() {
      return this.newSubmissionPath(this.form.projectId, this.form.xmlFormId, !this.form.publishedAt);
    },
    showIdForDuplicateName() {
      const formNames = this.duplicateFormNamesPerProject[this.project.id];
      return formNames ? formNames.has(this.form.nameOrId.toLocaleLowerCase()) : false;
    }
  }
};
</script>

<style lang="scss">
@import '../../assets/scss/mixins';

.fd-form-row {
  td {
    padding: 12px 16px;
    font-size: 14px;
    color: #23343a;
    border-top: 1px solid #eef3f4;
    vertical-align: middle;
  }
  &:hover td { background-color: #f7fbfc; }

  .f-name {
    font-weight: 500;
    a { color: #23343a; font-weight: 600; &:hover { color: #0E7490; } }
  }
  .f-dot {
    display: inline-block; width: 8px; height: 8px; border-radius: 2px;
    background: #1C6FA6; margin-right: 10px; vertical-align: middle;
  }
  .dup-id { font-family: $font-family-monospace; font-size: 12px; color: #8fa1a7; margin-left: 8px; }

  .f-num { text-align: right; width: 130px; font-variant-numeric: tabular-nums;
    a { color: #23343a; font-weight: 600; &:hover { color: #0E7490; } }
  }
  .review-link { color: #9c6209 !important; font-weight: 700; }
  .f-sub { color: #a9b6ba; font-size: 12px; margin-left: 5px; font-weight: 500; }
  .f-none { color: #b3bfc2; }

  .f-when { text-align: right; width: 180px; color: #5f7278; }

  .f-status { text-align: right; width: 96px; }
  .fd-pill {
    display: inline-block; padding: 3px 11px; border-radius: 20px;
    font-size: 12px; font-weight: 600;
    &.open { background: #e2f3ea; color: #1f6e45; }
    &.closing { background: #fdf3e0; color: #9c6209; }
    &.closed, &.draft { background: #eef1f2; color: #566065; }
  }
}
</style>

<i18n lang="json5">
{
  "en": {
    // Shown after the count of submissions that still need review.
    "toReview": "to review"
  }
}
</i18n>
