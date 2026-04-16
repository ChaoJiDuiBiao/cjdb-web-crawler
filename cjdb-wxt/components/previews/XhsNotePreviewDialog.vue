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

    <div class="option-section">
      <el-checkbox v-model="downloadMediaChecked">同时下载并上传图片 / 原视频</el-checkbox>
      <div v-if="!downloadMediaChecked" class="option-tip">关闭后 Notion/飞书仅用外链、本地 ZIP 也不打包图片与视频文件（默认开启）</div>
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
import { computed, ref, watch } from 'vue'
import type { XiaohongshuNote } from '@/types'

const props = defineProps<{
  modelValue: boolean
  data: XiaohongshuNote
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'confirm', value: { downloadImagesAndVideo: boolean }): void
  (e: 'close'): void
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
})

const downloadMediaChecked = ref(true)

watch(
  () => props.modelValue,
  (open) => {
    if (open) downloadMediaChecked.value = true
  }
)

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
  emit('confirm', { downloadImagesAndVideo: downloadMediaChecked.value })
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

.option-section {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid #ebeef5;
  font-size: 12px;
  color: #606266;
}

.option-tip {
  margin-top: 6px;
  font-size: 11px;
  color: #909399;
  line-height: 1.4;
}

</style>
