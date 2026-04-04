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
      <el-checkbox v-model="downloadImagesChecked">
        下载并上传图片到 Notion（会明显变慢）
      </el-checkbox>
      <div v-if="!downloadImagesChecked" class="option-tip">
        未勾选时只保存图片 URL（external），不下载图片
      </div>
      <el-checkbox v-model="extraDataChecked">
        同时采集阅读量、点赞、分享等数据
      </el-checkbox>
      <el-checkbox v-model="extraPrincipalInfoChecked">
        同时采集公众号主体信息（公司名称、地区、认证等）
      </el-checkbox>
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
import type { WechatArticle } from '@/types'

const props = defineProps<{
  modelValue: boolean
  data: WechatArticle | WechatArticle[]
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'confirm', value: { downloadImages: boolean; extraData: boolean; extraPrincipalInfo: boolean }): void
  (e: 'close'): void
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
})

const downloadImagesChecked = ref(true)
const extraDataChecked = ref(false)
const extraPrincipalInfoChecked = ref(false)

watch(() => props.modelValue, (value) => {
  if (!value) return
  downloadImagesChecked.value = true
  extraDataChecked.value = false
  extraPrincipalInfoChecked.value = false
})

function formatSinglePreview(data: WechatArticle): string {
  const lines = [
    `标题: ${(data.title || '-').slice(0, 80)}`,
    `URL: ${data.url || '-'}`,
    `公众号: ${data.principalInfo?.nickname || '-'}`,
    `发布时间: ${data.publishTimeStr || '-'}`,
    `IP归属地: ${data.ipLocation || '-'}`,
    `阅读: ${data.read ?? '-'} | 拇指赞: ${data.zan ?? '-'} | 爱心赞: ${data.looking ?? '-'}`,
    `转发: ${data.shareNum ?? '-'} | 收藏: ${data.collectNum ?? '-'} | 评论: ${data.commentCount ?? '-'}`,
    `正文: ${(data.contentMarkdown || data.content || '-').slice(0, 300)}${((data.contentMarkdown || data.content)?.length || 0) > 300 ? '...' : ''}`
  ]
  return lines.join('\n')
}

function formatListPreview(data: WechatArticle[]): string {
  const total = data.length
  const mpNickname = data[0]?.principalInfo?.nickname || ''
  const lines = [
    `共 ${total} 篇文章${mpNickname ? ` | 公众号: ${mpNickname}` : ''}`,
    '---'
  ]

  data.slice(0, 20).forEach((item, i) => {
    lines.push(`${i + 1}. ${(item.title || '未知').slice(0, 50)} | 👁${item.read ?? 0} 💙${item.zan ?? 0} ❤️${item.looking ?? 0}`)
  })

  if (total > 20) lines.push(`... 其余 ${total - 20} 篇`)
  return lines.join('\n')
}

const previewText = computed(() => {
  if (Array.isArray(props.data)) return formatListPreview(props.data)
  return formatSinglePreview(props.data)
})

function handleConfirm() {
  emit('confirm', {
    downloadImages: downloadImagesChecked.value,
    extraData: extraDataChecked.value,
    extraPrincipalInfo: extraPrincipalInfoChecked.value
  })
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
  padding-top: 12px;
  border-top: 1px solid #ebeef5;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.option-section .el-checkbox {
  font-size: 13px;
}

.option-tip {
  font-size: 12px;
  color: #909399;
  margin-left: 2px;
}
</style>
