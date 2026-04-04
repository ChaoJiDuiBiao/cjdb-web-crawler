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
import type { FeishuDoc } from '@/types'

const props = defineProps<{
  modelValue: boolean
  data: FeishuDoc
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'confirm', value: {}): void
  (e: 'close'): void
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
})

const previewText = computed(() => {
  const data = props.data
  const body = (data.contentMarkdown || data.content || '-').slice(0, 500)
  const bodySuffix = ((data.contentMarkdown || data.content)?.length || 0) > 500 ? '...' : ''
  return [
    `标题: ${(data.title || '-').slice(0, 120)}`,
    `URL: ${data.url || '-'}`,
    `类型: ${data.docType || '-'}`,
    `空间: ${data.workspace || '-'}`,
    `摘要: ${data.excerpt || '-'}`,
    `正文: ${body}${bodySuffix}`
  ].join('\n')
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
