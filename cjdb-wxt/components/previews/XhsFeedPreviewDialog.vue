<template>
  <el-dialog
    v-model="visible"
    title="采集数据预览"
    width="520px"
    :close-on-click-modal="false"
    @close="handleClose">
    <div class="preview-content">
      <pre class="preview-json">{{ previewText }}</pre>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="loading" @click="handleConfirm">
        确认采集
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { XiaohongshuNote } from '@/types'

const props = defineProps<{
  modelValue: boolean
  data: XiaohongshuNote[]
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'confirm', value: Record<string, never>): void
  (e: 'close'): void
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
})

const previewText = computed(() => {
  const data = props.data || []
  const total = data.length
  const keyword = data.find((item) => item.searchKeyword)?.searchKeyword || '-'
  const lines = [`关键词: ${keyword}`, `共 ${total} 条结果`, '---']

  data.slice(0, 20).forEach((item, i) => {
    lines.push(
      `${i + 1}. ${(item.title || '未知').slice(0, 40)} | ${item.likes ?? 0} | ${item.publishTimeStr || '-'} | ${item.authorNickname || '-'}`
    )
  })

  if (total > 20) lines.push(`... 其余 ${total - 20} 条`)
  return lines.join('\n')
})

function handleConfirm() {
  emit('confirm', {})
}

function handleClose() {
  emit('close')
}
</script>

<style scoped>
.preview-content {
  max-height: 360px;
  overflow: auto;
  background: #f8f9fa;
  border-radius: 8px;
  padding: 12px;
}

.preview-json {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: #333;
  white-space: pre-wrap;
  word-break: break-all;
}

</style>
