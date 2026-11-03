<template>
  <section id="collect-auto-send" aria-labelledby="collect-auto-send-title">
    <h2 id="collect-auto-send-title">Collect native auto-send</h2>
    <p>Configure ODK Collect to send finalized forms using its native upload queue, even when Fieldwork is closed. Collect controls retries and shows queued, failed and sent states.</p>
    <p>Collector {{ identity.name }} · {{ identity.projectName }}. Apply this code inside the intended existing Collect project's settings. Creating another project does not transfer its existing queued forms.</p>
    <label for="collect-send-policy">Collect upload network</label>
    <select id="collect-send-policy" v-model="policy">
      <option value="off">Manual send only</option>
      <option value="wifi_only">Automatically send on Wi-Fi</option>
      <option value="cellular_only">Automatically send on cellular data</option>
      <option value="wifi_and_cellular">Automatically send on Wi-Fi or cellular data</option>
    </select>
    <p>Sent forms stay on the device. Automatic uploads can use data and require available network access and an active App User key.</p>
    <label class="collect-consent"><input v-model="consent" type="checkbox"> I have checked the Collect project and collector. I understand this private QR contains my App User access key.</label>
    <button type="button" :disabled="!consent" @click="show">Show private Collect QR</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-if="settings" class="collect-private-qr">
      <collect-qr :settings="settings" :sensitive="true" error-correction-level="M" :cell-size="4"/>
      <p>Anyone with this image can use this App User key. Do not share it. For setup on the same phone, save the image privately and use Collect's QR image import; delete the saved image afterwards.</p>
      <p>The code hides after two minutes or when this page is hidden. Hiding it does not revoke the access key or delete saved images.</p>
      <button type="button" @click="hide">Hide private QR</button>
    </div>
    <p>Preparing this code does not confirm that Collect applied it. Confirm the settings in Collect and test a finalized form. Fieldwork cannot read the private Android queue; server receipts only show submissions already received.</p>
  </section>
</template>

<script setup>
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import CollectQr from '../collect-qr.vue';

const props = defineProps({ identity: { type: Object, required: true }, prepareSettings: { type: Function, required: true } });
const policy = ref('off');
const consent = ref(false);
const settings = shallowRef(null);
const error = ref('');
let timer;
const hide = () => { clearTimeout(timer); settings.value = null; consent.value = false; };
const show = () => {
  if (!consent.value) return;
  error.value = '';
  try { settings.value = props.prepareSettings(policy.value); clearTimeout(timer); timer = setTimeout(hide, 120000); } catch { hide(); error.value = 'Reconnect before preparing Collect settings.'; }
};
const visibility = () => { if (document.visibilityState !== 'visible') hide(); };
document.addEventListener('visibilitychange', visibility);
watch(policy, hide);
watch(consent, value => { if (!value && settings.value) hide(); });
onBeforeUnmount(() => { hide(); document.removeEventListener('visibilitychange', visibility); });
</script>

<style scoped>
#collect-auto-send { margin-block: 24px; padding: 16px; border: 1px solid #bbb; overflow-wrap: anywhere; }
select { display: block; max-width: 100%; margin-block: 8px 16px; }
.collect-consent { display: block; }
.collect-private-qr { padding-top: 20px; }
.collect-private-qr :deep(img) { max-width: 100%; height: auto; margin: 0; }
</style>
