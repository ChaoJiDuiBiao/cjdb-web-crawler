<template>
  <article class="database-card">
    <button
      class="cjdb-target"
      :class="{ selected }"
      :aria-pressed="selected"
      :aria-label="'数据源 ' + destination.name"
      :disabled="disabled"
      @click="emit('select')"
    >
      <span class="database-title"
        ><strong>{{ destination.name }}</strong>
        <small class="cjdb-muted"
          ><span v-if="destination.databaseName">{{ destination.databaseName }} · </span
          ><span v-if="disambiguate">ID …{{ destination.dataSourceId?.slice(-6) }} · </span
          ><span v-if="created">创建于 {{ date }} · </span
          >{{ fields === undefined ? '字段信息待查看' : fields + ' 个字段'
          }}<span v-if="rows !== undefined">
            · {{ cursor ? '至少 ' : '' }}{{ rows }} 行数据</span
          ></small
        > </span
      ><span aria-hidden="true">{{ selected ? '✓' : '○' }}</span>
    </button>
    <slot />
    <details class="database-meta">
      <summary>查看详情</summary>
      <a
        v-if="safeUrl(destination.url)"
        :href="safeUrl(destination.url)"
        target="_blank"
        rel="noopener noreferrer"
        >在 Notion 中核对</a
      >
      <p class="cjdb-muted">行数按需统计，不影响选择。</p>
      <span v-if="busy" role="status">读取中…</span>
      <span v-if="error" role="alert">{{ error }}</span>
      <button
        v-if="rows === undefined || cursor || error"
        class="cjdb-text"
        :disabled="busy"
        @click="read"
      >
        {{ error ? '重试读取信息' : cursor ? '继续统计行数' : '读取行数与信息' }}
      </button>
      <div v-if="names.length" class="database-fields" tabindex="0" aria-label="数据源字段列表">
        <span v-for="name in names" :key="name" class="cjdb-tag">{{ name }}</span>
      </div>
    </details>
  </article>
</template>
<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import type { Destination } from '@/types/destination'
import { safeUrl } from '@/utils/destinations'
import { service } from '@/utils/service'
const props = defineProps<{
  destination: Destination
  selected: boolean
  disabled: boolean
  disambiguate?: boolean
}>()
const emit = defineEmits<{ select: [] }>()
const busy = ref(false),
  error = ref('')
const created = ref(props.destination.createdAt || ''),
  fields = ref<number | undefined>(props.destination.fieldNames?.length),
  rows = ref<number>(),
  names = ref<string[]>(props.destination.fieldNames || []),
  cursor = ref<string | null>(null)
const date = computed(() =>
  created.value ? new Date(created.value).toLocaleDateString('zh-CN') : '待确认'
)
let disposed = false
async function read() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await service('targetStats', {
      destination: props.destination,
      cursor: cursor.value,
      metadata: fields.value === undefined
    })
    if (disposed) return
    if (result.fields) {
      names.value = result.fields
      fields.value = result.fields.length
      created.value = result.createdAt || ''
    }
    rows.value = (rows.value || 0) + result.rows
    cursor.value = result.cursor
  } catch {
    if (!disposed) error.value = '信息暂不可用，不影响选择数据源。'
  } finally {
    busy.value = false
  }
}
onBeforeUnmount(() => {
  disposed = true
})
</script>
<style scoped>
.database-card {
  border: 0;
  border-radius: 6px;
  min-width: 0;
  background: white;
}
.database-card .cjdb-target {
  width: 100%;
  border: 0;
  text-align: left;
  padding: 10px 12px;
  min-height: 48px;
  gap: 12px;
}
.database-title {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 14px;
}
.database-card strong {
  overflow-wrap: anywhere;
}
.database-card small {
  font-size: 12px;
  margin: 0;
}
.database-meta {
  padding: 0 16px 12px;
  font-size: 12px;
}
.database-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 140px;
  overflow: auto;
  padding: 8px 0;
  overscroll-behavior: contain;
}
</style>
