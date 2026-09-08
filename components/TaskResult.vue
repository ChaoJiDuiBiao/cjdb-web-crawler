<template>
  <section class="cjdb-stack" aria-live="polite">
    <h3>
      {{ busy ? '保存进行中' : task.stopped ? '已停止后续保存' : '本次采集结果' }}
    </h3>
    <p class="cjdb-muted">
      {{ task.destination }} · 成功 {{ count('success') }} · 失败 {{ count('failed') }} · 待处理
      {{ count('pending') }}
    </p>
    <div v-for="(item, i) in task.items" :key="i" class="cjdb-card">
      <strong>{{ item.title }}</strong
      ><span class="cjdb-tag" style="margin-left: 8px">{{ labels[item.status] }}</span>
      <p v-if="item.error" class="cjdb-error">{{ item.error }}</p>
      <p v-if="item.warning" class="cjdb-warning">{{ item.warning }}</p>
      <a
        v-if="safeUrl(item.url)"
        :href="safeUrl(item.url)"
        target="_blank"
        rel="noopener noreferrer"
        >打开保存结果</a
      ><button v-if="item.key" class="cjdb-btn" @click="openRecords">查看本地记录</button>
    </div>
    <button
      v-if="!busy && retryable && (count('failed') || count('pending'))"
      class="cjdb-btn primary"
      @click="$emit('retry')"
    >
      {{ count('pending') ? '继续未完成项' : '只重试失败项' }}
    </button>
    <p v-if="error" class="cjdb-error">{{ error }}</p>
  </section>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { service } from '@/utils/service'
import { safeUrl } from '@/utils/destinations'
import type { TaskRecord, TaskItem } from '@/types/destination'
const props = defineProps<{
  task: TaskRecord
  busy?: boolean
  retryable?: boolean
}>()
defineEmits<{ retry: [] }>()
const error = ref(''),
  labels = { success: '已保存', failed: '失败', pending: '待处理' }
const count = (status: TaskItem['status']) =>
  props.task.items.filter((i) => i.status === status).length
async function openRecords() {
  try {
    await service('openSettings', { section: 'records' })
  } catch (e: any) {
    error.value = e.message
  }
}
</script>
