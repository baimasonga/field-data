<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <section id="fd-operations">
<h1>Operations</h1><p>Checks run every five minutes. An alert opens after the configured number of consecutive failures and closes after a successful check.</p>
    <button type="button" class="btn btn-default" :disabled="busy" @click="load">Refresh status</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="result">
      <p>Authenticated API: {{ apiLatency }} ms. Frontend static file: {{ frontendStatus }}.</p>
      <p v-if="!result.backupEncryptionConfigured" role="alert">Scheduled backup encryption is not configured. An operator must configure the backup passphrase before scheduled backups can run.</p>
      <p v-if="!result.checks.length">No monitoring samples yet. Allow five minutes for the first scheduled check.</p>
      <table class="table"><thead><tr><th>Service</th><th>Status</th><th>Latency</th><th>Last check</th><th>Details</th></tr></thead><tbody><tr v-for="check of result.checks" :key="check.name"><td>{{ check.name }}</td><td>{{ stale(check) ? 'Stale — monitoring unverified' : check.status }} {{ check.alert ? '(active alert)' : '' }}</td><td>{{ check.latencyMs == null ? '—' : `${check.latencyMs} ms` }}</td><td>{{ check.checkedAt }}</td><td>{{ check.detail }}</td></tr></tbody></table>
      <fieldset v-if="canConfigure">
<legend>Backup and alert policy</legend>
        <label>Responsible operator<input v-model="policy.operator" class="form-control" maxlength="255"></label>
        <label>Availability target (%)<input v-model.number="policy.availabilityTarget" class="form-control" type="number" min="90" max="100" step="0.01"></label>
        <label>Recovery time target (minutes)<input v-model.number="policy.recoveryMinutes" class="form-control" type="number" min="1" max="10080"></label>
        <label>Acceptable data loss (minutes)<input v-model.number="policy.dataLossMinutes" class="form-control" type="number" min="0" max="10080"></label>
        <p>Targets express the operator's plan; they are not measured guarantees.</p>
        <label><input v-model="policy.completeBackups" type="checkbox"> Include referenced object files and external attachments in encrypted recovery bundles</label>
        <label><input v-model="policy.scheduledBackups" type="checkbox"> Schedule daily encrypted database backups</label>
        <label>Daily hour (UTC)<input v-model.number="policy.backupHour" class="form-control" type="number" min="0" max="23"></label>
        <label>Retention days (keeps the latest successful backup)<input v-model.number="policy.retentionDays" class="form-control" type="number" min="7" max="365"></label>
        <label>Consecutive failures before alert<input v-model.number="policy.failAfter" class="form-control" type="number" min="1" max="10"></label>
        <label>Backup becomes stale after hours<input v-model.number="policy.staleHours" class="form-control" type="number" min="24" max="168"></label>
        <button type="button" class="btn btn-primary" :disabled="busy" @click="save">Save policy</button>
      </fieldset>
      <p>Database backups and object files have separate recovery requirements. Alerts and recoveries are recorded here; external delivery and human escalation must be configured by the operator.</p>
      <p>External alert delivery: {{ result.alertDeliveryEnabled ? 'Enabled' : 'Disabled' }}; endpoint {{ result.alertEndpointConfigured ? 'configured' : 'missing' }}.</p>
      <h2>Alerts and recoveries</h2><p v-if="!result.events.length">No recorded alert transitions.</p>
      <p v-for="event of result.events" :key="event.id">{{ event.createdAt }} · {{ event.name }} · {{ event.kind }} · {{ event.detail }} · {{ event.deliveredAt ? 'Delivered' : event.attempts >= 10 ? 'Delivery failed; operator action needed' : 'Not delivered' }}</p>
      <p v-if="notice" role="status">{{ notice }}</p>
    </template>
  </section>
</template>
<script setup>
import { computed, ref } from 'vue';
import useRequest from '../../composables/request';
import { useRequestData } from '../../request-data';

defineOptions({ name: 'FieldDataOperations' });
const { request } = useRequest(); const { currentUser } = useRequestData();
const canConfigure = computed(() => currentUser.can('config.set') === true);
const result = ref(null); const policy = ref({}); const busy = ref(false); const error = ref(''); const notice = ref(''); const apiLatency = ref(null); const frontendStatus = ref('unverified');
const stale = check => Date.now() - new Date(check.checkedAt).valueOf() > 600000;
const load = async () => {
  busy.value = true; error.value = ''; const start = performance.now();
  try {
    result.value = (await request({ method: 'GET', url: '/v1/field-data/operations', alert: false })).data; apiLatency.value = Math.round(performance.now() - start); policy.value = { ...result.value.policy };
    const staticStart = performance.now(); try { const response = await fetch('/version.txt', { cache: 'no-store', signal: AbortSignal.timeout(3000) }); frontendStatus.value = response.ok ? `${Math.round(performance.now() - staticStart)} ms` : 'failed'; } catch { frontendStatus.value = 'failed'; }
  } catch { error.value = 'Operations status could not be loaded. Check API access and connectivity.'; } finally { busy.value = false; }
};
const save = async () => { busy.value = true; try { await request({ method: 'PUT', url: '/v1/field-data/operations/policy', data: policy.value }); notice.value = 'Policy saved.'; } finally { busy.value = false; } };
load();
</script>
<style>#fd-operations label { display: block; max-width: 540px; margin: 12px 0; }</style>
