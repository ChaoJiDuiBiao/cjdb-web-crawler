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
import type { XiaohongshuAccount } from '@/types'

const props = defineProps<{
  modelValue: boolean
  data: XiaohongshuAccount
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
  const data = props.data || {} as XiaohongshuAccount
  const lines = [
    `昵称: ${data.nickname || '-'}`,
    `账号ID: ${data.userId || '-'}`,
    `归属地: ${data.location || '-'}`,
    `粉丝数: ${data.fansCount ?? '-'}`,
    `关注数: ${data.followingCount ?? '-'}`,
    `获赞数: ${data.likedCount ?? '-'}`,
    `笔记数: ${data.notesCount ?? '-'}`,
    `主页URL: ${data.url || '-'}`,
    `简介: ${(data.description || '-').slice(0, 200)}${(data.description?.length || 0) > 200 ? '...' : ''}`,
    '笔记列表:',
    data.noteListText || '-'
  ]
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
