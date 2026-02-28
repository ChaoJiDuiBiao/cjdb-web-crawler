<template>
  <div class="cjdb-panel">
    <!-- 存储配置按钮 -->
    <el-button
      circle
      size="small"
      :icon="Setting"
      @click="showStoreSelector = !showStoreSelector"
      class="store-btn">
    </el-button>

    <!-- 存储源选择下拉 -->
    <div v-if="showStoreSelector" class="store-selector">
      <div
        v-for="(store, index) in stores"
        :key="index"
        class="store-item"
        :class="{ active: index === currentStoreIndex }"
        @click="selectStore(index)">
        {{ getStoreLabel(store) }}
      </div>
      <div class="store-item-add" @click="showConfig = true">
        + 添加存储源
      </div>
    </div>


    <!-- 采集按钮 -->
    <el-button
      type="primary"
      :loading="collecting"
      :disabled="collecting"
      @click="handleCollect"
      class="collect-btn">
      {{ collectButtonText }}
    </el-button>
    <div v-if="tipMessage" class="tip-display tip-opacity-2">
      {{ tipMessage }}
    </div>

    <!-- 配置弹窗 -->
    <el-dialog v-model="showConfig" title="添加存储源" width="400px">
      <el-form>
        <el-form-item label="存储类型">
          <el-select
            v-model="configForm.type"
            popper-class="cjdb-store-select-popper"
            @change="handleTypeChange">
            <el-option label="本地" value="local" />
            <el-option label="Notion" value="notion" />
            <el-option label="飞书" value="feishu" />
          </el-select>
        </el-form-item>

        <template v-if="configForm.type === 'notion'">
          <el-form-item label="Token">
            <el-input v-model="configForm.token" type="password" />
          </el-form-item>
          <el-form-item label="Database ID">
            <el-input v-model="configForm.databaseId" />
          </el-form-item>
        </template>

        <template v-if="configForm.type === 'feishu'">
          <el-form-item label="App ID">
            <el-input v-model="configForm.appId" />
          </el-form-item>
          <el-form-item label="App Secret">
            <el-input v-model="configForm.appSecret" type="password" />
          </el-form-item>
          <el-form-item label="App Token">
            <el-input v-model="configForm.appToken" />
          </el-form-item>
          <el-form-item label="Table ID">
            <el-input v-model="configForm.tableId" />
          </el-form-item>
        </template>
      </el-form>

      <template #footer>
        <el-button @click="showConfig = false">取消</el-button>
        <el-button type="primary" @click="saveConfig">保存</el-button>
      </template>
    </el-dialog>

    <!-- 数据预览弹窗 -->
    <el-dialog
      v-model="showPreview"
      title="采集数据预览"
      width="520px"
      :close-on-click-modal="false"
      @close="handlePreviewClose">
      <div class="preview-content">
        <pre class="preview-json">{{ previewDataFormatted }}</pre>
      </div>
      <template #footer>
        <el-button @click="showPreview = false">取消</el-button>
        <el-button type="primary" :loading="collecting" @click="confirmAndSave">
          确认采集
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { Setting } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { storage } from 'wxt/utils/storage'
import type { StoreConfig, XiaohongshuNote, XiaohongshuAccount } from '@/types'

// 接收 crawler 作为 prop
const props = defineProps<{
  crawler: any
}>()

// 提示消息类型
interface TipItem {
  id: number
  message: string
  timer?: ReturnType<typeof setTimeout>
  key?: string  // 用于识别可更新的 tip
}

// 状态
const collecting = ref(false)
const tipMessage = ref<string | null>(null)
const showStoreSelector = ref(false)
const showConfig = ref(false)
const showPreview = ref(false)
const previewData = ref<XiaohongshuNote | XiaohongshuAccount | XiaohongshuNote[] | null>(null)
const previewCollectionType = ref<string>('')
const stores = ref<StoreConfig[]>([])
const currentStoreIndex = ref(0)
const configForm = ref<StoreConfig>({ type: 'local' })

// 计算勾选数量
const checkedCount = computed(() => {
  const state = props.crawler.getCrawlerState()
  return state.checked || 0
})

// 按数据类型格式化预览
function formatPreviewAccount(data: XiaohongshuAccount): string {
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
    `笔记列表: ${data.noteListText || '-'}`
  ]
  return lines.join('\n')
}

function formatPreviewFeed(data: XiaohongshuNote[]): string {
  const total = data.length
  const lines = [`共 ${total} 条笔记`, '---']
  data.slice(0, 20).forEach((item, i) => {
    lines.push(`${i + 1}. ${(item.title || '未知').slice(0, 40)} | ❤️${item.likes ?? 0}`)
  })
  if (total > 20) lines.push(`... 其余 ${total - 20} 条`)
  return lines.join('\n')
}

function formatPreviewNote(data: XiaohongshuNote): string {
  const lines = [
    `标题: ${(data.title || '-').slice(0, 80)}`,
    `URL: ${data.url || '-'}`,
    `作者: ${data.authorNickname || '-'} | 粉丝: ${data.authorFansCount ?? '-'} | 获赞: ${data.authorLikes ?? '-'}`,
    `发布时间: ${data.publishTimeStr || '-'} | 地点: ${data.location || '-'}`,
    `点赞: ${data.likes ?? '-'} | 收藏: ${data.favorites ?? '-'} | 评论: ${data.comments ?? '-'}`,
    `正文: ${(data.content || '-').slice(0, 300)}${(data.content?.length || 0) > 300 ? '...' : ''}`
  ]
  const commentCount = data.commentList?.length ?? 0
  if (commentCount > 0) {
    lines.push(`---\n评论 ${commentCount} 条`)
    data.commentList!.slice(0, 10).forEach((c, i) => {
      lines.push(`  ${i + 1}. ${(c.content || '').slice(0, 60)}${(c.content?.length || 0) > 60 ? '...' : ''}`)
    })
    if (commentCount > 10) lines.push(`  ... 其余 ${commentCount - 10} 条`)
  }
  return lines.join('\n')
}

const previewDataFormatted = computed(() => {
  const data = previewData.value
  const type = previewCollectionType.value
  if (!data) return ''
  try {
    if (Array.isArray(data)) return formatPreviewFeed(data as XiaohongshuNote[])
    if (data && typeof data === 'object' && 'userId' in data) return formatPreviewAccount(data as XiaohongshuAccount)
    return formatPreviewNote(data as XiaohongshuNote)
  } catch {
    return String(data)
  }
})

// 计算采集按钮文本
const collectButtonText = computed(() => {
  const state = props.crawler.getCrawlerState()
  const type = state.collectionType

  if (type === 'account') {
    return `采集账号${checkedCount.value > 0 ? ` (${checkedCount.value}条笔记)` : ''}`
  } else if (type === 'note') {
    return `采集笔记${checkedCount.value > 0 ? ` (${checkedCount.value})` : ''}`
  } else {
    return `采集${checkedCount.value > 0 ? ` (${checkedCount.value})` : ''}`
  }
})

// 加载存储配置
async function loadStores() {
  const saved = await storage.getItem('local:stores')
  stores.value = saved || [{ type: 'local', name: '本地存储' }]

  const index = await storage.getItem('local:currentStoreIndex')
  currentStoreIndex.value = index || 0
}

// 选择存储源
async function selectStore(index: number) {
  currentStoreIndex.value = index
  await storage.setItem('local:currentStoreIndex', index)
  showStoreSelector.value = false
}

// 获取存储源标签
function getStoreLabel(store: StoreConfig): string {
  if (store.type === 'local') return '本地存储'
  if (store.type === 'notion') return `Notion: ${store.databaseId?.slice(0, 8) || '...'}`
  if (store.type === 'feishu') return `飞书: ${store.tableId || '...'}`
  return store.name || store.type
}

// 类型变化时重置表单
function handleTypeChange() {
  configForm.value = { type: configForm.value.type }
}

// 保存配置
async function saveConfig() {
  stores.value.push({ ...configForm.value })
  await storage.setItem('local:stores', stores.value)
  showConfig.value = false
  configForm.value = { type: 'local' }
  ElMessage.success('配置已保存')
}

// 采集数据（先爬取，弹窗预览，用户确认后再保存）
async function handleCollect() {
  if (collecting.value) return
  collecting.value = true
  clearTipMessage()

  try {
    await nextTick()
    const data = await props.crawler.crawl({
      onProgress: (msg) => { tipsDisplay(msg, false) }
    })
    const state = props.crawler.getCrawlerState()
    const collectionType = state.collectionType

    clearTipMessage()
    previewData.value = data as XiaohongshuNote | XiaohongshuAccount | XiaohongshuNote[]
    previewCollectionType.value = collectionType
    showPreview.value = true
  } catch (e: any) {
    console.error('[CJDB] 采集失败', e)
    clearTipMessage()
    ElMessage.error('采集失败: ' + e.message)
  } finally {
    collecting.value = false
  }
}

// 预览弹窗确认后保存
async function confirmAndSave() {
  const data = previewData.value
  const collectionType = previewCollectionType.value
  if (!data) return

  collecting.value = true
  clearTipMessage()

  try {
    const currentStore = stores.value[currentStoreIndex.value]
    if (currentStore.type === 'notion') {
      if (collectionType === 'account') {
        await saveAccountToNotion(data as XiaohongshuAccount, currentStore)
      } else if (collectionType === 'note' && Array.isArray(data)) {
        await saveFeedToNotion(data as XiaohongshuNote[], currentStore)
      } else {
        await saveToNotion(data as XiaohongshuNote, currentStore)
      }
    } else if (currentStore.type === 'feishu') {
      await saveToLocal(data)
      ElMessage.warning('飞书存储暂未实现')
    } else {
      await saveToLocal(data)
    }

    showPreview.value = false
    clearTipMessage()

    if (collectionType === 'account') {
      ElMessage.success('已采集账号信息')
    } else if (Array.isArray(data)) {
      ElMessage.success(`已采集 ${data.length} 条笔记`)
    } else {
      ElMessage.success(`已采集 ${(data as XiaohongshuNote).commentList?.length || 0} 条评论`)
    }
  } catch (e: any) {
    console.error('[CJDB] 保存失败', e)
    ElMessage.error('保存失败: ' + e.message)
  } finally {
    collecting.value = false
    clearTipMessage()
  }
}

function handlePreviewClose() {
  previewData.value = null
  previewCollectionType.value = ''
}

// 保存笔记到 Notion（通过 Background Script）
async function saveToNotion(data: XiaohongshuNote, store: StoreConfig) {
  const response = await browser.runtime.sendMessage({
    type: 'cjdb-save-to-notion',
    payload: {
      collectionType: 'note',
      data,
      store
    }
  })

  if (!response.ok) {
    throw new Error(response.error || '保存失败')
  }
}

// 保存 Feed 笔记列表到 Notion（通过 Background Script）
async function saveFeedToNotion(dataList: XiaohongshuNote[], store: StoreConfig) {
  const response = await browser.runtime.sendMessage({
    type: 'cjdb-save-to-notion',
    payload: {
      collectionType: 'feed',
      data: dataList,
      store
    }
  })

  if (!response.ok) {
    throw new Error(response.error || '保存失败')
  }
}

// 保存账号到 Notion（通过 Background Script）
async function saveAccountToNotion(data: XiaohongshuAccount, store: StoreConfig) {
  const response = await browser.runtime.sendMessage({
    type: 'cjdb-save-to-notion',
    payload: {
      collectionType: 'account',
      data,
      store
    }
  })

  if (!response.ok) {
    throw new Error(response.error || '保存失败')
  }
}

// 保存到本地
async function saveToLocal(data: any) {
  const saved = await storage.getItem('local:collected') || []
  if (Array.isArray(data)) {
    saved.push(...data)
  } else {
    saved.push(data)
  }
  await storage.setItem('local:collected', saved)
}

// 监听状态变化
function setupListener() {
  window.addEventListener('cjdb-collection-changed', () => {
    // 强制更新 checkedCount
    props.crawler.getCrawlerState()
  })
}

// 暴露 tipsDisplay 到全局
function tipsDisplay(msg: string) {
  tipMessage.value = msg
}

function clearTipMessage(msg: string) {
  if (!msg) {
    tipMessage.value = null
    return
  }
  if (tipMessage.value === msg) {
    tipMessage.value = null
  }
}

onMounted(() => {
  loadStores()
  setupListener()

  // 挂载到 window，让 crawler/store 可以调用
  ;(window as any).CJDB_TipsDisplay = tipsDisplay
})
</script>

<style scoped lang="scss">
.cjdb-panel {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 99999;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
}

.store-btn {
  opacity: 0.7;
  &:hover {
    opacity: 1;
  }
}

.store-selector {
  padding: 8px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  min-width: 180px;
}

.store-item {
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.2s;

  &:hover {
    background: #f5f5f5;
  }

  &.active {
    background: #ecf5ff;
    color: #409eff;
    font-weight: 500;
  }
}

.store-item-add {
  padding: 10px 12px;
  margin-top: 6px;
  border-top: 1px solid #eee;
  cursor: pointer;
  font-size: 13px;
  color: #909399;

  &:hover {
    color: #409eff;
  }
}

.collect-btn {
  min-width: 80px;
  height: 80px;
  border-radius: 50%;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  padding: 0 16px;
}

.tip-container {
  position: absolute;
  bottom: 100%;
  right: 0;
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  pointer-events: none;
}

.tip-display {
  padding: 10px 18px;
  background: linear-gradient(135deg, rgba(64, 158, 255, 0.95), rgba(100, 180, 255, 0.95));
  border-radius: 24px;
  box-shadow: 0 4px 16px rgba(64, 158, 255, 0.3);
  font-size: 13px;
  color: #fff;
  font-weight: 500;
  white-space: nowrap;
  backdrop-filter: blur(8px);
  transition: opacity 0.3s ease;
}

/* 透明度：最旧20%（上）、第二50%（中）、最新100%（下） */
.tip-opacity-0 {
  opacity: 0.2;
}

.tip-opacity-1 {
  opacity: 0.5;
}

.tip-opacity-2 {
  opacity: 1;
}

/* 新 tip 从下方进入 */
.tip-slide-enter-active {
  transition: all 0.3s ease-out;
}

.tip-slide-leave-active {
  transition: all 0.4s ease-in;
}

.tip-slide-enter-from {
  opacity: 0;
  transform: translateY(20px) scale(0.9);
}

/* 旧 tip 向上消失 */
.tip-slide-leave-to {
  opacity: 0;
  transform: translateY(-30px) scale(0.8);
}

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

<!-- 非 scoped：el-select 下拉 teleport 到 body，需全局样式确保显示在弹窗之上 -->
<style lang="scss">
.cjdb-store-select-popper {
  z-index: 100001 !important;
}
</style>
