<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

Build a Form without leaving to make a spreadsheet.

This does not create the Form. It asks the server to turn what has been built
into an XLSForm, then posts that spreadsheet to the ordinary Form upload
endpoint -- so pyxform's validation, drafts and publishing, versioning, and the
list ODK Collect downloads from are all the existing ones. There is one path by
which a Form comes into being, and this is a way of reaching it.

That also means the spreadsheet is real, and downloadable. Advanced authoring adds nested groups, repeats and XLSForm expressions.
-->
<template>
  <div id="form-builder">
    <p class="section-lead">{{ $t('lead') }}</p>

    <div class="form-group builder-title">
      <label for="form-builder-title">{{ $t('field.title') }}</label>
      <input id="form-builder-title" v-model.trim="draft.title" class="form-control"
        maxlength="255" :placeholder="$t('field.titlePlaceholder')" @input="touchFormId">
      <p class="field-help">
        {{ $t('field.formIdIs') }} <code>{{ effectiveFormId || '—' }}</code>
        {{ $t('field.formIdWhy') }}
      </p>
    </div>

    <label><input v-model="advanced" type="checkbox" :disabled="hasAdvancedFields"> Advanced authoring (groups, repeats, logic and translations)</label>
    <div v-if="advanced">
      <p>Question names must remain unique. Renaming or deleting a referenced question requires repairing its expressions.</p>
      <label>Default language<input v-model="defaultLanguage" class="form-control"></label>
      <label>Reusable choice lists (JSON object: list name → choice array)<textarea v-model="listsText" class="form-control" rows="4"></textarea></label>
      <label>Reopen saved form ID<input v-model="reopenId" class="form-control"></label>
      <button type="button" class="btn btn-default" @click="reopen">Load builder definition</button>
      <p v-if="advancedError" role="alert">{{ advancedError }}</p>
      <div v-for="(question, index) of draft.questions" :key="question.id || question.key">
        <advanced-question :model-value="question" @update:model-value="draft.questions[index] = $event"/>
        <button type="button" class="btn btn-default" :disabled="index === 0" @click="move(index, -1)">Move up</button>
        <button type="button" class="btn btn-default" :disabled="index === draft.questions.length - 1" @click="move(index, 1)">Move down</button>
        <button type="button" class="btn btn-default" @click="removeQuestion(index)">Remove question</button>
      </div>
    </div>
    <ol v-else class="question-list">
      <li v-for="(question, index) of draft.questions" :key="question.key" class="question">
        <div class="question-head">
          <span class="question-number">{{ index + 1 }}</span>
          <select v-model="question.type" class="form-control question-type"
            :aria-label="$t('field.type')" @change="typeChanged(question)">
            <option v-for="type of questionTypes" :key="type.name" :value="type.name">
              {{ $t(`type.${type.name}`) }}
            </option>
          </select>
          <input v-model.trim="question.label" class="form-control question-label"
            :placeholder="$t('field.label')" :aria-label="$t('field.label')"
            @input="suggestName(question)">
          <div class="question-actions">
            <button type="button" class="btn btn-link btn-sm" :aria-label="$t('action.moveUp')"
              :aria-disabled="index === 0" @click="move(index, -1)">
              <span class="icon-angle-up" aria-hidden="true"></span>
            </button>
            <button type="button" class="btn btn-link btn-sm" :aria-label="$t('action.moveDown')"
              :aria-disabled="index === draft.questions.length - 1" @click="move(index, 1)">
              <span class="icon-angle-down" aria-hidden="true"></span>
            </button>
            <button type="button" class="btn btn-link btn-sm remove"
              :aria-label="$t('action.removeQuestion')" @click="removeQuestion(index)">
              <span class="icon-trash" aria-hidden="true"></span>
            </button>
          </div>
        </div>

        <div class="question-detail">
          <label class="detail-name">
            <span>{{ $t('field.name') }}</span>
            <input v-model.trim="question.name" class="form-control" maxlength="64"
              @input="question.nameEdited = true">
          </label>
          <label class="detail-hint">
            <span>{{ $t('field.hint') }}</span>
            <input v-model.trim="question.hint" class="form-control">
          </label>
          <label v-if="question.type !== 'note'" class="detail-required">
            <input v-model="question.required" type="checkbox">
            <span>{{ $t('field.required') }}</span>
          </label>
        </div>

        <div v-if="needsChoices(question.type)" class="choices">
          <p class="choices-heading">{{ $t('field.choices') }}</p>
          <div v-for="(choice, at) of question.choices" :key="choice.key" class="choice-row">
            <input v-model.trim="choice.label" class="form-control choice-label"
              :placeholder="$t('field.choiceLabel')" :aria-label="$t('field.choiceLabel')"
              @input="suggestChoiceName(choice)">
            <input v-model.trim="choice.name" class="form-control choice-name"
              :placeholder="$t('field.choiceName')" :aria-label="$t('field.choiceName')"
              @input="choice.nameEdited = true">
            <button type="button" class="btn btn-link btn-sm"
              :aria-label="$t('action.removeChoice')" @click="question.choices.splice(at, 1)">
              <span class="icon-trash" aria-hidden="true"></span>
            </button>
          </div>
          <button type="button" class="btn btn-default btn-sm" @click="addChoice(question)">
            <span class="icon-plus-circle" aria-hidden="true"></span> {{ $t('action.addChoice') }}
          </button>
        </div>
      </li>
    </ol>

    <p v-if="draft.questions.length === 0" class="empty-table-message">{{ $t('noQuestions') }}</p>

    <button type="button" class="btn btn-default add-question" @click="addQuestion">
      <span class="icon-plus-circle" aria-hidden="true"></span> {{ $t('action.addQuestion') }}
    </button>

    <div class="builder-footer">
      <button type="button" class="btn btn-primary" :aria-disabled="!canCreate || awaitingResponse"
        @click="create">
        {{ $t('action.create') }} <spinner :state="awaitingResponse"/>
      </button>
      <!-- The way out when the builder runs out of road. -->
      <button type="button" class="btn btn-link" :aria-disabled="!canCreate || awaitingResponse"
        @click="download">
        {{ $t('action.download') }}
      </button>
      <span class="footer-note">{{ $t('footerNote') }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed, inject, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import Spinner from '../spinner.vue';
import AdvancedQuestion from './advanced-question.vue';
import { useRequestData } from '../../request-data';

import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';

defineOptions({ name: 'FormBuilder' });

const props = defineProps({
  projectId: { type: [String, Number], required: true }
});
const emit = defineEmits(['success']);

const { t } = useI18n();
const { request, awaitingResponse } = useRequest();
const alert = inject('alert');
const { currentUser } = useRequestData();
const draftKey = `field-data:builder:v2:${currentUser.id}:${props.projectId}`;


let key = 0;
const nextKey = () => { key += 1; return key; };

// Only what the server will accept, read from the server so the two cannot
// disagree about which types exist.
const questionTypes = ref([
  { name: 'text', needsChoices: false },
  { name: 'select_one', needsChoices: true }
]);
request({ method: 'GET', url: apiPaths.formBuilderQuestionTypes() })
  .then(({ data }) => { questionTypes.value = data; })
  .catch(noop);

const advanced = ref(false); const listsText = ref('{}'); const defaultLanguage = ref(''); const reopenId = ref(''); const advancedError = ref('');
const draft = reactive({ title: '', formId: '', formIdEdited: false, questions: [] });

// Names become XML node names. Suggesting one from the label saves most people
// from ever thinking about it, and anybody who cares can overwrite it.
const toName = (label) => label.toLowerCase().replace(/[^a-z0-9]+/g, '_')
  .replace(/^[^a-z_]+/, '').replace(/^_+|_+$/g, '')
  .slice(0, 64);

const effectiveFormId = computed(() => (draft.formIdEdited && draft.formId !== ''
  ? draft.formId
  : toName(draft.title)));
const touchFormId = () => {};

const needsChoices = (type) => questionTypes.value
  .find(entry => entry.name === type)?.needsChoices === true;

const suggestName = (question) => {
  if (question.nameEdited !== true) Object.assign(question, { name: toName(question.label) });
};
const suggestChoiceName = (choice) => {
  if (choice.nameEdited !== true) Object.assign(choice, { name: toName(choice.label) });
};

const addQuestion = () => {
  draft.questions.push({
    id: crypto.randomUUID(),
    key: nextKey(), type: 'text', name: '', label: '', hint: '',
    required: false, nameEdited: false, choices: []
  });
};
const removeQuestion = (index) => { draft.questions.splice(index, 1); };
const move = (index, by) => {
  const to = index + by;
  if (to < 0 || to >= draft.questions.length) return;
  const [question] = draft.questions.splice(index, 1);
  draft.questions.splice(to, 0, question);
};
const addChoice = (question) => {
  question.choices.push({ key: nextKey(), name: '', label: '', nameEdited: false });
};
const typeChanged = (question) => {
  if (needsChoices(question.type) && question.choices.length === 0) addChoice(question);
};

const canCreate = computed(() => draft.title !== '' && draft.questions.length > 0);

// What the server validates. Sent as it is built, so the message that comes
// back names a question by its position here.
const basicDefinition = () => ({
  title: draft.title,
  formId: effectiveFormId.value,
  questions: draft.questions.map(question => ({
    type: question.type,
    name: question.name,
    label: question.label,
    hint: question.hint,
    required: question.required,
    choices: needsChoices(question.type)
      ? question.choices.map(({ name, label }) => ({ name, label }))
      : undefined
  }))
});

const definition = () => {
  if (!advanced.value) return basicDefinition();
  let lists; try { lists = JSON.parse(listsText.value); } catch { advancedError.value = 'Reusable lists must be valid JSON.'; throw new Error(advancedError.value); }
  return { schemaVersion: 2, title: draft.title, formId: effectiveFormId.value, defaultLanguage: defaultLanguage.value, lists, questions: draft.questions };
};
const reopen = async () => {
  try {
    const { data } = await request({ method: 'GET', url: `/v1/projects/${props.projectId}/forms/${encodeURIComponent(reopenId.value)}/builder-definition` });
    if (!data.definition) { advancedError.value = 'This uploaded form has no editable builder definition. Download and edit its original XLSForm.'; return; }
    const d = data.definition; draft.title = d.title; draft.formId = d.formId; draft.formIdEdited = true;
    draft.questions = d.questions.map(q => ({ ...q, key: nextKey(), id: q.id || crypto.randomUUID(), choices: q.choices || [] }));
    listsText.value = JSON.stringify(d.lists || {}, null, 2); defaultLanguage.value = d.defaultLanguage || ''; advancedError.value = '';
  } catch { advancedError.value = 'The saved definition could not be loaded.'; }
};
const xlsform = (snapshot = definition()) => request({
  method: 'POST',
  url: apiPaths.formBuilderXlsform(props.projectId),
  data: snapshot,
  responseType: 'blob'
});

const download = () => {
  xlsform().then(({ data }) => {
    const url = URL.createObjectURL(data);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${effectiveFormId.value}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
    // useRequest already raises the server's own message as an alert, which
    // names the field and says what is wrong with it. A second rendering of
    // the same failure, in different words, is two answers to one question.
  }).catch(noop);
};

const create = () => {
  if (!canCreate.value) return;
  const snapshot = definition();
  xlsform(snapshot)
    .then(({ data }) => request({
      method: 'POST',
      // The ordinary upload endpoint. Warnings are accepted: the builder
      // cannot produce the shapes pyxform warns about, and stopping here to
      // relay one would be a dead end nobody could act on.
      url: apiPaths.forms(props.projectId, { ignoreWarnings: true }),
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'X-XlsForm-FormId-Fallback': encodeURIComponent(effectiveFormId.value)
      },
      data
    }))
    .then(({ data: form }) => request({
      // Kept so the Form can be reopened here. A builder that can only create
      // is one somebody uses once.
      method: 'PUT',
      url: apiPaths.formBuilderDefinition(props.projectId, form.xmlFormId),
      data: snapshot
    }).catch(() => {
      // The Form exists; losing the definition costs the ability to reopen it
      // and nothing else, so it is said rather than thrown.
      alert.warning(t('alert.definitionNotSaved'));
    }).then(() => form))
    .then((form) => { sessionStorage.removeItem(draftKey); emit('success', form); })
    .catch(noop);
};

const hasAdvancedFields = computed(() => advanced.value && (listsText.value !== '{}' || defaultLanguage.value !== '' || draft.questions.some(q => ['group', 'repeat', 'calculate'].includes(q.type) || ['relevant', 'constraint', 'calculation', 'choiceFilter'].some(k => q[k]) || Object.keys(q.translations || {}).length)));
try {
  const saved = JSON.parse(sessionStorage.getItem(draftKey));
  if (saved) { Object.assign(draft, saved.draft); advanced.value = saved.advanced; listsText.value = saved.listsText; defaultLanguage.value = saved.defaultLanguage; }
} catch { /* An incompatible local draft does not replace the saved server definition. */ }
key = Math.max(key, ...draft.questions.map(q => Number(q.key) || 0));
if (!draft.questions.length) addQuestion();
watch([draft, advanced, listsText, defaultLanguage], () => {
  try { sessionStorage.setItem(draftKey, JSON.stringify({ draft, advanced: advanced.value, listsText: listsText.value, defaultLanguage: defaultLanguage.value })); } catch { advancedError.value = 'Local draft could not be saved. Download the XLSForm to preserve your work.'; }
}, { deep: true });
</script>

<i18n lang="json5">
{
  "en": {
    "lead": "Add the questions, and Field Data writes the XLSForm for you. The Form is created the same way an uploaded spreadsheet is, so it publishes, versions and downloads to phones exactly the same.",
    "noQuestions": "No questions yet.",
    "footerNote": "Use advanced authoring for nested groups, repeats, calculations, cascading choices and translations. Download the XLSForm for further editing.",
    "field": {
      "title": "Form title",
      "titlePlaceholder": "For example, Housing Survey 2026",
      "formIdIs": "Its Form ID will be",
      "formIdWhy": "— this is what appears in links and on the phone.",
      "type": "Question type",
      "label": "Question, as somebody reads it on the phone",
      "name": "Name",
      "hint": "Hint",
      "required": "An answer is required",
      "choices": "Choices",
      "choiceLabel": "Choice, as it is read",
      "choiceName": "Saved as"
    },
    "type": {
      "text": "Text", "integer": "Whole number", "decimal": "Decimal number",
      "date": "Date", "time": "Time", "dateTime": "Date and time",
      "select_one": "Choose one", "select_multiple": "Choose several",
      "note": "Note (no answer)", "geopoint": "Location", "image": "Photo"
    },
    "action": {
      "addQuestion": "Add question", "removeQuestion": "Remove question",
      "moveUp": "Move up", "moveDown": "Move down",
      "addChoice": "Add choice", "removeChoice": "Remove choice",
      "create": "Create Form", "download": "Download as XLSForm"
    },
    "alert": {
      "definitionNotSaved": "The Form was created, but it could not be saved for reopening in the builder. You can still edit it by uploading a new spreadsheet."
    }
  }
}
</i18n>

<style lang="scss">
@import '../../assets/scss/variables';

#form-builder {
  .section-lead { color: $color-text-muted; margin-bottom: 18px; max-width: 82ch; }
  .field-help { color: $color-text-muted; font-size: 12px; margin: 4px 0 0; }
  .builder-title { max-width: 520px; }

  .question-list { list-style: none; margin: 18px 0 0; padding: 0; }

  .question {
    border: 1px solid #e9e9f1;              // gradient --gray-150
    border-radius: 6px;
    margin-bottom: 10px;
    padding: 12px 14px;
  }

  .question-head { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; }

  .question-number {
    color: $color-text-muted;
    flex: 0 0 auto;
    font-size: 12px;
    min-width: 18px;
  }

  .question-type { flex: 0 1 170px; min-width: 0; width: auto; }
  .question-label { flex: 2 1 220px; min-width: 0; width: auto; }
  .question-actions { display: flex; flex: 0 0 auto; margin-left: auto; }
  .question-actions .remove { color: $color-danger; }

  .question-detail {
    align-items: flex-end;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 10px;

    label { display: block; font-weight: normal; margin: 0; }
    label > span { color: $color-text-muted; display: block; font-size: 12px; }
    .detail-name, .detail-hint { flex: 1 1 180px; min-width: 0; }
    .detail-required { align-self: center; }
    .detail-required input { margin-right: 6px; }
  }

  .choices {
    background-color: #f8f8fb;              // gradient --gray-50
    border-radius: 4px;
    margin-top: 10px;
    padding: 10px 12px;
  }

  .choices-heading {
    color: $color-text-muted;
    font-size: 12px;
    font-weight: 600;
    margin: 0 0 6px;
  }

  // Wraps, and the inputs may shrink below their basis: at 390px a label, a
  // name and a delete button do not fit on one line, and a flex item will not
  // shrink past its content without min-width: 0.
  .choice-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 6px; }
  .choice-label { flex: 2 1 150px; min-width: 0; width: auto; }
  .choice-name { flex: 1 1 110px; min-width: 0; width: auto; }

  .add-question { margin-top: 6px; }


  .builder-footer {
    align-items: center;
    border-top: 1px solid #e9e9f1;          // gradient --gray-150
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 18px;
    padding-top: 14px;
  }

  .footer-note { color: $color-text-muted; flex: 1 1 260px; font-size: 12px; }
}
</style>
