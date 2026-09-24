<!--
Copyright 2026 Field Data Developers
Licensed under the Apache License, Version 2.0.

The Fieldwork Verification Centre for one Form.

Two things sit here, in this order on purpose. First what the evidence is:
how many Submissions carry a device capture time, how many carry a location,
and what those readings can and cannot establish. Then what an explainable
check made of it.

A finding is a question for a reviewer, never a verdict. Each one shows what
triggered it, the numbers it rests on, the ordinary explanations that would
account for it, and the next thing to do. There is no score, because there is
nothing here from which a probability of fraud could honestly be calculated,
and a number that looks like one would be believed.
-->
<template>
  <div id="submission-verification">
    <loading :state="loading"/>

    <template v-if="!loading && evidence != null">
      <submission-review-queue :project-id="projectId" :xml-form-id="xmlFormId"/>
      <section class="verification-evidence">
        <h2>{{ $t('evidence.title') }}</h2>
        <p class="section-lead">{{ $t('evidence.lead') }}</p>

        <div class="summary-kpis">
          <div class="kpi-card">
            <div class="kpi-value">{{ $n(evidence.coverage.total, 'default') }}</div>
            <div class="kpi-label">{{ $t('evidence.submissions') }}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-value">
              {{ $t('evidence.outOf', {
                some: $n(evidence.coverage.withCaptureTime, 'default'),
                total: $n(evidence.coverage.total, 'default')
              }) }}
            </div>
            <div class="kpi-label">{{ $t('evidence.captureTime') }}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-value">
              {{ $t('evidence.outOf', {
                some: $n(evidence.coverage.withLocation, 'default'),
                total: $n(evidence.coverage.total, 'default')
              }) }}
            </div>
            <div class="kpi-label">{{ $t('evidence.location') }}</div>
          </div>
        </div>

        <!-- Stated plainly and up front, because every finding below rests on
        these and a reader who does not know them will over-read the rest. -->
        <details class="evidence-limits">
          <summary>{{ $t('evidence.limitsTitle') }}</summary>
          <ul>
            <li v-for="limit of evidence.limits" :key="limit">{{ limit }}</li>
          </ul>
        </details>
      </section>

      <section class="verification-findings">
        <div class="findings-head">
          <h2>{{ $t('findings.title') }}</h2>
          <button v-if="canReview" type="button" class="btn btn-primary"
            :aria-disabled="awaitingResponse" @click="run">
            {{ $t('action.run') }} <spinner :state="awaitingResponse"/>
          </button>
        </div>
        <p class="section-lead">{{ $t('findings.lead') }}</p>

        <div v-if="lastRun != null" class="run-report" role="status">
          {{ $t('findings.ranReport', {
            examined: $n(lastRun.examined, 'default'),
            collectors: $n(lastRun.collectors, 'default'),
            concerns: $n(lastRun.concerns, 'default'),
            inconclusive: $n(lastRun.inconclusive, 'default')
          }) }}
          <span class="run-rule">{{ $t('findings.rule', {
            rule: lastRun.rule, version: lastRun.ruleVersion,
            speed: lastRun.thresholds.maxSpeedKmh
          }) }}</span>
        </div>

        <p v-if="flags.length === 0" class="empty-table-message">
          {{ $t('findings.none') }}
        </p>

        <ul v-else class="finding-list">
          <li v-for="flag of flags" :key="flag.id" class="finding"
            :class="`outcome-${flag.outcome}`">
            <div class="finding-head">
              <span class="finding-outcome">
                <span :class="outcomeIcon(flag.outcome)" aria-hidden="true"></span>
                {{ $t(`outcome.${flag.outcome}`) }}
              </span>
              <span class="finding-status">{{ $t(`status.${flag.status}`) }}</span>
            </div>

            <p class="finding-what">{{ describe(flag) }}</p>

            <dl v-if="flag.outcome === 'concern'" class="finding-evidence">
              <div>
                <dt>{{ $t('evidenceLabel.distance') }}</dt>
                <dd>{{ $t('evidenceLabel.distanceValue', {
                  least: $n(flag.evidence.leastDistanceM, 'default'),
                  straight: $n(flag.evidence.straightLineM, 'default')
                }) }}</dd>
              </div>
              <div>
                <dt>{{ $t('evidenceLabel.apart') }}</dt>
                <dd>{{ $t('evidenceLabel.minutes', {
                  minutes: $n(Math.round(flag.evidence.secondsBetween / 60), 'default')
                }) }}</dd>
              </div>
              <div>
                <dt>{{ $t('evidenceLabel.implied') }}</dt>
                <dd>{{ $t('evidenceLabel.speed', { speed: flag.evidence.impliedSpeedKmh }) }}</dd>
              </div>
            </dl>

            <template v-if="flag.evidence.alternatives != null">
              <p class="finding-subhead">{{ $t('findings.alternatives') }}</p>
              <ul class="finding-alternatives">
                <li v-for="alt of flag.evidence.alternatives" :key="alt">{{ alt }}</li>
              </ul>
              <p class="finding-next">{{ flag.evidence.nextStep }}</p>
            </template>

            <p class="finding-links">
              <router-link :to="submissionPath(flag.instanceId)">
                {{ $t('findings.openSubmission') }}
              </router-link>
              <router-link v-if="flag.relatedInstanceId != null"
                :to="submissionPath(flag.relatedInstanceId)">
                {{ $t('findings.openPrevious') }}
              </router-link>
            </p>

            <div v-if="flag.decidedAt != null" class="finding-decision">
              {{ $t(`decision.${flag.decision}`) }}
              <span v-if="flag.decidedByName != null">
                — {{ flag.decidedByName }}</span>
              <span v-if="flag.note"> — {{ flag.note }}</span>
            </div>

            <form v-else-if="canReview" class="finding-review"
              @submit.prevent="decide(flag)">
              <select v-model="review[flag.id].decision" class="form-control"
                :aria-label="$t('review.decision')">
                <option value="">{{ $t('review.decision') }}</option>
                <option value="explained">{{ $t('decision.explained') }}</option>
                <option value="data-error">{{ $t('decision.data-error') }}</option>
                <option value="unresolved">{{ $t('decision.unresolved') }}</option>
                <option value="substantiated">{{ $t('decision.substantiated') }}</option>
              </select>
              <input v-model.trim="review[flag.id].note" class="form-control"
                type="text" :placeholder="$t('review.note')"
                :aria-label="$t('review.note')" maxlength="4000">
              <button type="submit" class="btn btn-default"
                :aria-disabled="awaitingResponse">{{ $t('action.record') }}</button>
            </form>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';

import Loading from '../loading.vue';
import Spinner from '../spinner.vue';
import SubmissionReviewQueue from './review-queue.vue';

import useRequest from '../../composables/request';
import { apiPaths } from '../../util/request';
import { noop } from '../../util/util';
import { useRequestData } from '../../request-data';

defineOptions({ name: 'SubmissionVerification' });

const props = defineProps({
  projectId: { type: String, required: true },
  xmlFormId: { type: String, required: true }
});

const { t } = useI18n();
const { request, awaitingResponse } = useRequest();
const { project } = useRequestData();

const evidence = ref(null);
const flags = ref([]);
const lastRun = ref(null);
const loading = ref(true);
const review = reactive({});

// Running a check and recording a decision both change the form's record of
// itself, so they take the permission that changes a form rather than the one
// that reads it.
const canReview = computed(() =>
  project.dataExists && project.permits('submission.update'));

const load = () => Promise.all([
  request({ method: 'GET', url: apiPaths.formEvidence(props.projectId, props.xmlFormId) })
    .then(({ data }) => { evidence.value = data; }),
  request({ method: 'GET', url: apiPaths.formIntegrity(props.projectId, props.xmlFormId) })
    .then(({ data }) => { flags.value = data; })
])
  .catch(noop)
  .finally(() => { loading.value = false; });
load();

// Every open finding needs somewhere to hold a half-written decision.
watchEffect(() => {
  for (const flag of flags.value)
    if (review[flag.id] == null) review[flag.id] = { decision: '', note: '' };
});

const run = () => request({
  method: 'POST',
  url: `${apiPaths.formIntegrity(props.projectId, props.xmlFormId)}/run`
})
  .then(({ data }) => {
    lastRun.value = data;
    return request({
      method: 'GET',
      url: apiPaths.formIntegrity(props.projectId, props.xmlFormId)
    }).then((response) => { flags.value = response.data; });
  })
  .catch(noop);

const decide = (flag) => {
  const entry = review[flag.id];
  if (entry.decision === '') return;
  request({
    method: 'PATCH',
    url: `${apiPaths.formIntegrity(props.projectId, props.xmlFormId)}/${flag.id}`,
    data: { status: 'resolved', decision: entry.decision, note: entry.note || null }
  })
    .then(() => request({
      method: 'GET',
      url: apiPaths.formIntegrity(props.projectId, props.xmlFormId)
    }))
    .then(({ data }) => { flags.value = data; })
    .catch(noop);
};

const submissionPath = (instanceId) =>
  `/projects/${props.projectId}/forms/${encodeURIComponent(props.xmlFormId)}/submissions/${encodeURIComponent(instanceId)}`;

// A concern is not a status colour taken from the review palette by accident:
// it is a state, and it arrives with an icon and a word, never colour alone.
const outcomeIcon = (outcome) => (outcome === 'concern'
  ? 'icon-exclamation-triangle'
  : 'icon-question-circle');

const describe = (flag) => (flag.outcome === 'concern'
  ? t('describe.concern')
  : t(`describe.${flag.evidence.reason}`, t('describe.inconclusive')));
</script>

<i18n lang="json5">
{
  "en": {
    "evidence": {
      "title": "What the evidence shows",
      "lead": "Checks can only say as much as the evidence allows. This is what these Submissions carry.",
      "submissions": "Submissions",
      "captureTime": "With a device capture time",
      "location": "With a usable location",
      // {some} of {total} Submissions.
      "outOf": "{some} of {total}",
      "limitsTitle": "What these readings cannot establish"
    },
    "findings": {
      "title": "Findings",
      "lead": "Each finding is a question for a reviewer, not a conclusion. Nothing here rejects a Submission or marks a collector.",
      "none": "No findings. Either the checks have not been run, or they found nothing worth a second look.",
      // A summary of the last run.
      "ranReport": "Examined {examined} Submissions from {collectors} collectors: {concerns} to look at, {inconclusive} the evidence could not settle.",
      "rule": "Rule {rule} v{version}, above {speed} km/h.",
      "alternatives": "This would also be explained by:",
      "openSubmission": "Open this Submission",
      "openPrevious": "Open the previous one"
    },
    "outcome": {
      "concern": "Worth a look",
      "inconclusive": "Could not tell"
    },
    "status": {
      "open": "Not yet reviewed",
      "investigating": "Being looked into",
      "resolved": "Reviewed"
    },
    "describe": {
      "concern": "Getting from the previous Submission to this one would have meant travelling faster than the threshold, even by the shortest possible path and after allowing for the accuracy both readings reported.",
      "inconclusive": "The check ran and could not reach a conclusion.",
      "no-capture-time": "This Submission carries no device capture time, so it cannot be placed in order. Server receipt time is when the upload arrived, not when the interview happened.",
      "no-location": "One of the two Submissions has no usable location, so the distance between them is unknown.",
      "accuracy-too-poor": "At least one reading was too vague to compare positions against.",
      "interval-too-short": "The two captures are too close together in time for clock differences not to decide the answer."
    },
    "evidenceLabel": {
      "distance": "Distance",
      // {least} is the distance after allowing for accuracy; {straight} is the straight line.
      "distanceValue": "at least {least} m (straight line {straight} m)",
      "apart": "Time between",
      "minutes": "{minutes} minutes",
      "implied": "Implied speed",
      "speed": "{speed} km/h"
    },
    "decision": {
      "explained": "Explained",
      "data-error": "Data error, corrected",
      "unresolved": "Still unresolved",
      "substantiated": "Substantiated through review"
    },
    "review": {
      "decision": "Record a decision",
      "note": "Reason (required to substantiate)"
    },
    "action": {
      "run": "Run checks",
      "record": "Record"
    }
  }
}
</i18n>

<style lang="scss">
@import '../../assets/scss/variables';

#submission-verification {
  padding-top: 20px;

  h2 {
    color: $color-text;
    font-size: 15px;
    font-weight: 600;
    margin: 0 0 4px;
  }

  .section-lead {
    color: $color-text-muted;
    font-size: 13px;
    margin: 0 0 14px;
    max-width: 78ch;
  }

  .summary-kpis {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    margin-bottom: 16px;
  }

  .kpi-card {
    background-color: #f8f8fb;            // gradient --gray-50
    border: 1px solid #e9e9f1;            // gradient --gray-150
    border-radius: 8px;
    flex: 1 1 160px;
    padding: 16px 18px;
  }
  .kpi-value {
    color: $color-text;
    font-size: 24px;
    font-weight: 600;
    line-height: 1.1;
  }
  .kpi-label {
    color: $color-text-muted;
    font-size: 11px;
    letter-spacing: 0.06em;
    margin-top: 6px;
    text-transform: uppercase;
  }

  .evidence-limits {
    margin-bottom: 34px;

    summary {
      color: $color-action-foreground;
      cursor: pointer;
      font-size: 13px;
    }
    ul {
      color: $color-text-secondary;
      font-size: 13px;
      margin: 8px 0 0;
      max-width: 78ch;
      padding-left: 20px;
    }
  }

  .findings-head {
    align-items: flex-start;
    display: flex;
    gap: 16px;
    justify-content: space-between;
  }

  .run-report {
    background-color: #f1f1f6;            // gradient --gray-100
    border-radius: 6px;
    color: $color-text-secondary;
    font-size: 13px;
    margin-bottom: 16px;
    padding: 10px 12px;

    .run-rule { color: $color-text-muted; display: block; font-size: 12px; }
  }

  .finding-list { list-style: none; margin: 0; padding: 0; }

  .finding {
    border: 1px solid #e9e9f1;            // gradient --gray-150
    border-left-width: 3px;
    border-radius: 6px;
    margin-bottom: 12px;
    padding: 14px 16px;

    // The left edge carries the state, and the icon and the words beside it
    // say the same thing, so colour is never the only channel.
    &.outcome-concern { border-left-color: #a86f14; }  // gradient --warning-text
    &.outcome-inconclusive { border-left-color: #8a8a9c; } // gradient --gray-500
  }

  .finding-head {
    display: flex;
    gap: 12px;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .finding-outcome {
    color: $color-text;
    font-size: 13px;
    font-weight: 600;

    [class^="icon-"] { margin-right: 6px; }
  }
  .finding-status { color: $color-text-muted; font-size: 12px; }

  .finding-what {
    color: $color-text-secondary;
    font-size: 13px;
    margin: 0 0 10px;
    max-width: 82ch;
  }

  .finding-evidence {
    display: flex;
    flex-wrap: wrap;
    gap: 22px;
    margin: 0 0 12px;

    // A <dl> is given a ruled row by app.scss. These are three short figures
    // read across, not a list of rows, so the rules are not wanted.
    > * { border-bottom: none; padding-block: 0; }

    dt {
      color: $color-text-muted;
      font-size: 11px;
      font-weight: normal;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    dd {
      color: $color-text;
      font-size: 13px;
      font-variant-numeric: tabular-nums;
      margin: 2px 0 0;
    }
  }

  .finding-subhead {
    color: $color-text-muted;
    font-size: 12px;
    margin: 0 0 4px;
  }
  .finding-alternatives {
    color: $color-text-secondary;
    font-size: 13px;
    margin: 0 0 10px;
    max-width: 82ch;
    padding-left: 20px;
  }
  .finding-next {
    color: $color-text-secondary;
    font-size: 13px;
    font-style: italic;
    margin: 0 0 12px;
    max-width: 82ch;
  }

  .finding-links {
    font-size: 13px;
    margin: 0 0 12px;

    a + a { margin-left: 14px; }
  }

  .finding-decision {
    border-top: 1px solid #f1f1f6;        // gradient --gray-100
    color: $color-text-secondary;
    font-size: 13px;
    padding-top: 10px;
  }

  .finding-review {
    border-top: 1px solid #f1f1f6;        // gradient --gray-100
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding-top: 12px;

    select.form-control { flex: 0 1 240px; width: auto; }
    input.form-control { flex: 1 1 260px; width: auto; }
  }
}
</style>
