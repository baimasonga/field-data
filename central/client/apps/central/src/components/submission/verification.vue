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
      <submission-review-queue :key="queueKey" :project-id="projectId" :xml-form-id="xmlFormId"
        :can-review="canReview"/>
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

        <dl class="location-coverage">
          <div>
            <dt>{{ $t('location.area') }}</dt>
            <dd v-if="evidence.projectArea?.status === 'set'">{{ evidence.projectArea.title }}</dd>
            <dd v-else>{{ $t(`location.areaUnusable.${evidence.projectArea?.reason ?? 'no-area-set'}`) }}</dd>
            <dd v-if="canManage">
              <button type="button" class="btn btn-link btn-sm area-toggle" :aria-expanded="showArea"
                @click="showArea = !showArea">
                {{ showArea ? $t('location.closeArea') : $t('location.setArea') }}
              </button>
            </dd>
          </div>
          <div v-if="evidence.coverage.byProjectArea">
            <dt>{{ $t('location.where') }}</dt>
            <dd>{{ coverageText(evidence.coverage.byProjectArea, 'withinArea') }}</dd>
          </div>
          <div v-if="evidence.coverage.byAccuracyBand">
            <dt>{{ $t('location.accuracy') }}</dt>
            <dd>{{ coverageText(evidence.coverage.byAccuracyBand, 'band') }}</dd>
          </div>
        </dl>
        <p v-if="evidence.encrypted" class="section-lead">{{ $t('location.encrypted') }}</p>
        <div v-if="showArea && canManage" class="project-area-panel">
          <p class="section-lead">{{ $t('location.areaHelp') }}</p>
          <analysis-map :data="noPoints" :project-id="projectId" can-edit @changed="reloadEvidence"/>
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

      <imagery-availability :project-id="projectId" :xml-form-id="xmlFormId" :can-check="canReview"/>
      <backcheck-sample :project-id="projectId" :xml-form-id="xmlFormId" :can-draw="canReview"
        @drawn="queueKey += 1"/>
      <contradiction-rules v-if="canReview" :project-id="projectId" :xml-form-id="xmlFormId"
        :can-manage="canManage"/>
      <identity-keys v-if="canReview" :project-id="projectId" :xml-form-id="xmlFormId"
        :can-manage="canManage"/>

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
          <span v-for="rule of lastRun.locationRules ?? []" :key="rule.rule" class="run-rule">
            {{ rule.ran
              ? $t('findings.locationRule', { name: $t(`ruleName.${rule.rule}`), version: rule.ruleVersion, concerns: $n(rule.concern ?? 0, 'default') })
              : $t('findings.locationRuleSkipped', { name: $t(`ruleName.${rule.rule}`) }) }}
          </span>
          <span v-for="rule of lastRun.contradictionRules ?? []" :key="rule.id" class="run-rule">
            {{ rule.status.usable
              ? $t('findings.contradictionRule', { title: rule.title, version: rule.version, matched: $n(rule.matched, 'default'), unknown: $n(rule.notEvaluated, 'default') })
              : $t('findings.contradictionRuleSkipped', { title: rule.title }) }}
          </span>
          <span v-for="key of lastRun.identityKeys ?? []" :key="key.id" class="run-rule">
            {{ key.status.usable
              ? $t('findings.identityKey', { title: key.title, version: key.version, reused: $n(key.reused, 'default'), inconsistent: $n(key.inconsistent, 'default'), noKey: $n(key.noKey, 'default') })
              : $t(`findings.identityKeySkipped.${key.status.reason === 'encrypted-form' || key.status.reason === 'too-many-submissions' ? key.status.reason : 'changed'}`, { title: key.title }) }}
          </span>
          <span v-if="lastRun.withdrawn > 0" class="run-rule">
            {{ $t('findings.withdrawnReport', { count: $n(lastRun.withdrawn, 'default') }) }}
          </span>
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
              <span class="finding-status">
                {{ ruleLabel(flag) }} · {{ $t(`status.${flag.status}`) }}
              </span>
            </div>

            <p class="finding-what">{{ describe(flag) }}</p>

            <dl v-if="flag.rule === 'implausible-travel' && flag.outcome === 'concern'" class="finding-evidence">
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

            <dl v-else-if="flag.rule === 'location-accuracy'" class="finding-evidence">
              <div>
                <dt>{{ $t('evidenceLabel.reportedAccuracy') }}</dt>
                <dd>{{ $t('evidenceLabel.metres', { m: $n(flag.evidence.reportedAccuracyM, 'default') }) }}</dd>
              </div>
              <div>
                <dt>{{ $t('evidenceLabel.threshold') }}</dt>
                <dd>{{ $t('evidenceLabel.metres', { m: $n(flag.evidence.thresholdM, 'default') }) }}</dd>
              </div>
            </dl>
            <dl v-else-if="flag.rule === 'outside-project-area' && flag.evidence.distanceOutsideM != null" class="finding-evidence">
              <div>
                <dt>{{ $t('evidenceLabel.outsideBy') }}</dt>
                <dd>{{ $t('evidenceLabel.metres', { m: $n(flag.evidence.distanceOutsideM, 'default') }) }}</dd>
              </div>
              <div>
                <dt>{{ $t('evidenceLabel.allowed') }}</dt>
                <dd>{{ $t(`evidenceLabel.tolerance.${flag.evidence.toleranceSource}`, { m: $n(flag.evidence.toleranceM, 'default') }) }}</dd>
              </div>
            </dl>
            <dl v-else-if="flag.rule === 'repeated-location' && flag.evidence.coordinates != null" class="finding-evidence">
              <div>
                <dt>{{ $t('evidenceLabel.coordinates') }}</dt>
                <dd>{{ flag.evidence.coordinates }}</dd>
              </div>
              <div>
                <dt>{{ $t('evidenceLabel.sameCollector') }}</dt>
                <dd>{{ $t(flag.evidence.sameSubmitter ? 'evidenceLabel.yes' : 'evidenceLabel.no') }}</dd>
              </div>
              <div>
                <dt>{{ $t('evidenceLabel.sameDevice') }}</dt>
                <dd>{{ $t(flag.evidence.sameDevice ? 'evidenceLabel.yes' : 'evidenceLabel.no') }}</dd>
              </div>
            </dl>

            <dl v-else-if="isContradiction(flag) && flag.evidence.conditions != null" class="finding-evidence finding-answers">
              <div v-for="(c, i) of flag.evidence.conditions" :key="i">
                <dt>{{ describeCondition(c) }}</dt>
                <dd>{{ answerText(c) }}</dd>
              </div>
            </dl>

            <template v-else-if="isIdentity(flag)">
              <p class="finding-subhead">{{ $t(flag.evidence.kind === 'reused'
                ? 'identity.reusedLead' : 'identity.inconsistentLead', {
                count: $n(flag.evidence.sharedBy ?? 2, 'default'),
                allowed: $n(flag.evidence.maxUses ?? 1, 'default')
              }) }}</p>
              <div class="identity-table-wrap">
                <table class="table identity-table">
                  <thead>
                    <tr>
                      <th>{{ $t('identity.submission') }}</th>
                      <th>{{ $t('identity.received') }}</th>
                      <th v-for="path of identityPaths(flag)" :key="path">{{ path }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row of identityRows(flag)" :key="row.instanceId">
                      <td>
                        {{ $t(row.instanceId === flag.instanceId ? 'identity.this' : 'identity.other') }}
                        <template v-if="row.xmlFormId"> ({{ row.xmlFormId }})</template>
                      </td>
                      <td>{{ row.receivedAt == null ? '' : new Date(row.receivedAt).toLocaleString() }}</td>
                      <template v-if="flag.answers?.[row.instanceId] != null">
                        <td v-for="path of identityPaths(flag)" :key="path">{{ flag.answers[row.instanceId][path] ?? $t('answers.blank') }}</td>
                      </template>
                      <td v-else :colspan="identityPaths(flag).length" class="identity-gone">{{ $t('identity.gone') }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>

            <p v-if="flag.outcome === 'withdrawn'" class="finding-next">{{ $t('findings.withdrawnNote') }}</p>

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
                :to="submissionPath(flag.relatedInstanceId, relatedForm(flag))">
                {{ $t(flag.rule === 'repeated-location' ? 'findings.openEarliest'
                  : isIdentity(flag) ? 'findings.openEarliestKey' : 'findings.openPrevious') }}
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
import { computed, defineAsyncComponent, reactive, ref, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';

import Loading from '../loading.vue';
import Spinner from '../spinner.vue';
import SubmissionReviewQueue from './review-queue.vue';
import ContradictionRules from './contradiction-rules.vue';
import IdentityKeys from './identity-keys.vue';
import ImageryAvailability from './imagery-availability.vue';
import BackcheckSample from './backcheck-sample.vue';
// The map and its library load only when a manager opens the project area panel.
const AnalysisMap = defineAsyncComponent(() => import('../field-data/analysis-map.vue'));
import { describeCondition } from '../../util/contradiction-rules';

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
const showArea = ref(false);
const noPoints = { type: 'FeatureCollection', features: [] };
const review = reactive({});

// Running a check and recording a decision both change the form's record of
// itself, so they take the permission that changes a form rather than the one
// that reads it.
const canReview = computed(() =>
  project.dataExists && project.permits('submission.update'));
// A drawn backcheck sample adds cases: the queue above is reloaded.
const queueKey = ref(0);
// Writing contradiction rules is project management.
const canManage = computed(() => project.dataExists && project.permits('project.update'));

const load = () => Promise.all([
  request({ method: 'GET', url: apiPaths.formEvidence(props.projectId, props.xmlFormId) })
    .then(({ data }) => { evidence.value = data; }),
  request({ method: 'GET', url: apiPaths.formIntegrity(props.projectId, props.xmlFormId) })
    .then(({ data }) => { flags.value = data; })
])
  .catch(noop)
  .finally(() => { loading.value = false; });
load();

// After the project area changes, the coverage above describes the old one.
const reloadEvidence = () => request({ method: 'GET', url: apiPaths.formEvidence(props.projectId, props.xmlFormId) })
  .then(({ data }) => { evidence.value = data; })
  .catch(noop);

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

const submissionPath = (instanceId, xmlFormId = props.xmlFormId) =>
  `/projects/${props.projectId}/forms/${encodeURIComponent(xmlFormId)}/submissions/${encodeURIComponent(instanceId)}`;
// An identity finding's related submission may be in another form (F2b).
const relatedForm = (flag) => (flag.evidence.others ?? []).find((o) => o.instanceId === flag.relatedInstanceId)?.xmlFormId ?? props.xmlFormId;

// A concern is not a status colour taken from the review palette by accident:
// it is a state, and it arrives with an icon and a word, never colour alone.
const outcomeIcon = (outcome) => {
  if (outcome === 'concern') return 'icon-exclamation-triangle';
  if (outcome === 'withdrawn') return 'icon-check-circle';
  return 'icon-question-circle';
};

// The travel rule's text is written here; the location rules (G1) carry their
// own explanation in the finding, written by the server with its numbers.
const describe = (flag) => {
  if (flag.rule !== 'implausible-travel' && flag.evidence.explanation != null)
    return flag.evidence.explanation;
  return flag.outcome === 'concern'
    ? t('describe.concern')
    : t(`describe.${flag.evidence.reason}`, t('describe.inconclusive'));
};

const isContradiction = (flag) => flag.rule.startsWith('contradiction:');
const isIdentity = (flag) => flag.rule.startsWith('identity-reused:') || flag.rule.startsWith('identity-inconsistent:');
const ruleLabel = (flag) => {
  if (isContradiction(flag)) return t('ruleName.contradiction', { title: flag.evidence.title ?? '' });
  if (isIdentity(flag)) return t(`ruleName.identity-${flag.evidence.kind}`, { title: flag.evidence.title ?? '' });
  return t(`ruleName.${flag.rule}`, flag.rule);
};
// Identity findings store no answers; the server reads them from the
// Submissions when the findings are listed (null for a deleted one).
const identityPaths = (flag) => (flag.evidence.kind === 'inconsistent'
  ? [...(flag.evidence.fields ?? []), ...(flag.evidence.differing ?? [])]
  : flag.evidence.fields ?? []);
const identityRows = (flag) => [flag.evidence.submission ?? { instanceId: flag.instanceId }, ...(flag.evidence.others ?? [])];
// What the Submission actually answered, beside each condition of the rule.
const answerText = (c) => {
  if (c.counted != null) {
    const compared = c.compareAnswer != null ? t('answers.compared', { answer: c.compareAnswer }) : '';
    return `${t('answers.counted', { count: c.counted })}${compared}`;
  }
  const answer = c.answer == null ? t('answers.blank') : c.answer;
  return c.compareAnswer != null ? `${answer}${t('answers.compared', { answer: c.compareAnswer })}` : answer;
};

// "3 inside · 1 outside · 2 not checked", in a fixed order, omitting zeros.
const COVERAGE_ORDER = {
  withinArea: ['inside', 'near-edge', 'outside', 'no-area-set', 'not-checked'],
  band: ['≤10', '≤30', '≤100', '>100', 'unknown', 'none']
};
const coverageText = (counts, kind) => COVERAGE_ORDER[kind]
  .filter((key) => counts[key] > 0)
  .map((key) => t(`location.${kind}.${key}`, { count: counts[key] }))
  .join(' · ');
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
      "openPrevious": "Open the previous one",
      "openEarliest": "Open the earliest with this location",
      // {name} is a rule name such as "Location accuracy".
      "locationRule": "{name} v{version}: {concerns} to look at.",
      "locationRuleSkipped": "{name}: not run.",
      // {title} is a contradiction rule's title.
      "contradictionRule": "Contradiction \"{title}\" v{version}: {matched} found, {unknown} could not be checked.",
      "contradictionRuleSkipped": "Contradiction \"{title}\": not run, the Form no longer has what it checks.",
      // {title} is an identity key's title.
      "identityKey": "Identity \"{title}\" v{version}: {reused} used too often, {inconsistent} with changed answers, {noKey} without a usable key.",
      "identityKeySkipped": {
        "changed": "Identity \"{title}\": not run, the Form no longer has what it uses.",
        "encrypted-form": "Identity \"{title}\": not run, the Form is encrypted.",
        "too-many-submissions": "Identity \"{title}\": not run, the Form has more Submissions than identity checks handle."
      },
      "openEarliestKey": "Open the earliest with this key",
      "withdrawnReport": "{count} earlier findings are no longer found and were withdrawn.",
      "withdrawnNote": "A later run no longer found this. It no longer holds up a review, and any decision recorded here is kept."
    },
    "outcome": {
      "concern": "Worth a look",
      "inconclusive": "Could not tell",
      "withdrawn": "No longer found"
    },
    "ruleName": {
      "implausible-travel": "Travel between Submissions",
      "location-accuracy": "Location accuracy",
      "outside-project-area": "Outside the project area",
      "repeated-location": "Repeated location",
      // {title} is the title a project manager gave the rule.
      "contradiction": "Contradiction: {title}",
      // {title} is the title a project manager gave the identity key.
      "identity-reused": "Repeated identity: {title}",
      "identity-inconsistent": "Changed details: {title}"
    },
    "identity": {
      // {count} Submissions share the key; {allowed} are allowed.
      "reusedLead": "{count} Submissions share this key; {allowed} allowed.",
      "inconsistentLead": "The same key appears with different answers to questions that should stay the same.",
      "submission": "Submission",
      "received": "Received",
      "this": "This one",
      "other": "Other",
      "gone": "Deleted or not available to you; answers not shown"
    },
    "answers": {
      "blank": "(blank)",
      // {count} is a number of repeat entries.
      "counted": "counted {count}",
      // {answer} is the other question's answer.
      "compared": " (compared with {answer})"
    },
    "location": {
      "area": "Project area",
      "areaUnusable": {
        "no-area-set": "Not set. Upload a boundary and mark it as the project area to check locations against it.",
        "remote-layer": "The chosen layer is a remote map and has no boundary to check against.",
        "no-polygon": "The chosen layer has no polygon.",
        "antimeridian": "The chosen boundary crosses the antimeridian, which is not supported.",
        "self-intersecting": "The chosen boundary crosses itself, so it cannot be checked against. Correct and upload it again."
      },
      "setArea": "Set project area",
      "closeArea": "Close",
      "areaHelp": "Upload the project boundary as GeoJSON (WGS84 polygons), then press “Use as project area” on it. Location checks flag readings outside it, after allowing for each reading's accuracy. Run the checks again afterwards.",
      "where": "Where readings fall",
      "accuracy": "Reported accuracy",
      "encrypted": "This Form is encrypted, so its locations cannot be read and the location checks do not run.",
      "withinArea": {
        "inside": "{count} inside",
        "near-edge": "{count} near the edge",
        "outside": "{count} outside",
        "no-area-set": "{count} not checked (no area)",
        "not-checked": "{count} without a location"
      },
      "band": {
        "≤10": "{count} within 10 m",
        "≤30": "{count} within 30 m",
        "≤100": "{count} within 100 m",
        ">100": "{count} worse than 100 m",
        "unknown": "{count} not reported",
        "none": "{count} without a location"
      }
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
      "speed": "{speed} km/h",
      "reportedAccuracy": "Reported accuracy",
      "threshold": "Limit",
      "metres": "{m} m",
      "outsideBy": "Outside by",
      "allowed": "Allowed for",
      "tolerance": {
        "reported-accuracy": "{m} m (reported accuracy)",
        "default-no-accuracy-reported": "{m} m (no accuracy reported)"
      },
      "coordinates": "Coordinates",
      "sameCollector": "Same collector",
      "sameDevice": "Same device",
      "yes": "Yes",
      "no": "No"
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

  .location-coverage {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 22px;
    margin: 0 0 14px;

    > * { border-bottom: none; padding-block: 0; }
    dt { color: $color-text-muted; font-size: 11px; font-weight: normal; letter-spacing: 0.05em; text-transform: uppercase; }
    dd { color: $color-text; font-size: 13px; margin: 2px 0 0; max-width: 60ch; }
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
    &.outcome-withdrawn { border-left-color: #d6d6e0; } // gradient --gray-200
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

  .identity-table-wrap { margin: 6px 0 8px; overflow-x: auto; }
  .identity-table { font-size: 13px; margin: 0; }
  .identity-gone { color: $color-text-muted; font-style: italic; }

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
