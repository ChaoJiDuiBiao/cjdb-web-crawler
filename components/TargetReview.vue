<template>
  <section class="cjdb-stack cjdb-target-details">
    <div class="cjdb-row cjdb-between">
      <strong>{{ checked.destination.name }}</strong
      ><a
        v-if="safeUrl(checked.destination.url)"
        :href="safeUrl(checked.destination.url)"
        target="_blank"
        rel="noopener noreferrer"
        >在 Notion 中核对</a
      >
    </div>
    <p v-if="checked.conflicts.length" class="cjdb-error">
      字段不兼容，请选择其他数据库或先调整字段：{{ checked.conflicts.join('；') }}
    </p>
    <template v-else
      ><p v-if="conflict" class="cjdb-warning">
        这个表已经用来存储{{
          checked.usedFor.map((t) => collectionLabels[t]).join('、')
        }}，当前采集的是{{ collectionLabels[type] }}。建议切换数据库。
      </p>
      <label v-if="conflict" class="cjdb-row"
        ><input
          v-model="allowMixed"
          type="checkbox"
          @change="emit('invalidate')"
        />我知道用途不同，仍使用这个表</label
      >
      <p v-if="checked.missing.length" class="cjdb-muted">
        保存时将补充 {{ checked.missing.length }} 个所需字段，已有字段名称会保留。
      </p>
      <div v-if="conflict" class="cjdb-actions">
        <button
          class="cjdb-btn primary"
          :disabled="checking || (conflict && !allowMixed)"
          @click="emit('confirm', checked.destination)"
        >
          仍使用此数据源
        </button>
      </div></template
    >
  </section>
</template>
<script setup lang="ts">
import { ref, computed } from 'vue'
import { safeUrl, purposeConflict, collectionLabels } from '@/utils/destinations'
import type { CollectionType } from '@/types'
import type { TargetCheck, Destination } from '@/types/destination'
const props = defineProps<{ checked: TargetCheck; type: CollectionType; checking: boolean }>()
const emit = defineEmits<{ confirm: [destination: Destination]; invalidate: [] }>()
const allowMixed = ref(false)
const conflict = computed(() => purposeConflict(props.checked.usedFor, props.type))
</script>
<style scoped>
.cjdb-target-details {
  padding: 10px 12px;
  gap: 8px;
  background: var(--surface);
  font-size: 12px;
}
</style>
