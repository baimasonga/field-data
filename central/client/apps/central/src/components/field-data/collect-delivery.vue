<template>
  <section id="collect-delivery" aria-labelledby="collect-delivery-title">
    <h2 id="collect-delivery-title">Collect server delivery receipts</h2>
    <p>Check submissions received from your App User in this project. This lists your current submission versions for forms you can still collect, including closed forms.</p>
    <p>These are server records, not Collect's private device queue. An absent submission does not prove it is unsent. Attachment records do not verify stored bytes; use Collect instance handoff verification for exact XML and file checks.</p>
    <button type="button" :disabled="busy" @click="load(false)">Refresh Collect delivery receipts</button>
    <p v-if="busy" role="status">Checking server delivery records…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="checkedAt">Checked {{ checkedAt }}. This view is a point-in-time record; refresh to check again.</p>
    <p v-if="checkedAt && !items.length">No matching server receipts found.</p>
    <ol>
      <li v-for="item in items" :key="item.submissionDefId">
        <strong>{{ item.formName }}</strong> · {{ item.instanceId }}
        <p>XML received {{ item.receivedAt }}. Form {{ item.formState }}.</p>
        <p v-if="item.expectedFiles === 0">XML received; no files expected.</p>
        <p v-else-if="item.recordedFiles === item.expectedFiles">XML and all expected attachment records received ({{ item.recordedFiles }}/{{ item.expectedFiles }}). File bytes have not been verified by this view.</p>
        <p v-else>XML received; {{ item.expectedFiles - item.recordedFiles }} of {{ item.expectedFiles }} attachment records missing.</p>
        <p v-if="item.missingFiles.length">Missing files: {{ item.missingFiles.join(', ') }}<span v-if="item.expectedFiles - item.recordedFiles > item.missingFiles.length"> (first {{ item.missingFiles.length }} shown)</span>.</p>
      </li>
    </ol>
    <button v-if="nextCursor" type="button" :disabled="busy" @click="load(true)">Load more Collect delivery receipts</button>
  </section>
</template>

<script setup>
import { onBeforeUnmount, ref } from 'vue';

const props = defineProps({ identity: { type: Object, required: true }, fetchReceipts: { type: Function, required: true } });
const items = ref([]); const nextCursor = ref(null); const checkedAt = ref(''); const busy = ref(false); const error = ref('');
let generation = 0;
const load = async more => {
  if (busy.value) return;
  generation += 1; const current = generation;
  busy.value = true; error.value = '';
  if (!more) { items.value = []; checkedAt.value = ''; nextCursor.value = null; }
  try {
    const result = await props.fetchReceipts(more ? nextCursor.value : null);
    if (current !== generation) return;
    if (result.actorId !== props.identity.actorId || result.projectId !== props.identity.projectId) throw new Error('Collector changed');
    items.value = more ? [...items.value, ...result.items] : result.items;
    nextCursor.value = result.nextCursor; checkedAt.value = result.checkedAt;
  } catch { if (current === generation) error.value = 'Could not check server receipts. Reconnect if access changed, then retry.'; } finally { if (current === generation) busy.value = false; }
};
onBeforeUnmount(() => { generation += 1; });
</script>

<style scoped>
#collect-delivery { margin-block: 24px; padding: 16px; border: 1px solid #bbb; overflow-wrap: anywhere; }
li { margin-block: 16px; }
</style>
