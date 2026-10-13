<!--
Copyright 2025 ODK Central Developers
See the NOTICE file at the top-level directory of this distribution and at
https://github.com/getodk/central-frontend/blob/master/NOTICE.

This file is part of ODK Central. It is subject to the license terms in
the LICENSE file found in the top-level directory of this distribution and at
https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
including this file, may be copied, modified, propagated, or distributed
except according to the terms contained in the LICENSE file.
-->
<template>
  <div v-if="inspector" class="submission-actions submission-inspector-actions">
    <router-link :to="detailPath" class="more-button btn btn-primary">View full record</router-link>
    <button v-if="project.verbs.has('submission.update')" type="button" class="review-button btn btn-default">{{ $t('action.review') }}</button>
    <details v-if="project.verbs.has('submission.update') || project.verbs.has('submission.delete')" class="record-more">
      <summary>{{ $t('action.more') }}</summary>
      <div class="record-more-options">
        <template v-if="project.verbs.has('submission.update')">
          <a v-if="submission.__system.status == null" class="btn btn-link" :href="editPath" target="_blank" rel="noopener noreferrer">{{ $t('action.edit') }}</a>
          <button v-else type="button" class="btn btn-link" disabled>{{ $t('action.edit') }}</button>
        </template>
        <button v-if="project.verbs.has('submission.delete')" type="button" class="delete-button btn btn-link" :disabled="awaitingResponse">{{ $t('action.delete') }}<spinner :state="awaitingResponse"/></button>
      </div>
    </details>
  </div>
  <div v-else class="submission-actions btn-group">
    <button v-if="project.verbs.has('submission.delete')" type="button"
      class="delete-button btn btn-default" :aria-label="$t('action.delete')"
      v-tooltip.aria-label>
      <span class="icon-trash"></span><spinner :state="awaitingResponse"/>
    </button>
    <template v-if="project.verbs.has('submission.update')">
      <button type="button" class="review-button btn btn-default"
        :aria-label="$t('action.review')" v-tooltip.aria-label>
        <span class="icon-check"></span>
      </button>
      <a v-if="submission.__system.status == null" class="btn btn-default"
        :href="editPath" target="_blank" :aria-label="editLabel"
        v-tooltip.aria-label>
        <span class="icon-pencil"></span>
      </a>
      <button v-else type="button" class="btn btn-default"
        :aria-label="editLabel" aria-disabled="true"
        v-tooltip.aria-describedby="$t('submission.editDisabled')">
        <span class="icon-pencil"></span>
      </button>
    </template>
    <router-link v-slot="{ href }" :to="detailPath" custom>
      <a class="more-button btn btn-default" :href="href" target="_blank">
        <span>{{ $t('action.more') }}</span>
        <span class="icon-angle-right"></span>
      </a>
    </router-link>
  </div>
</template>

<script setup>
// This component is tested via the tests of SubmissionMetadataRow.

import { computed, inject } from 'vue';

import Spinner from '../spinner.vue';

import useRoutes from '../../composables/routes';
import { useRequestData } from '../../request-data';

defineOptions({
  name: 'SubmissionActions'
});
const props = defineProps({
  submission: {
    type: Object,
    required: true
  },
  awaitingResponse: Boolean,
  inspector: Boolean
});

const { i18n } = inject('container');
const { project, form } = useRequestData();

const { submissionPath, editSubmissionPath } = useRoutes();
const detailPath = computed(() =>
  submissionPath(form.projectId, form.xmlFormId, props.submission.__id));

const editPath = computed(() => editSubmissionPath(
  form.projectId,
  form.xmlFormId,
  props.submission.__id,
  form.webformsEnabled
));
const editLabel = computed(() => i18n.t('submission.action.edit', {
  count: i18n.n(props.submission.__system.edits, 'default')
}));
</script>

<style lang="scss">
.submission-inspector-actions {
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
  > .btn { min-height: 44px; font-size: 13px; padding: 10px 12px; border-radius: 7px; }
  .more-button { flex: 1; }
  .record-more { position: relative; }
  summary { padding: 12px 8px; min-height: 44px; cursor: pointer; font-size: 13px; }
  .record-more-options { display: flex; flex-wrap: wrap; }
  .delete-button { color: #a42727; }
}
</style>
