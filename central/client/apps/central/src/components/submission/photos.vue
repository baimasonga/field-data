<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

Every photograph a Form has collected, newest first.

The grid is the point, so the chrome around each image stays out of the way
until you want it. Nothing here is a chart: these are pictures, and the job
is to let someone look through them and then get to the Submission a picture
came from.
-->
<template>
  <div id="submission-photos">
    <loading :state="loading"/>

    <template v-if="!loading && total != null">
      <p v-if="total === 0" class="empty-table-message">
        {{ $t('emptyGallery') }}
      </p>

      <template v-else>
        <p class="photos-count">{{ $t('count', total) }}</p>

        <ul class="photo-grid">
          <li v-for="photo of loaded" :key="`${photo.instanceId}/${photo.name}`">
            <button type="button" class="photo-tile" @click="open(photo)">
              <!-- Native lazy loading: a form with hundreds of photographs
              should not fetch them all to show the first twelve. -->
              <img :src="imageUrl(photo)" :alt="altFor(photo)" loading="lazy" decoding="async">
              <span class="photo-meta">
                <span class="photo-submitter">{{ photo.submitter ?? $t('unknownSubmitter') }}</span>
                <date-time :iso="photo.createdAt"/>
              </span>
            </button>
          </li>
        </ul>

        <div v-if="total > loaded.length" class="photos-more">
          <button type="button" class="btn btn-default" :aria-disabled="awaitingResponse"
            @click="showMore">
            {{ $t('action.showMore') }}
            <spinner :state="awaitingResponse"/>
          </button>
        </div>
      </template>
    </template>

    <!-- A plain overlay rather than a modal component: there is no form to
    submit here, only a bigger copy of the picture and where it came from. -->
    <div v-if="viewing != null" class="photo-viewer" role="dialog" aria-modal="true"
      :aria-label="altFor(viewing)" @click.self="close">
      <div class="viewer-inner">
        <img :src="imageUrl(viewing)" :alt="altFor(viewing)">
        <div class="viewer-bar">
          <div class="viewer-facts">
            <span class="viewer-name">{{ viewing.name }}</span>
            <span class="viewer-submitter">
              {{ viewing.submitter ?? $t('unknownSubmitter') }} ·
              <date-time :iso="viewing.createdAt"/>
            </span>
          </div>
          <div class="viewer-actions">
            <router-link :to="submissionPath(viewing)" class="btn btn-default">
              {{ $t('action.openSubmission') }}
            </router-link>
            <a :href="imageUrl(viewing)" class="btn btn-default" download>
              {{ $t('action.download') }}
            </a>
            <button ref="closeButton" type="button" class="btn btn-primary" @click="close">
              {{ $t('action.close') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { nextTick, onMounted, onUnmounted, ref, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';

import DateTime from '../date-time.vue';
import Loading from '../loading.vue';
import Spinner from '../spinner.vue';

import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';

defineOptions({ name: 'SubmissionPhotos' });

const props = defineProps({
  projectId: { type: String, required: true },
  xmlFormId: { type: String, required: true }
});

const { t } = useI18n();
const { request, awaitingResponse } = useRequest();

// The list accumulates rather than being replaced, because "show more" should
// add to what is on screen instead of emptying the grid and refilling it. A
// resource would replace it, so the page is kept here.
const PAGE = 60;
const loaded = ref([]);
const total = ref(null);
const loading = ref(true);

const load = (offset) => request({
  method: 'GET',
  url: apiPaths.formPhotos(props.projectId, props.xmlFormId, offset, PAGE)
})
  .then(({ data }) => {
    total.value = data.total;
    loaded.value = offset === 0 ? data.photos : [...loaded.value, ...data.photos];
  })
  .catch(noop)
  .finally(() => { loading.value = false; });

load(0);

const showMore = () => load(loaded.value.length);

const imageUrl = (photo) => apiPaths.submissionAttachment(
  props.projectId, props.xmlFormId, false, photo.instanceId, photo.name
);

const submissionPath = (photo) =>
  `/projects/${props.projectId}/forms/${encodeURIComponent(props.xmlFormId)}/submissions/${encodeURIComponent(photo.instanceId)}`;

// There is no caption to borrow and no way to know what is in the picture, so
// the alt text says what the file is and where it came from. That is more use
// to a screen reader than an empty attribute or a repeated "photo".
const altFor = (photo) => t('alt', {
  name: photo.name,
  submitter: photo.submitter ?? t('unknownSubmitter')
});

const viewing = ref(null);
const closeButton = useTemplateRef('closeButton');

const open = async (photo) => {
  viewing.value = photo;
  await nextTick();
  if (closeButton.value != null) closeButton.value.focus();
};
const close = () => { viewing.value = null; };

// Escape closes it, which is what every overlay on the web does and what
// anyone on a keyboard will try first.
const onKeydown = (event) => {
  if (event.key === 'Escape' && viewing.value != null) close();
};
onMounted(() => { document.addEventListener('keydown', onKeydown); });
onUnmounted(() => { document.removeEventListener('keydown', onKeydown); });
</script>

<i18n lang="json5">
{
  "en": {
    "emptyGallery": "This Form has not collected any photographs yet.",
    // {count} is the number of photographs in the Form.
    "count": "{count} photograph | {count} photographs",
    "unknownSubmitter": "(unknown)",
    // {name} is a file name. {submitter} is the person who sent it in.
    "alt": "Photograph {name}, submitted by {submitter}",
    "action": {
      "showMore": "Show more",
      "openSubmission": "Open Submission",
      "download": "Download",
      "close": "Close"
    }
  }
}
</i18n>

<style lang="scss">
@import '../../assets/scss/variables';

#submission-photos {
  padding-top: 20px;

  .photos-count {
    color: $color-text-muted;
    font-size: 13px;
    margin-bottom: 14px;
  }

  .photo-grid {
    display: grid;
    gap: 14px;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .photo-tile {
    background: none;
    border: 1px solid #e9e9f1;              // gradient --gray-150
    border-radius: 8px;
    display: block;
    overflow: hidden;
    padding: 0;
    text-align: left;
    width: 100%;

    &:hover { border-color: #aba3f4; }      // gradient --iris-300
    &:focus-visible {
      border-color: #5d4ee0;                // gradient --iris-600
      box-shadow: 0 0 0 3px #e1defc;        // gradient --iris-100
      outline: none;
    }

    img {
      aspect-ratio: 4 / 3;
      background-color: #f1f1f6;            // gradient --gray-100, before it paints
      display: block;
      height: auto;
      object-fit: cover;
      width: 100%;
    }
  }

  .photo-meta {
    display: block;
    padding: 8px 10px;

    .photo-submitter {
      color: $color-text;
      display: block;
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    time, .date-time { color: $color-text-muted; font-size: 11px; }
  }

  .photos-more { margin-top: 20px; text-align: center; }

  .photo-viewer {
    align-items: center;
    // The scrim is dark enough that a pale photograph still reads as the
    // subject and the page behind it does not compete.
    background-color: rgba(12, 12, 17, 0.88);   // gradient --gray-1000
    bottom: 0;
    display: flex;
    justify-content: center;
    left: 0;
    padding: 24px;
    position: fixed;
    right: 0;
    top: 0;
    z-index: 1060;
  }

  .viewer-inner {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-height: 100%;
    max-width: 1100px;
    width: 100%;

    img {
      background-color: #14141b;             // gradient --gray-950
      border-radius: 8px;
      max-height: calc(100vh - 160px);
      object-fit: contain;
      width: 100%;
    }
  }

  .viewer-bar {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    justify-content: space-between;
  }

  .viewer-facts {
    color: #e0e0ea;                          // gradient --gray-200
    font-size: 13px;
    min-width: 0;

    .viewer-name {
      display: block;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .viewer-submitter { color: #adadbf; }    // gradient --gray-400
  }

  .viewer-actions { display: flex; flex-wrap: wrap; gap: 8px; }
}
</style>
