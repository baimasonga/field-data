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
  <map-popup v-show="instanceId != null" id="submission-map-popup" ref="popup"
    :back="odata != null" label="Submission record" @hide="$emit('hide')" @back="$emit('back')">
    <template v-if="submission.dataExists" #title>
<span v-tooltip.text>{{ submission.instanceName ?? $t('submissionDetails') }}</span>
    </template>
    <template #body>
      <loading :state="submission.awaitingResponse"/>
      <div v-if="fields.dataExists" v-show="submission.dataExists">
        <submission-review-state v-if="submission.dataExists" class="record-status" :value="submission.__system.reviewState"/>
        <dl>
          <div>
            <dt>{{ $t('header.submitterName') }}</dt>
            <dd v-tooltip.text>{{ submission?.__system?.submitterName }}</dd>
          </div>
          <div>
            <dt>{{ $t('header.submissionDate') }}</dt>
            <dd><record-date-time :iso="submission?.__system?.submissionDate"/></dd>
          </div>
        </dl>
        <div v-if="missingField != null">
          <span class="icon-warning"></span>
          <i18n-t keypath="missingField">
            <template #field>
              <strong v-tooltip.no-aria="missingField.header">
                {{ missingField.name }}
              </strong>
            </template>
          </i18n-t>
        </div>
        <section v-if="timing" class="record-timing">
          <h3>Collection timing</h3>
          <dl>
            <div><dt>Started</dt><dd><record-date-time :iso="timing.start"/></dd></div>
            <div><dt>Ended</dt><dd><record-date-time :iso="timing.end"/></dd></div>
            <div><dt>Recorded duration</dt><dd>{{ Math.floor(timing.seconds / 60) }} min {{ timing.seconds % 60 }} sec</dd></div>
          </dl>
        </section>
        <p v-if="fieldpath" class="record-location-context">Mapped location: {{ mappedFieldName }} · GPS accuracy: Unknown.</p>
        <details class="record-answers">
<summary>Survey answers · {{ fields.selectable.length }}</summary>
        <dl>
          <div v-for="field of fields.selectable" :key="field.path">
            <dl-data
              :value="field.binary !== true ? formatValue(submission.data, field, $i18n) : null">
              <template #name>
                <span v-if="field.path === fieldpath" class="icon-check-circle mapped-field-icon"
                  v-tooltip.sr-only></span>
                <span v-tooltip.no-aria="field.header" class="field-name">{{ field.name }}</span>
                <span v-if="field.path === fieldpath" class="sr-only">&nbsp;{{ $t('mappedField') }}</span>
              </template>
              <template v-if="field.binary === true && getValue(submission.data, field) != null"
                #value>
                <submission-attachment-link :project-id="projectId"
                  :xml-form-id="xmlFormId" :instance-id="instanceId"
                  :attachment-name="getValue(submission.data, field)"/>
              </template>
            </dl-data>
          </div>
        </dl>
        </details>
      </div>
    </template>
    <template #footer>
      <submission-actions v-if="submission.dataExists"
        :submission="submission.data" :awaiting-response="awaitingResponse" inspector
        @click="handleActions"/>
    </template>
  </map-popup>
</template>

<script setup>
import { computed, useTemplateRef, watch } from 'vue';
import { last } from 'ramda';

import RecordDateTime from '../record-date-time.vue';
import recordTiming from '../../util/record-timing';
import DlData from '../dl-data.vue';
import Loading from '../loading.vue';
import MapPopup from '../map/popup.vue';
import SubmissionActions from './actions.vue';
import SubmissionAttachmentLink from './attachment-link.vue';
import SubmissionReviewState from './review-state.vue';

import useSubmission from '../../request-data/submission';
import { apiPaths } from '../../util/request';
import { getValue, formatValue } from '../../util/submission';
import { useRequestData } from '../../request-data';

defineOptions({
  name: 'SubmissionMapPopup'
});
const props = defineProps({
  projectId: {
    type: String,
    required: true
  },
  xmlFormId: {
    type: String,
    required: true
  },
  instanceId: String,
  fieldpath: String,
  odata: Object,
  awaitingResponse: Boolean
});
const emit = defineEmits(['hide', 'back', 'review', 'delete']);

const { fields } = useRequestData();
const { submission } = useSubmission();

const fetchData = () => submission.request({
  url: apiPaths.odataSubmission(
    props.projectId,
    props.xmlFormId,
    props.instanceId,
    { $wkt: true }
  )
}).catch(() => { emit('hide'); });

const popup = useTemplateRef('popup');

watch(
  () => props.instanceId,
  (instanceId) => {
    if (instanceId != null) {
      if (props.odata == null)
        fetchData();
      else
        submission.setFromResponse({ data: { value: [props.odata] } });
    } else {
      submission.reset();
      if (popup.value != null) popup.value.resetScroll();
    }
  },
  { immediate: true }
);

const timing = computed(() => (submission.dataExists && fields.dataExists ? recordTiming(submission.data, fields.selectable) : null));

const missingField = computed(() => {
  if (props.fieldpath == null || fields.selectable.find(field => field.path === props.fieldpath)) return null;
  const elements = props.fieldpath.split('/');
  elements.shift();
  return { name: last(elements), header: elements.join('-') };
});
const mappedFieldName = computed(() => missingField.value?.name ?? fields.selectable?.find(field => field.path === props.fieldpath)?.name ?? props.fieldpath);
const handleActions = (event) => {
  const action = event.target.closest('.btn');
  if (action == null) return;
  const { classList } = action;
  if (classList.contains('review-button'))
    emit('review', submission.data);
  else if (classList.contains('delete-button'))
    emit('delete', submission.data);
};
</script>

<style lang="scss">
@import '../../assets/scss/mixins';
@import '../../assets/scss/variables';

#submission-map-popup {
  width: min(380px, calc(100% - 30px));
  max-height: calc(100% - 30px);
  background: #fff;
  border: 1px solid #dce6e9;
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(20, 48, 57, 0.16);

  .map-popup-title { font-size: 18px; padding-bottom: 12px; }
  .map-popup-footer { padding-top: 14px; }
  .map-popup-body { font-size: 14px; }
  .record-status { display: inline-flex; padding: 4px 9px; border-radius: 6px; background: #eef3f5; margin-bottom: 14px; }
  dl > div { display: grid; grid-template-columns: 100px minmax(0, 1fr); gap: 10px; padding: 6px 0; }
  dt { font-size: 12px; color: #5a6b71; }
  dd { font-size: 14px; margin: 0; white-space: normal; overflow-wrap: anywhere; }
  .record-timing h3 { font-size: 14px; font-weight: 700; margin: 14px 0 6px; }
  .record-location-context { color: #5a6b71; font-size: 12px; margin-top: 12px; }
  .record-answers summary { padding: 12px 0; font-weight: 600; cursor: pointer; }

  @media (max-width: 600px) {
    top: auto; bottom: 0; left: 0; width: 100%; max-height: 70%;
    border-radius: 14px 14px 0 0;
    > .close { min-width: 44px; min-height: 44px; top: 0; right: 0; }
  }

  .submission-review-state {
    position: relative;
    top: -1px;

    font-size: 14px;
  }

  dl:first-of-type {
    padding-bottom: $padding-block-dl;
    border-bottom: $border-bottom-dl;
  }
  dl + div {
    padding-block: $padding-block-dl;
    border-bottom: $border-bottom-dl;
  }
  dl:last-of-type {
    padding-top: $padding-block-dl;
  }

  .icon-warning {
    color: $color-warning;
    margin-right: $margin-right-icon;
  }

  .mapped-field-icon {
    margin-right: 2px;
    color: $color-success;
  }
}
</style>

<i18n lang="json5">
{
  "en": {
    // @transifexKey component.SubmissionBasicDetails.submissionDetails
    "submissionDetails": "Submission Details",
    // {field} is the name of a Form field.
    "missingField": "This Submission was mapped using {field}, which isn’t in the published Form version.",
    // Message of the tooltip of checkmark icon, which is shown next of the fieldname that is used to plot pins on the map
    "mappedField": "Map references this field"
  }
}
</i18n>

<!-- Autogenerated by destructure.js -->
<i18n>
{
  "de": {
    "missingField": "Diese Übermittlung wurde mit {field} zugeordnet, das nicht in der veröffentlichten Formularversion enthalten ist.",
    "mappedField": "Karte verweist auf dieses Feld.",
    "submissionDetails": "Übermittlungsdetails"
  },
  "es": {
    "missingField": "Este Envío se ha mapeado utilizando {field}, que no se encuentra en la versión publicada del Formulario.",
    "mappedField": "El mapa hace referencia a este campo.",
    "submissionDetails": "Detalles de envío"
  },
  "fr": {
    "missingField": "Cette soumission a été cartographiée selon le champ {field} qui n'est pas dans la version publiée du formulaire.",
    "mappedField": "Carte utilise ce champ",
    "submissionDetails": "Détail de la soumission"
  },
  "it": {
    "missingField": "Questo invio è stato mappato utilizzando {field}, che non è presente nella versione pubblicata del formulario.",
    "mappedField": "La mappa fa riferimento a questo campo.",
    "submissionDetails": "Dettagli invio"
  },
  "pt": {
    "submissionDetails": "Detalhes da resposta"
  },
  "zh": {
    "missingField": "此提交数据在映射时使用了已发布表单版本中不存在的字段 {field}。",
    "mappedField": "地图引用此字段",
    "submissionDetails": "提交详情"
  },
  "zh-Hant": {
    "missingField": "此提交是使用{field}進行地圖標記的，而該功能並未包含在已發布的表單版本中。",
    "mappedField": "地圖參照此欄位",
    "submissionDetails": "提交詳情"
  }
}
</i18n>
