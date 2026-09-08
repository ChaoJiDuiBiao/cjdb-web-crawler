<template>
  <button
    class="recent-source"
    :class="{ selected }"
    :aria-pressed="selected"
    :disabled="disabled"
    :title="[destination.name, destination.databaseName].filter(Boolean).join(' · ')"
    @click="emit('select')"
  >
    <strong>{{ destination.name }}</strong>
    <small
      >{{ destination.databaseName ? destination.databaseName + ' · ' : ''
      }}{{
        destination.fieldNames
          ? destination.fieldNames.length + ' 个字段'
          : destination.fieldCount !== undefined
            ? destination.fieldCount + ' 个字段（上次使用）'
            : '点击选择'
      }}</small
    >
  </button>
</template>
<script setup lang="ts">
import type { Destination } from '@/types/destination'
const props = defineProps<{ destination: Destination; selected: boolean; disabled: boolean }>()
const emit = defineEmits<{ select: [] }>()
</script>
<style scoped>
.recent-source {
  border: 1px solid var(--line);
  border-radius: 24px;
  background: var(--surface);
  padding: 8px 14px;
  text-align: left;
  max-width: min(260px, 100%);
  min-width: 0;
}
.recent-source strong,
.recent-source small {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.recent-source strong {
  font-size: 13px;
  font-weight: 500;
}
.recent-source small {
  color: var(--muted);
  font-size: 11px;
  margin-top: 2px;
}
.recent-source.selected {
  border-color: var(--accent);
  background: #fff0f3;
}
</style>
