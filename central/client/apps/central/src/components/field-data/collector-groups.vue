<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.

Groups of collectors whose submissions keep matching (F5), from the pair
findings already recorded. A list of things to look into, not a score.
Contract: docs/field-intelligence/F5-collusion-groups.md -->
<template>
  <section class="collector-groups" aria-labelledby="collector-groups-title">
    <h2 id="collector-groups-title">Collectors whose submissions keep matching</h2>
    <p class="section-lead">
      Groups of collectors linked by repeated findings between their submissions: near-duplicate answers, a shared identity key or an identical location.
      A group is a reason to look at how these collectors worked, not a finding against anyone. It is also explained by collectors working the same
      households or area, sharing a device by arrangement, or a form that leaves little room for answers to differ.
      Findings explained in review do not count.
    </p>
    <form class="collector-groups-settings" @submit.prevent="load">
      <label>Connect collectors linked by at least
        <select v-model.number="minLinks" class="form-control" @change="load">
          <option v-for="n of OPTIONS" :key="n" :value="n">{{ n }} findings</option>
        </select>
      </label>
      <button type="submit" class="btn btn-default" :aria-disabled="busy">Refresh <spinner :state="busy"/></button>
    </form>
    <p v-if="error" role="alert" class="collector-groups-error">{{ error }}</p>

    <template v-if="result != null">
      <p v-if="result.groups.length === 0" class="collector-groups-empty">
        No collectors are linked by {{ result.minLinks }} or more findings between their submissions
        ({{ result.links }} {{ result.links === 1 ? 'finding links' : 'findings link' }} two different collectors in all).
      </p>
      <ol v-else class="collector-groups-list">
        <li v-for="(group, i) of result.groups" :key="i" class="collector-group">
          <p class="collector-group-head">
            <strong>{{ group.members.map((m) => name(m)).join(', ') }}</strong>
            · {{ group.findingsTotal }} linking findings · {{ group.forms.map((f) => f.formName).join(', ') }}
          </p>
          <button v-if="canInvestigate" type="button" class="btn btn-default btn-sm collector-group-investigate"
            @click="$emit('investigate', investigationOf(group))">
Open an investigation
</button>
          <ul class="collector-group-connections">
            <li v-for="c of group.connections" :key="`${c.a}-${c.b}`">
              {{ nameOf(group, c.a) }} and {{ nameOf(group, c.b) }}: {{ c.links }} ({{ ruleSummary(c.byRule) }})
            </li>
          </ul>
          <details class="collector-group-findings">
            <summary>
              Findings ({{ group.findingsShown }}<template v-if="group.findingsTotal > group.findingsShown"> of {{ group.findingsTotal }}</template>)
            </summary>
            <ul>
              <li v-for="f of group.findings" :key="f.id">
                {{ RULES[family(f.rule)] }}:
                <router-link :to="submissionPath(f.xmlFormId, f.instanceId)">{{ f.instanceId }}</router-link>
                and
                <router-link :to="submissionPath(f.relatedXmlFormId, f.relatedInstanceId)">{{ f.relatedInstanceId }}</router-link>
                · <router-link :to="`${formPath(f.xmlFormId)}/verification`">Verification</router-link>
              </li>
            </ul>
          </details>
        </li>
      </ol>
    </template>
  </section>
</template>

<script setup>
import { ref } from 'vue';

import Spinner from '../spinner.vue';
import useRequest from '../../composables/request';

defineOptions({ name: 'FieldDataCollectorGroups' });
const props = defineProps({
  projectId: { type: [String, Number], required: true },
  canInvestigate: { type: Boolean, default: false }
});
defineEmits(['investigate']);
const { request, awaitingResponse: busy } = useRequest();

const OPTIONS = [2, 3, 4, 5, 10];
const RULES = { 'near-duplicate': 'Near-duplicate answers', identity: 'Shared identity key', 'repeated-location': 'Identical location' };
const minLinks = ref(3); const result = ref(null); const error = ref('');

const load = () => {
  error.value = '';
  return request({ method: 'GET', url: `/v1/projects/${props.projectId}/findings/collectors?minLinks=${minLinks.value}`, alert: false })
    .then(({ data }) => {
      if (!Array.isArray(data?.groups)) throw new Error('Unexpected response');
      result.value = data;
    })
    .catch(() => { result.value = null; error.value = 'Collector groups could not be loaded. Try again.'; });
};
load();

const name = (m) => m.displayName ?? `Collector ${m.actorId}`;
const nameOf = (group, actorId) => {
  const member = group.members.find((m) => m.actorId === actorId);
  return member == null ? `Collector ${actorId}` : name(member);
};
// An investigation of a group starts with the group's listed findings.
const investigationOf = (group) => ({
  title: `Collectors ${group.members.map((m) => name(m)).join(', ')}`,
  findingIds: group.findings.map((f) => f.id), at: Date.now()
});
const family = (rule) => (rule.startsWith('identity-reused:') ? 'identity' : rule);
const ruleSummary = (byRule) => Object.entries(byRule).map(([k, n]) => `${n} ${RULES[k].toLowerCase()}`).join(', ');
const formPath = (xmlFormId) => `/projects/${props.projectId}/forms/${encodeURIComponent(xmlFormId)}`;
const submissionPath = (xmlFormId, instanceId) => `${formPath(xmlFormId)}/submissions/${encodeURIComponent(instanceId)}`;
</script>

<style lang="scss">
@import '../../assets/scss/variables';

.collector-groups {
  margin: 24px 0;
  overflow-wrap: anywhere;
  .collector-groups-settings { align-items: flex-end; display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px;
    label { display: flex; flex-direction: column; font-weight: normal; max-width: 280px; } }
  .collector-groups-empty { color: $color-text-secondary; }
  .collector-groups-error { color: $color-danger; }
  .collector-groups-list { padding-left: 20px; }
  .collector-group { margin-bottom: 12px; }
  .collector-group-investigate { margin: 4px 0; }
  .collector-group-connections, .collector-group-findings ul { margin: 4px 0; padding-left: 18px; }
}
</style>
