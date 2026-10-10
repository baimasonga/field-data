<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0.

Identity keys (F2) for one Form. Reviewers see the keys; project managers write
them. A key names the questions that identify a household or respondent, and
must say at least one ordinary reason the same key could appear again. -->
<template>
  <section class="identity-keys" aria-labelledby="identity-keys-title">
    <h2 id="identity-keys-title">Identity keys</h2>
    <p class="section-lead">An identity key names the questions that identify a household, respondent or phone. Running the checks finds a key used more often than allowed, or used again with answers that should not have changed. Placeholders such as “none” or “0000000” are skipped. Collectors never see these keys.</p>
    <p v-if="error" role="alert" class="key-error">{{ error }}</p>
    <p v-if="loaded && keys.length === 0 && editing == null">No identity keys yet.</p>

    <ul class="key-list">
      <li v-for="key of keys" :key="key.id" class="key" :class="{ inactive: !key.active }">
        <div class="key-head">
          <strong>{{ key.title }}</strong>
          <span class="key-meta">v{{ key.version }}{{ key.active ? '' : ' · inactive' }}</span>
        </div>
        <p class="key-description">{{ describeKey(key) }}</p>
        <p v-if="!key.status.usable" class="key-unusable">
          Not run: the current Form version no longer has {{ key.status.missing?.length ? key.status.missing.join(', ') : 'what this key uses' }}. Edit the key to match the Form.
        </p>
        <div v-if="canManage" class="key-actions">
          <button type="button" class="btn btn-default btn-sm" :disabled="busy" @click="edit(key)">Edit</button>
          <button v-if="key.active" type="button" class="btn btn-default btn-sm" :disabled="busy" @click="deactivate(key)">Deactivate</button>
        </div>
      </li>
    </ul>

    <button v-if="canManage && editing == null" type="button" class="btn btn-default" :disabled="busy || !loaded" @click="edit(null)">New identity key</button>

    <form v-if="editing != null" class="key-editor" @submit.prevent="save">
      <h3>{{ editing.id == null ? 'New identity key' : 'Edit identity key' }}</h3>
      <label>Title <input v-model="editing.title" class="form-control" maxlength="120" required></label>

      <fieldset>
        <legend>The key: questions that together identify one household or person</legend>
        <p v-if="candidates.key.length === 0" class="key-hint">This Form has no text, number or single-choice question outside a repeat to use as a key.</p>
        <div v-for="(row, i) of editing.fields" :key="i" class="key-field">
          <label>Question
            <select v-model="row.field" class="form-control" :aria-label="`Key question ${i + 1}`" required>
              <option value="" disabled>Choose a question</option>
              <option v-for="f of candidates.key" :key="f.path" :value="f.path">{{ f.path }}</option>
            </select>
          </label>
          <label>Match
            <select v-model="row.match" class="form-control" :aria-label="`Key question ${i + 1} match`">
              <option value="exact">Same text (ignoring case and spaces)</option>
              <option value="digits">Same digits (phone numbers, IDs typed with dashes)</option>
            </select>
          </label>
          <button v-if="editing.fields.length > 1" type="button" class="btn btn-link" @click="editing.fields.splice(i, 1)">Remove</button>
        </div>
        <button v-if="editing.fields.length < 3" type="button" class="btn btn-default btn-sm" @click="editing.fields.push({ field: '', match: 'exact' })">Add question to the key</button>
      </fieldset>

      <div class="key-numbers">
        <label>Submissions allowed per key
          <input v-model="editing.maxUses" class="form-control" type="number" min="1" max="1000" required>
        </label>
        <label>Only within this many days (blank: any time)
          <input v-model="editing.windowDays" class="form-control" type="number" min="1" max="3650">
        </label>
        <label>Ignore keys shorter than
          <input v-model="editing.minLength" class="form-control" type="number" min="1" max="50" required>
        </label>
      </div>
      <p class="key-hint">Use more than 1 for panel or follow-up surveys collected on this Form. Days are counted between the times Submissions were received.</p>

      <fieldset>
        <legend>Answers that should stay the same when the key appears again (optional)</legend>
        <label v-for="f of candidates.same.filter((q) => !editing.fields.some((r) => r.field === q.path))" :key="f.path" class="checkbox-label">
          <input v-model="editing.sameFields" type="checkbox" :value="f.path" :disabled="!editing.sameFields.includes(f.path) && editing.sameFields.length >= 10"> {{ f.path }}
        </label>
      </fieldset>

      <label>Placeholder values that are never an identity (one per line)
        <textarea v-model="editing.ignore" class="form-control" rows="3"></textarea>
      </label>
      <label>Why a repeated key matters <textarea v-model="editing.explanation" class="form-control" rows="2" maxlength="2000" required></textarea></label>
      <label>Ordinary reasons the same key could appear again (one per line, at least one)
        <textarea v-model="editing.benign" class="form-control" rows="3" required></textarea>
      </label>
      <label>What a reviewer should do <input v-model="editing.nextStep" class="form-control" maxlength="1000" required></label>
      <div class="key-actions">
        <button type="submit" class="btn btn-primary" :disabled="busy">Save key</button>
        <button type="button" class="btn btn-default" :disabled="busy" @click="editing = null">Cancel</button>
      </div>
    </form>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue';
import useRequest from '../../composables/request';
import { blankKey, describeKey, fromEditor, keyQuestions, sameQuestions, toEditor } from '../../util/identity-keys';

defineOptions({ name: 'IdentityKeys' });
const props = defineProps({
  projectId: { type: String, required: true },
  xmlFormId: { type: String, required: true },
  canManage: Boolean
});
const emit = defineEmits(['changed']);
const { request } = useRequest();
const base = () => `/v1/projects/${props.projectId}/forms/${encodeURIComponent(props.xmlFormId)}`;

const keys = ref([]); const fields = ref([]); const loaded = ref(false); const busy = ref(false);
const error = ref(''); const editing = ref(null);
const candidates = computed(() => ({ key: keyQuestions(fields.value), same: sameQuestions(fields.value) }));

const load = async () => {
  try {
    const [k, f] = await Promise.all([
      request({ method: 'GET', url: `${base()}/identity-keys`, alert: false }),
      request({ method: 'GET', url: `${base()}/fields`, alert: false })
    ]);
    keys.value = k.data; fields.value = f.data; loaded.value = true;
  } catch (e) {
    error.value = e.response?.data?.message || 'The identity keys could not be loaded.';
  }
};
load();

const edit = (key) => {
  error.value = '';
  editing.value = key == null ? blankKey() : toEditor(key);
};

const save = async () => {
  const e = editing.value;
  const data = fromEditor(e);
  busy.value = true; error.value = '';
  try {
    await (e.id == null
      ? request({ method: 'POST', url: `${base()}/identity-keys`, data, alert: false })
      : request({ method: 'PUT', url: `${base()}/identity-keys/${e.id}`, headers: { 'If-Match': `"key-${e.revision}"` }, data, alert: false }));
    editing.value = null; await load(); emit('changed');
  } catch (err) {
    const message = err.response?.data?.message || 'The identity key could not be saved.';
    // Reload the key another manager changed; the editor keeps this person's draft.
    if (err.response?.status === 412) await load();
    error.value = message;
  } finally { busy.value = false; }
};

const deactivate = async (key) => {
  busy.value = true; error.value = '';
  try {
    await request({ method: 'DELETE', url: `${base()}/identity-keys/${key.id}`, headers: { 'If-Match': `"key-${key.revision}"` }, alert: false });
    await load(); emit('changed');
  } catch (err) {
    error.value = err.response?.data?.message || 'The identity key could not be deactivated.';
  } finally { busy.value = false; }
};
</script>

<style lang="scss">
@import '../../assets/scss/variables';

.identity-keys {
  margin: 0 0 34px;
  overflow-wrap: anywhere;

  .key-list { list-style: none; margin: 0 0 12px; padding: 0; }
  .key { border: 1px solid #e9e9f1; border-radius: 6px; margin-bottom: 10px; padding: 12px 14px; }
  .key.inactive { border-style: dashed; }
  .key-head { display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; }
  .key-meta { color: $color-text-muted; font-size: 12px; }
  .key-description { color: $color-text-secondary; font-size: 13px; margin: 6px 0; }
  .key-unusable { color: #a86f14; font-size: 13px; margin: 6px 0; }
  .key-error { color: #b42318; }
  .key-hint { color: $color-text-secondary; font-size: 12px; }
  .key-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .key-editor {
    border-top: 1px solid #e9e9f1; margin-top: 12px; padding-top: 12px;
    label { display: block; font-weight: normal; margin: 8px 0; }
    fieldset { min-width: 0; }
    .checkbox-label { display: flex; gap: 6px; align-items: center; margin: 4px 0; }
  }
  .key-field { border-left: 3px solid #e9e9f1; display: flex; flex-wrap: wrap; gap: 0 12px; margin: 10px 0; padding-left: 10px; label { flex: 1 1 200px; } }
  .key-numbers { display: flex; flex-wrap: wrap; gap: 0 12px; label { flex: 1 1 180px; } }
}
</style>
