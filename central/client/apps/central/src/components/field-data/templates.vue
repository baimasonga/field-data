<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

This file is part of Field Data, a distribution of ODK Central. It is subject to
the license terms in the LICENSE file found in the top-level directory of this
distribution and at https://www.apache.org/licenses/LICENSE-2.0.

Project Templates: reusable Field Data operating presets.
-->
<template>
  <div id="fd-templates">
    <header class="fd-head">
      <div>
        <h1>{{ $t('title') }}</h1>
        <p>{{ $t('subtitle') }}</p>
      </div>
      <button type="button" class="fd-primary" :aria-disabled="awaitingResponse" @click="saveTemplate">{{ $t('action.save') }}</button>
    </header>

    <loading :state="templates.initiallyLoading"/>

    <template v-if="templates.dataExists">
      <div class="fd-template-summary">
        <div><span>{{ templates.data.templates.length }}</span>{{ $t('summary.templates') }}</div>
        <div><span>{{ templates.data.qualityRules.length }}</span>{{ $t('summary.rules') }}</div>
      </div>

      <div class="template-grid">
        <article v-for="template of templateList" :key="template.id" class="template-card">
          <div class="template-top">
            <div>
              <span class="category">{{ template.category }}</span>
              <h2>{{ template.name }}</h2>
            </div>
            <button v-if="template.createdBy" type="button" class="icon-btn" :title="$t('action.delete')" :aria-label="$t('action.delete')"
              :aria-disabled="awaitingResponse" @click="deleteTemplate(template)">
              &times;
            </button>
          </div>
          <p class="description">{{ template.description || $t('noDescription') }}</p>

          <div class="section">
            <h3>{{ $t('section.forms') }}</h3>
            <div class="chips">
              <span v-for="form of configList(template, 'forms')" :key="form">{{ form }}</span>
              <span v-if="configList(template, 'forms').length === 0" class="muted">{{ $t('empty.forms') }}</span>
            </div>
          </div>

          <div class="section">
            <h3>{{ $t('section.workflow') }}</h3>
            <ol class="workflow">
              <li v-for="step of configList(template, 'workflow')" :key="step">{{ workflowLabel(step) }}</li>
            </ol>
          </div>

          <div class="section">
            <h3>{{ $t('section.rules') }}</h3>
            <div class="rules">
              <span v-for="rule of activeRuleNames(template)" :key="rule">{{ rule }}</span>
              <span v-if="activeRuleNames(template).length === 0" class="muted">{{ $t('empty.rules') }}</span>
            </div>
          </div>

          <div class="section">
            <h3>{{ $t('section.integrations') }}</h3>
            <div class="chips integrations">
              <span v-for="item of configList(template, 'integrations')" :key="item">{{ integrationLabel(item) }}</span>
              <span v-if="configList(template, 'integrations').length === 0" class="muted">{{ $t('empty.integrations') }}</span>
            </div>
          </div>

          <footer>
            <span v-if="template.createdBy">{{ $t('createdBy', { name: template.createdBy }) }}</span>
            <span v-else>{{ $t('starter') }}</span>
          </footer>
        </article>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, inject } from 'vue';
import { useI18n } from 'vue-i18n';

import Loading from '../loading.vue';

import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';
import { useRequestData } from '../../request-data';

defineOptions({ name: 'FieldDataTemplates' });

const { t } = useI18n();
const alert = inject('alert');
const { request, awaitingResponse } = useRequest();
const { createResource } = useRequestData();
const templates = createResource('fieldDataTemplates');

const reload = () => templates.request({ url: apiPaths.fieldDataTemplates() }).catch(noop);
reload();

const templateList = computed(() => (templates.dataExists ? templates.data.templates : []));
const ruleLabelMap = computed(() => Object.fromEntries(
  (templates.dataExists ? templates.data.qualityRules : []).map(rule => [rule.key, rule.label])
));

const configList = (template, key) => (Array.isArray(template.config?.[key]) ? template.config[key] : []);
const activeRuleNames = (template) => Object.entries(template.config?.qualityRules || {})
  .filter(([, config]) => config?.active !== false)
  .map(([key]) => ruleLabelMap.value[key] || key);

const labelize = (value) => value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const workflowLabel = (value) => labelize(value);
const integrationLabel = (value) => labelize(value);

const saveTemplate = () => {
  // eslint-disable-next-line no-alert
  const name = window.prompt(t('prompt.name'));
  if (name == null || name.trim() === '') return;
  // eslint-disable-next-line no-alert
  const description = window.prompt(t('prompt.description')) || '';
  request({
    method: 'POST',
    url: apiPaths.fieldDataTemplates(),
    data: {
      name,
      category: 'Custom',
      description
    }
  })
    .then(() => {
      alert.success(t('alert.saved'));
      reload();
    })
    .catch(noop);
};

const deleteTemplate = (template) => {
  // eslint-disable-next-line no-alert
  if (!window.confirm(t('prompt.delete', { name: template.name }))) return;
  request({ method: 'DELETE', url: apiPaths.fieldDataTemplate(template.id) })
    .then(() => {
      alert.success(t('alert.deleted'));
      reload();
    })
    .catch(noop);
};
</script>

<i18n lang="json5">
{
  "en": {
    "title": "Project Templates",
    "subtitle": "Reusable project setup patterns for repeated field operations.",
    "noDescription": "No description provided.",
    "starter": "Starter template",
    "createdBy": "Saved by {name}",
    "summary": {
      "templates": "templates",
      "rules": "quality rules captured"
    },
    "section": {
      "forms": "Expected forms",
      "workflow": "Workflow",
      "rules": "Quality rules",
      "integrations": "Integrations"
    },
    "empty": {
      "forms": "Add forms when creating the project.",
      "rules": "No active rules.",
      "integrations": "No integrations."
    },
    "action": {
      "save": "Save Current Setup",
      "delete": "Delete template"
    },
    "prompt": {
      "name": "Template name:",
      "description": "Template description (optional):",
      "delete": "Delete the \"{name}\" template?"
    },
    "alert": {
      "saved": "Template saved.",
      "deleted": "Template deleted."
    }
  }
}
</i18n>

<style lang="scss">
#fd-templates {
  --b: #e4ebed;
  --muted: #667a80;
  --teal: #0E7490;

  .fd-head {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px;
    h1 { font-size: 24px; font-weight: 750; margin: 0 0 4px; color: #143039; }
    p { margin: 0; color: var(--muted); font-size: 14px; }
  }

  .fd-primary {
    border: 0; border-radius: 8px; background: var(--teal); color: #fff;
    min-height: 38px; padding: 0 14px; font-weight: 750; white-space: nowrap;
    &:hover { filter: brightness(0.96); }
  }

  .fd-template-summary {
    display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap;
    div {
      min-width: 180px; border: 1px solid var(--b); background: #fff; border-radius: 12px; padding: 12px 15px;
      color: var(--muted); font-size: 12.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
    }
    span { display: block; color: #143039; font-size: 25px; line-height: 1.1; margin-bottom: 3px; letter-spacing: 0; }
  }

  .template-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: 14px;
  }

  .template-card {
    border: 1px solid var(--b); background: #fff; border-radius: 8px; padding: 16px;
    display: flex; flex-direction: column; gap: 13px; box-shadow: 0 1px 2px rgba(20,48,57,0.04);
    .template-top { display: flex; justify-content: space-between; gap: 10px; }
    .category { color: var(--teal); font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; }
    h2 { margin: 2px 0 0; color: #143039; font-size: 17px; font-weight: 800; }
    .description { margin: 0; color: #3d5157; line-height: 1.38; min-height: 38px; }
    .icon-btn {
      border: 1px solid #f0d4d0; background: #fff6f5; color: #b3210c; border-radius: 8px;
      width: 30px; height: 30px; font-size: 20px; line-height: 1; flex: 0 0 auto;
    }
    .section { border-top: 1px solid #edf2f3; padding-top: 11px; }
    h3 { margin: 0 0 8px; color: var(--muted); font-size: 11.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; }
    .chips, .rules { display: flex; gap: 6px; flex-wrap: wrap; }
    .chips span, .rules span {
      background: #eef6f8; color: #225969; border-radius: 16px; padding: 4px 9px; font-size: 12px; font-weight: 700;
    }
    .integrations span { background: #f0f5f1; color: #2f684a; }
    .muted { background: transparent !important; color: var(--muted) !important; padding: 0 !important; font-weight: 600 !important; }
    .workflow { margin: 0; padding-left: 20px; color: #33474d; }
    .workflow li { margin-bottom: 3px; }
    footer { margin-top: auto; color: var(--muted); font-size: 12px; }
  }
}
</style>
