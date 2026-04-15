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
  data: XiaohongshuNote
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
  const data = props.data || {}
  const lines = [
    `标题: ${(data.title || '-').slice(0, 80)}`,
    `URL: ${data.url || '-'}`,
    `封面: ${data.coverUrl || '-'}`,
    `视频: ${data.videoUrl || '-'}`,
    `作者: ${data.authorNickname || '-'} | 粉丝: ${data.authorFansCount ?? '-'} | 获赞: ${data.authorLikes ?? '-'}`,
    `发布时间: ${data.publishTimeStr || '-'} | 地点: ${data.location || '-'}`,
    `点赞: ${data.likes ?? '-'} | 收藏: ${data.favorites ?? '-'} | 评论: ${data.comments ?? '-'}`,
    `正文: ${(data.content || '-').slice(0, 300)}${(data.content?.length || 0) > 300 ? '...' : ''}`
  ]

  const commentCount = data.commentList?.length ?? 0
  if (commentCount > 0) {
    lines.push(`---\n评论 ${commentCount} 条`)
    data.commentList!.slice(0, 10).forEach((c, i) => {
      const text = (c.comment || '').slice(0, 60)
      lines.push(`  ${i + 1}. ${text}${(c.comment?.length || 0) > 60 ? '...' : ''}`)
    })
    if (commentCount > 10) lines.push(`  ... 其余 ${commentCount - 10} 条`)
  }

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
