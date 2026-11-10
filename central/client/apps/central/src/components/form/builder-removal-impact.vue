<!-- Copyright 2026 Field Data Developers. Licensed under the Apache License, Version 2.0. -->
<template>
  <details v-if="impact.length" class="builder-removal-impact">
    <summary>Removal affects {{ impact.length }} expression reference{{ impact.length === 1 ? '' : 's' }}</summary>
    <p>Removing this question or group may leave these references unresolved. Review them before removal; references inside the removed group are excluded. Only explicit question references are checked.</p>
    <ul>
      <li v-for="(dependency, index) of impact" :key="index">
        <button type="button" class="btn btn-link" @click="$emit('focus-question', dependency.id)">{{ dependency.path }} · {{ dependency.field }}</button>
        refers to {{ dependency.reference }}
      </li>
    </ul>
  </details>
</template>
<script setup>
import { computed } from 'vue';
import { builderRemovalImpact } from '../../util/builder-diagnostics';

defineOptions({ name: 'BuilderRemovalImpact' });
const props = defineProps({ question: { type: Object, required: true }, dependencies: { type: Array, default: () => [] } });
defineEmits(['focus-question']);
const impact = computed(() => builderRemovalImpact(props.question, props.dependencies));
</script>
