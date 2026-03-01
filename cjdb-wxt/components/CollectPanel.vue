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
        v-for="(store, index) in storesList"
        :key="index"
        class="store-item"
        :class="{ active: store.is_selected }"
        @click="selectStore(index)">
        <span class="store-item-label">{{ storeConfig.getStoreLabel(store as Store) }}</span>
        <el-dropdown
          trigger="click"
          placement="bottom-end"
          @click.stop
          popper-class="cjdb-store-menu-popper">
          <span class="store-item-menu" @click.stop>
            <el-icon><MoreFilled /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="editStoreAt(index)">
                <el-icon><EditPen /></el-icon>
                编辑
              </el-dropdown-item>
              <el-dropdown-item @click="removeStoreAt(index)" divided>
                <el-icon><Delete /></el-icon>
                删除
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
      <div class="store-item-add" @click="openAddConfig">
        + 添加存储源
      </div>
    </div>


    <!-- 公众号：当前文章 | 历史文章 -->
    <div v-if="showWechatArticleSourceSelector" class="mode-selector">
      <span
        class="mode-item"
        :class="{ active: wechatArticleSource === 'current', disabled: isWechatHistoryCrawler }"
        @click="!isWechatHistoryCrawler && (wechatArticleSource = 'current')">
        当前文章
      </span>
      <span
        class="mode-item"
        :class="{ active: wechatArticleSource === 'history' }"
        @click="openHistoryDialog">
        历史文章
      </span>
    </div>

    <!-- 采集按钮：采集大字 + 下方小字类型 -->
    <el-button
      :type="collecting ? 'warning' : 'primary'"
      :loading="collecting"
      :disabled="collecting"
      @click="handleCollect"
      :class="['collect-btn', { 'collect-btn-busy': collecting }]">
      <template v-if="collecting">
        {{ collectingPhaseText }}
      </template>
      <template v-else>
        <div class="collect-btn-inner">
          <div class="collect-btn-main">采集</div>
          <div class="collect-btn-type">{{ collectTypeText }}</div>
        </div>
      </template>
    </el-button>
    <div v-if="tipMessage" class="tip-display tip-opacity-2">
      {{ tipMessage }}
    </div>

    <!-- 配置弹窗：与小红书共用同一套 STORE_SCHEMA，不 append-to-body 避免公众号页面 CSS 污染 -->
    <el-dialog
      v-model="showConfig"
      :title="editingStoreIdx === null ? '添加存储源' : '编辑存储源'"
      width="400px"
      class="cjdb-config-dialog">
      <el-form label-position="top">
        <el-form-item label="存储类型">
          <el-select
            v-model="configForm.type"
            popper-class="cjdb-store-select-popper"
            :disabled="editingStoreIdx !== null"
            @change="handleTypeChange">
            <el-option
              v-for="storeType in [StoreType.Local, StoreType.Notion, StoreType.Feishu]"
              :key="storeType"
              :label="STORE_SCHEMA[storeType]?.label ?? storeType"
              :value="storeType"
              :disabled="STORE_SCHEMA[storeType]?.disabled" />
          </el-select>
        </el-form-item>

        <el-form-item
          v-for="field in STORE_SCHEMA[configForm.type as StoreType]?.fields ?? []"
          :key="field.key"
          :label="field.label">
          <el-input
            v-model="configForm[field.key]"
            :type="field.inputType || 'text'" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="closeConfig">取消</el-button>
        <el-button type="primary" @click="saveConfig">{{ editingStoreIdx === null ? '保存' : '保存修改' }}</el-button>
      </template>
    </el-dialog>

    <!-- 数据库备注弹窗：用 el-dialog 替代 ElMessageBox 以便控制层级 -->
    <el-dialog
      v-model="showRemarkDialog"
      title="数据库备注"
      width="380px"
      class="cjdb-remark-dialog"
      :close-on-click-modal="false"
      @close="handleRemarkDialogClose">
      <el-input
        v-model="remarkInputValue"
        placeholder="如：小红书笔记库"
        clearable
        @keyup.enter="confirmRemark" />
      <template #footer>
        <el-button @click="skipRemark">跳过</el-button>
        <el-button type="primary" @click="confirmRemark">保存</el-button>
      </template>
    </el-dialog>

    <!-- 公众号历史文章：输入名称 + 选择列表 -->
    <el-dialog
      v-model="showHistoryDialog"
      title="公众号历史文章采集"
      width="680px"
      :close-on-click-modal="false"
      @close="closeHistoryDialog">
      <!-- 公众号名称输入框：始终显示 -->
      <div class="history-account-input">
        <el-form-item label="公众号名称">
          <div class="history-input-row">
            <el-input
              v-model="historyAccountName"
              placeholder="请输入公众号名称，或点击右侧自动识别"
              clearable
              :disabled="historyStep === 'select'" />
            <el-button
              v-if="historyStep === 'input'"
              type="primary"
              :loading="historyLoading"
              @click="loadHistoryByUrl">
              自动识别
            </el-button>
            <el-button
              v-if="historyStep === 'select'"
              type="default"
              @click="backToInput">
              重新输入
            </el-button>
          </div>
        </el-form-item>
      </div>

      <div v-if="historyStep === 'input'" class="history-input-step">
        <el-button type="primary" :loading="historyLoading" :disabled="!historyAccountName.trim()" @click="loadHistoryList">
          加载历史列表
        </el-button>
      </div>
      <div v-else-if="historyStep === 'select'" class="history-select-step">
        <div class="history-list-header">
          <span>共 {{ historyItems.length }} 篇，已选 {{ historySelectedCount }} 篇</span>
          <el-dropdown trigger="click" @command="handleSelectCommand" popper-class="cjdb-history-select-dropdown">
            <el-button link type="primary">
              {{ allSelected ? '取消全选' : '全选' }}
              <el-icon class="el-icon--right"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="all">所有历史</el-dropdown-item>
                <el-dropdown-item command="uncollected">所有未收录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <div class="history-table-wrapper">
          <table class="history-table">
            <thead>
              <tr>
                <th style="width: 40px;"></th>
                <th style="width: 50%;">标题</th>
                <th style="width: 120px;">发布时间</th>
                <th style="width: 80px; text-align: center;">已收录</th>
                <th style="width: 80px; text-align: center;">采集数据</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(item, i) in historyItems"
                :key="item.url"
                class="history-row"
                :class="{ checked: historySelected.has(item.url), disabled: item.collected }"
                @click="!item.collected && toggleHistoryItem(item)">
                <td>
                  <span class="history-checkbox">{{ historySelected.has(item.url) ? '✓' : '○' }}</span>
                </td>
                <td class="history-title">{{ item.title || '无标题' }}</td>
                <td class="history-date">{{ item.post_time_str || '' }}</td>
                <td style="text-align: center;">
                  <el-checkbox v-model="item.collected" disabled />
                </td>
                <td style="text-align: center;" @click.stop>
                  <el-checkbox
                    v-model="item.fetchData"
                    :disabled="!historySelected.has(item.url) || item.collected" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <el-button
          v-if="historyPage < historyTotalPage"
          link
          type="primary"
          :loading="historyLoadingMore"
          @click="loadHistoryNextPage">
          加载下一页 ({{ historyPage }}/{{ historyTotalPage }})
        </el-button>
        <el-button type="primary" :loading="collecting" :disabled="historySelectedCount === 0" @click="confirmHistoryCollect">
          采集选中 ({{ historySelectedCount }})
        </el-button>
      </div>
    </el-dialog>

    <!-- 大加辣 API Key 配置弹窗（历史数据、文章数据接口需此 Key） -->
    <el-dialog
      v-model="showDajialaKeyDialog"
      title="配置大加辣 API Key"
      width="420px"
      :close-on-click-modal="false"
      @close="closeDajialaKeyDialog">
      <p class="dajiala-key-hint">历史数据、文章数据（阅读/点赞等）接口需要配置 API Key</p>
      <el-input
        v-model="dajialaKeyInput"
        type="password"
        placeholder="如：JZL2446596c08cb8fb2"
        show-password
        clearable
        @keyup.enter="saveDajialaKeyAndClose" />
      <template #footer>
        <el-button @click="closeDajialaKeyDialog">取消</el-button>
        <el-button type="primary" @click="saveDajialaKeyAndClose">保存</el-button>
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
      <!-- 公众号额外数据：可选勾选，勾选后需配置 API Key 并拉取 -->
      <div v-if="previewCollectionType === CollectionType.WechatArticle" class="extra-data-section">
        <el-checkbox v-model="extraDataChecked">
          同时采集阅读量、点赞、分享等数据
        </el-checkbox>
        <el-checkbox v-model="extraPrincipalInfoChecked">
          同时采集公众号主体信息（公司名称、地区、认证等）
        </el-checkbox>
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
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { Setting, EditPen, Delete, MoreFilled, ArrowDown } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { storeCrawlData } from '@/stores/Store'
import { storeConfig, STORE_SCHEMA } from '@/config/StoreConfig'
import { getDajialaApiKey, setDajialaApiKey, augmentWechatArticlesWithApiData, augmentWechatArticlesWithPrincipalInfo, augmentWechatArticlesWithContent, fetchPrincipalInfo } from '@/utils/dajialaApi'
import { CollectionType, StoreType } from '@/types'
import type { Store, XiaohongshuNote, XiaohongshuAccount, WechatArticle, WechatHistoryItem } from '@/types'

// 接收 crawlers 数组（同页可多 Crawler，如公众号 内容|数据）
const props = defineProps<{
  crawlers: any[]
  /** 公众号历史爬虫（文章页时不在 crawlers 中，需单独传入以支持 历史文章 入口） */
  wechatHistoryCrawler?: any
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
const isSaving = ref(false) // true = 保存中（confirmAndSave），false = 采集中（handleCollect）
const tipMessage = ref<string | null>(null)
const showStoreSelector = ref(false)
const showConfig = ref(false)
const editingStoreIdx = ref<number | null>(null) // null = 添加，number = 编辑第几个
const showRemarkDialog = ref(false)
const remarkInputValue = ref('')
let remarkResolve: ((value: string) => void) | null = null
const showPreview = ref(false)
const previewData = ref<XiaohongshuNote | XiaohongshuAccount | XiaohongshuNote[] | null>(null)
const previewCollectionType = ref<CollectionType | ''>('')
// 公众号：是否同时采集阅读量等额外数据
const extraDataChecked = ref(false)
// 公众号：是否同时采集公众号主体信息（公司名称、地区、认证等）
const extraPrincipalInfoChecked = ref(false)
const configForm = ref<{ type: StoreType; [k: string]: unknown }>({ type: StoreType.Notion })

// 当前选中的 crawler（多 Crawler 时取第一个，如公众号 内容/数据 合并为单一入口）
const selectedCrawlerIdx = ref(0)
const effectiveCrawlers = computed(() => props.crawlers || [])
const currentCrawler = computed(() => effectiveCrawlers.value[selectedCrawlerIdx.value] ?? effectiveCrawlers.value[0])

// 当前采集类型（来自 crawler），用于按类型筛选 store 列表
const currentCollectionType = computed(
  () => (currentCrawler.value?.getCrawlerState?.()?.collectionType as CollectionType) ?? CollectionType.XHSNoteDetail
)

// 按 CollectionType 动态筛选的 store 列表
const storesList = computed(() => storeConfig.getStoresByCollectionType(currentCollectionType.value))
const currentStoreIdx = computed(() => storeConfig.getCurrentStoreIndex(currentCollectionType.value))

// 采集中/保存中时的按钮文字
const collectingPhaseText = computed(() =>
  isSaving.value ? '保存中...' : '采集中...'
)

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

function formatPreviewWechatArticle(data: WechatArticle): string {
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

function formatPreviewWechatArticleList(data: WechatArticle[]): string {
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
      const text = (c.comment || '').slice(0, 60)
      lines.push(`  ${i + 1}. ${text}${(c.comment?.length || 0) > 60 ? '...' : ''}`)
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
    if (Array.isArray(data)) {
      if (type === CollectionType.WechatArticle && Array.isArray(data)) return formatPreviewWechatArticleList(data as WechatArticle[])
      return formatPreviewFeed(data as XiaohongshuNote[])
    }
    if (data && typeof data === 'object' && 'userId' in data) return formatPreviewAccount(data as XiaohongshuAccount)
    if (data && typeof data === 'object' && ('read' in data || 'content' in data)) return formatPreviewWechatArticle(data as WechatArticle)
    return formatPreviewNote(data as XiaohongshuNote)
  } catch {
    return String(data)
  }
})

// 采集类型文案（emoji + 文字）
const collectTypeText = computed(() => {
  const type = currentCrawler.value?.getCrawlerState?.()?.collectionType
  if (type === CollectionType.XHSAccount) return '❇️账号'
  if (type === CollectionType.XHSNoteDetail) return '📕笔记详情'
  if (type === CollectionType.XHSFeed) return '📋笔记列表'
  if (type === CollectionType.WechatArticle) return '📰公众号'
  return ''
})

// 是否为公众号历史 Crawler（需要特殊流程：输入名称 → 选择文章）
const isWechatHistoryCrawler = computed(() => typeof currentCrawler.value?.loadHistory === 'function')

// 公众号：当前文章 | 历史文章 选择器（仅在公众号相关页显示）
const showWechatArticleSourceSelector = computed(
  () => currentCollectionType.value === CollectionType.WechatArticle
)
const wechatArticleSource = ref<'current' | 'history'>('current')

// 非文章页（仅 History crawler）时默认选历史文章
watch(
  () => [props.crawlers, isWechatHistoryCrawler.value] as const,
  ([crawlers, isHistory]) => {
    if (isHistory && crawlers?.length === 1) wechatArticleSource.value = 'history'
  },
  { immediate: true }
)

function openHistoryDialog() {
  wechatArticleSource.value = 'history'
  showHistoryDialog.value = true
}

// 大加辣 API Key 配置弹窗
const showDajialaKeyDialog = ref(false)
const dajialaKeyInput = ref('')
let pendingDajialaKeyResolve: ((v: boolean) => void) | null = null

async function ensureDajialaApiKey(): Promise<boolean> {
  const key = await getDajialaApiKey()
  if (key?.trim()) return true
  return new Promise<boolean>((resolve) => {
    pendingDajialaKeyResolve = resolve
    dajialaKeyInput.value = ''
    showDajialaKeyDialog.value = true
  })
}

function closeDajialaKeyDialog() {
  showDajialaKeyDialog.value = false
  pendingDajialaKeyResolve?.(false)
  pendingDajialaKeyResolve = null
}

async function saveDajialaKeyAndClose() {
  const k = dajialaKeyInput.value.trim()
  if (!k) {
    ElMessage.warning('请输入 API Key')
    return
  }
  await setDajialaApiKey(k)
  showDajialaKeyDialog.value = false
  pendingDajialaKeyResolve?.(true)
  pendingDajialaKeyResolve = null
  ElMessage.success('已保存')
}

// 公众号历史流程（使用 wechatHistoryCrawler 或 currentCrawler 中支持 loadHistory 的）
const effectiveHistoryCrawler = computed(
  () => props.wechatHistoryCrawler ?? (typeof currentCrawler.value?.loadHistory === 'function' ? currentCrawler.value : null)
)

const showHistoryDialog = ref(false)
const historyStep = ref<'input' | 'select'>('input')
const historyAccountName = ref('')
const historyLoading = ref(false)
const historyItems = ref<WechatHistoryItem[]>([])
const historySelected = ref<Set<string>>(new Set())
const historyPage = ref(1)
const historyTotalPage = ref(1)
const historyLoadingMore = ref(false)
const historyLoadedByUrl = ref(false)
const historySourceUrl = ref('')

const historySelectedCount = computed(() => historySelected.value.size)
const allSelected = computed(() => {
  const uncollectedItems = historyItems.value.filter(i => !i.collected)
  return uncollectedItems.length > 0 && uncollectedItems.every(i => historySelected.value.has(i.url))
})

function closeHistoryDialog() {
  showHistoryDialog.value = false
  historyStep.value = 'input'
  historyAccountName.value = ''
  historyItems.value = []
  historySelected.value = new Set()
  historyPage.value = 1
  historyTotalPage.value = 1
  historyLoadedByUrl.value = false
  historySourceUrl.value = ''
}

function backToInput() {
  historyStep.value = 'input'
  historyItems.value = []
  historySelected.value = new Set()
  historyPage.value = 1
  historyTotalPage.value = 1
}

/** 用当前文章 URL 自动识别公众号并加载历史 */
async function loadHistoryByUrl() {
  if (!(await ensureDajialaApiKey())) return
  const url = typeof location !== 'undefined' ? location.href : ''
  if (!/mp\.weixin\.qq\.com\/s\//.test(url)) {
    ElMessage.warning('请先在公众号文章页打开此弹窗，再点击自动识别')
    return
  }
  const crawler = effectiveHistoryCrawler.value
  if (!crawler?.loadHistory) {
    ElMessage.error('历史文章功能不可用')
    return
  }
  historyLoading.value = true
  try {
    const res = await crawler.loadHistory({ url, page: 1 })
    if (res.error) {
      ElMessage.error(res.error)
      return
    }
    const items = res.items || []
    historyItems.value = items
    historySelected.value = new Set()
    historyPage.value = 1
    historyTotalPage.value = res.totalPage ?? 1
    historyStep.value = 'select'
    historyLoadedByUrl.value = true
    historySourceUrl.value = url

    // 获取公众号主体信息（使用当前文章 URL）
    if (url) {
      try {
        const principalRes = await fetchPrincipalInfo(url)
        if (principalRes.code === 0 && principalRes.data) {
          const nickname = principalRes.data.nick_name || principalRes.data.nickName || ''
          if (nickname) {
            historyAccountName.value = nickname
          }
        }
      } catch (e) {
        console.warn('[CJDB] 获取公众号名称失败:', e)
      }
    }

    // 加载后检查已收录状态
    await checkCollectedStatus(items)
    if (items.length === 0) ElMessage.info('未找到文章')
  } catch (e: any) {
    ElMessage.error('加载失败: ' + (e?.message || String(e)))
  } finally {
    historyLoading.value = false
  }
}

async function loadHistoryList(page = 1) {
  const name = historyAccountName.value.trim()
  if (!name) {
    ElMessage.warning('请输入公众号名称')
    return
  }
  if (!(await ensureDajialaApiKey())) return
  const crawler = effectiveHistoryCrawler.value
  if (!crawler?.loadHistory) {
    ElMessage.error('历史文章功能不可用')
    return
  }
  if (page === 1) historyLoading.value = true
  else historyLoadingMore.value = true
  try {
    const res = await crawler.loadHistory({ name, page })
    if (res.error) {
      ElMessage.error(res.error)
      return
    }
    const items = res.items || []
    if (page === 1) {
      historyItems.value = items
      historySelected.value = new Set()
      historyStep.value = 'select'

      // 获取公众号主体信息（使用第一条文章的 URL）
      if (items.length > 0 && items[0].url) {
        try {
          const principalRes = await fetchPrincipalInfo(items[0].url)
          if (principalRes.code === 0 && principalRes.data) {
            const nickname = principalRes.data.nick_name || principalRes.data.nickName || ''
            if (nickname) {
              historyAccountName.value = nickname
            }
          }
        } catch (e) {
          console.warn('[CJDB] 获取公众号名称失败:', e)
        }
      }

      // 加载后检查已收录状态
      await checkCollectedStatus(items)
    } else {
      const urlSet = new Set(historyItems.value.map((i) => i.url))
      for (const i of items) {
        if (i.url && !urlSet.has(i.url)) {
          historyItems.value.push(i)
          urlSet.add(i.url)
        }
      }
      await checkCollectedStatus(items)
    }
    historyPage.value = page
    historyTotalPage.value = res.totalPage ?? 1
    if (page === 1 && items.length === 0) ElMessage.info('未找到文章')
  } catch (e: any) {
    ElMessage.error('加载失败: ' + (e?.message || String(e)))
  } finally {
    historyLoading.value = false
    historyLoadingMore.value = false
  }
}

/** 检查文章是否已收录 */
async function checkCollectedStatus(items: WechatHistoryItem[]) {
  const currentStore = storeConfig.getCurrentStore(CollectionType.WechatArticle)
  if (!currentStore || currentStore.type !== 'notion') return

  try {
    const urls = items.map(i => i.url).filter(Boolean)
    if (urls.length === 0) return

    // 批量查询 Notion 数据库
    const token = currentStore.token?.trim()
    let databaseId = (currentStore.databaseId || '').replace(/\s/g, '')
    const urlMatch = databaseId.match(/notion\.(?:so|com)\/[^/]+\/([a-f0-9]{32})/)
    if (urlMatch) databaseId = urlMatch[1]

    if (!token || !databaseId) return

    for (let i = 0; i < urls.length; i += 10) {
      const batch = urls.slice(i, i + 10)
      const orFilters = batch.map(url => ({ property: 'URL', url: { equals: url } }))

      const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify({ filter: { or: orFilters } })
      })

      if (res.ok) {
        const data = await res.json()
        const existingUrls = new Set<string>()
        data.results?.forEach((page: any) => {
          const urlProp = page.properties?.URL
          const url = urlProp?.url
          if (url) existingUrls.add(url)
        })

        // 标记已收录
        items.forEach(item => {
          if (existingUrls.has(item.url)) {
            item.collected = true
          }
        })
      }
    }
  } catch (e) {
    console.warn('[CJDB] 检查已收录状态失败:', e)
  }
}

async function loadHistoryNextPage() {
  if (historyPage.value >= historyTotalPage.value || historyLoadingMore.value) return
  const crawler = effectiveHistoryCrawler.value
  if (!crawler?.loadHistory) return
  const nextPage = historyPage.value + 1
  historyLoadingMore.value = true
  try {
    const opts = historyLoadedByUrl.value && historySourceUrl.value
      ? { url: historySourceUrl.value, page: nextPage }
      : { name: historyAccountName.value.trim(), page: nextPage }
    if (!opts.url && !opts.name) return
    const res = await crawler.loadHistory(opts)
    if (res.error) {
      ElMessage.error(res.error)
      return
    }
    const items = res.items || []
    const urlSet = new Set(historyItems.value.map((i) => i.url))
    const newItems: WechatHistoryItem[] = []
    for (const i of items) {
      if (i.url && !urlSet.has(i.url)) {
        historyItems.value.push(i)
        urlSet.add(i.url)
        newItems.push(i)
      }
    }
    // 检查新加载文章的已收录状态
    await checkCollectedStatus(newItems)
    historyPage.value = nextPage
    historyTotalPage.value = res.totalPage ?? 1
  } catch (e: any) {
    ElMessage.error('加载失败: ' + (e?.message || String(e)))
  } finally {
    historyLoadingMore.value = false
  }
}

function toggleHistoryItem(item: WechatHistoryItem) {
  const url = item.url
  if (!url || item.collected) return
  const next = new Set(historySelected.value)
  if (next.has(url)) {
    next.delete(url)
  } else {
    next.add(url)
    // 初始化复选框状态（默认不勾选）
    if (item.fetchData === undefined) item.fetchData = false
  }
  historySelected.value = next
}

function handleSelectCommand(command: string) {
  if (command === 'all') {
    // 全选所有历史（排除已收录）
    const uncollectedItems = historyItems.value.filter(i => !i.collected)
    if (allSelected.value) {
      // 如果已经全选，则取消全选
      historySelected.value = new Set()
    } else {
      // 否则全选所有未收录
      historySelected.value = new Set(uncollectedItems.map(i => i.url).filter(Boolean))
      uncollectedItems.forEach(item => {
        if (item.fetchData === undefined) item.fetchData = false
      })
    }
  } else if (command === 'uncollected') {
    // 全选所有未收录
    const uncollectedItems = historyItems.value.filter(i => !i.collected)
    historySelected.value = new Set(uncollectedItems.map(i => i.url).filter(Boolean))
    uncollectedItems.forEach(item => {
      if (item.fetchData === undefined) item.fetchData = false
    })
  }
}

async function confirmHistoryCollect() {
  const crawler = effectiveHistoryCrawler.value
  if (!crawler?.crawl || historySelectedCount.value === 0) return
  if (!(await ensureDajialaApiKey())) return

  const selectedItems = historyItems.value.filter((i) => historySelected.value.has(i.url) && !i.collected)
  if (selectedItems.length === 0) {
    ElMessage.warning('请选择未收录的文章')
    return
  }

  collecting.value = true
  clearTipMessage('')

  try {
    // 1. 采集基础数据
    const data = await crawler.crawl({
      selectedItems,
      onProgress: (msg) => tipsDisplay(msg)
    })

    // 2. 转换为 WechatArticle，并保留 fetchData 状态，正文采集是必须的
    let articles: WechatArticle[] = Array.isArray(data) ? data : [data]
    articles.forEach((article, i) => {
      const item = selectedItems[i]
      if (item) {
        article.fetchData = item.fetchData
      }
    })

    // 3. 必须采集正文
    articles = await augmentWechatArticlesWithContent(articles, (msg) => tipsDisplay(msg))

    // 4. 根据 fetchData 复选框状态采集数据
    const needData = articles.some(a => a.fetchData)
    if (needData) {
      articles = await augmentWechatArticlesWithApiData(articles, (msg) => tipsDisplay(msg))
    }

    // 5. 采集公众号主体信息（所有文章共用，只调用一次 API）
    articles = await augmentWechatArticlesWithPrincipalInfo(articles, (msg) => tipsDisplay(msg))

    // 6. 直接保存，不预览
    const storeCfg = storeConfig.getCurrentStore(CollectionType.WechatArticle)
    if (!storeCfg || !isStoreConfigured(storeCfg)) {
      ElMessage.warning('请先配置存储源')
      return
    }

    tipsDisplay('正在保存到 Notion...')
    const result = await storeCrawlData(CollectionType.WechatArticle, articles, storeCfg)
    console.log('[CJDB] confirmHistoryCollect Result:', result)

    // 7. 检查结果
    const results = Array.isArray(result) ? result : [result]
    const hasError = results.some((r) => !r.ok)
    if (hasError) {
      const err = results.find((r) => !r.ok)
      throw new Error(err?.error || '保存失败')
    }

    clearTipMessage()

    // 8. 标记已收录，不关闭弹窗
    selectedItems.forEach(item => {
      item.collected = true
    })

    // 9. 取消选中已收录的文章
    const newSelected = new Set<string>()
    historySelected.value.forEach(url => {
      const item = historyItems.value.find(i => i.url === url)
      if (item && !item.collected) {
        newSelected.add(url)
      }
    })
    historySelected.value = newSelected

    ElMessage.success(`已成功采集 ${selectedItems.length} 篇文章`)
  } catch (e: any) {
    ElMessage.error('采集失败: ' + (e?.message || String(e)))
  } finally {
    collecting.value = false
    clearTipMessage()
  }
}

// 选择存储源
async function selectStore(index: number) {
  await storeConfig.setSelected(currentCollectionType.value, index)
  showStoreSelector.value = false
}

// 类型变化时重置表单
function handleTypeChange() {
  configForm.value = { type: configForm.value.type }
}

// 打开添加配置弹窗（与小红书完全相同的逻辑）
function openAddConfig() {
  editingStoreIdx.value = null
  configForm.value = { type: StoreType.Notion }
  showStoreSelector.value = false
  showConfig.value = true
}

// 关闭配置弹窗
function closeConfig() {
  showConfig.value = false
  editingStoreIdx.value = null
  configForm.value = { type: StoreType.Notion }
}

// 打开编辑配置弹窗（与小红书完全相同的逻辑）
function editStoreAt(index: number) {
  const store = storesList.value[index] as Store
  if (!store) return
  editingStoreIdx.value = index
  configForm.value = {
    type: store.type,
    ...(store.config as Record<string, unknown>)
  }
  showStoreSelector.value = false
  showConfig.value = true
}

// 打开备注弹窗，返回 Promise<string | undefined>
function openRemarkDialog(currentName: string): Promise<string> {
  return new Promise((resolve) => {
    remarkResolve = resolve
    remarkInputValue.value = currentName || ''
    showRemarkDialog.value = true
  })
}

function handleRemarkDialogClose() {
  if (remarkResolve) {
    remarkResolve(remarkInputValue.value || '')
    remarkResolve = null
  }
}

function confirmRemark() {
  if (remarkResolve) {
    remarkResolve(remarkInputValue.value.trim())
    remarkResolve = null
  }
  showRemarkDialog.value = false
}

function skipRemark() {
  if (remarkResolve) {
    remarkResolve(remarkInputValue.value.trim()) // 保持当前输入
    remarkResolve = null
  }
  showRemarkDialog.value = false
}

// 添加/编辑存储源
async function saveConfig() {
  const { type, ...config } = configForm.value
  if (type === StoreType.Local || STORE_SCHEMA[type as StoreType]?.disabled) {
    ElMessage.warning('本地存储暂未实现')
    return
  }
  if (!isStoreConfigured({ type: type as string, ...config } as any)) {
    ElMessage.warning('请先填写完整配置信息')
    return
  }
  const isEdit = editingStoreIdx.value !== null
  const name = await openRemarkDialog(((config as Record<string, unknown>).name as string) || '')
  ;(config as Record<string, unknown>).name = name?.trim() || ''
  if (isEdit && editingStoreIdx.value !== null) {
    await storeConfig.updateStore(currentCollectionType.value, editingStoreIdx.value, {
      type: type ?? StoreType.Notion,
      config: config as Record<string, unknown>
    })
    ElMessage.success('已更新')
  } else {
    await storeConfig.addStore(currentCollectionType.value, {
      type: type ?? StoreType.Notion,
      config: config as Record<string, unknown>
    })
    ElMessage.success('配置已保存')
  }
  closeConfig()
}

// 删除存储源
async function removeStoreAt(index: number) {
  const store = storesList.value[index]
  const label = storeConfig.getStoreLabel(store as Store)
  try {
    await ElMessageBox.confirm(`确定要删除「${label}」吗？`, '删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await storeConfig.removeStore(currentCollectionType.value, index)
    showStoreSelector.value = false
    ElMessage.success('已删除')
  } catch {
    // 用户取消
  }
}

// 校验当前存储源是否已配置
function isStoreConfigured(store: { type: string; token?: string; databaseId?: string; appId?: string; appSecret?: string; appToken?: string; tableId?: string }): boolean {
  if (store.type === 'local') return false // 本地存储未实现
  if (store.type === 'notion') return !!(store.token?.trim() && store.databaseId?.trim())
  if (store.type === 'feishu') return !!(store.appId?.trim() && store.appSecret?.trim() && store.appToken?.trim() && store.tableId?.trim())
  return false
}

// 采集数据（先爬取，弹窗预览，用户确认后再保存）
async function handleCollect() {
  if (collecting.value) return

  // 公众号历史：打开对话框，走 输入名称 → 选择 → 采集 流程（当前 crawler 为 History 或用户选了 历史文章）
  if (isWechatHistoryCrawler.value || (showWechatArticleSourceSelector.value && wechatArticleSource.value === 'history')) {
    openHistoryDialog()
    return
  }

  const crawler = currentCrawler.value
  if (!crawler) return

  const currentStore = storeConfig.getCurrentStore(currentCollectionType.value)
  if (!currentStore || !isStoreConfigured(currentStore)) {
    ElMessage.warning('请先配置存储源')
    showStoreSelector.value = true
    return
  }

  collecting.value = true
  isSaving.value = false
  clearTipMessage('')

  try {
    await nextTick()
    const data = await crawler.crawl({
      onProgress: (msg) => { tipsDisplay(msg) }
    })
    const state = crawler.getCrawlerState()
    const collectionType = state.collectionType

    clearTipMessage('')
    previewData.value = data as XiaohongshuNote | XiaohongshuAccount | XiaohongshuNote[] | WechatArticle | WechatArticle[]
    previewCollectionType.value = collectionType
    extraDataChecked.value = false
    extraPrincipalInfoChecked.value = false
    showPreview.value = true
  } catch (e: any) {
    console.error('[CJDB] 采集失败', e)
    clearTipMessage('')
    ElMessage.error('采集失败: ' + (e?.message || String(e)))
  } finally {
    collecting.value = false
    isSaving.value = false
  }
}

// 预览弹窗确认后保存（统一通过 storeCrawlData）
async function confirmAndSave() {
  const data = previewData.value
  const collectionType = previewCollectionType.value
  if (!data) return

  const storeCfg = storeConfig.getCurrentStore(collectionType)
  if (!storeCfg || !isStoreConfigured(storeCfg)) {
    ElMessage.warning('请先配置存储源')
    showStoreSelector.value = true
    return
  }

  collecting.value = true
  isSaving.value = true
  clearTipMessage()

  let dataToSave: any = data
  if (collectionType === CollectionType.WechatArticle) {
    dataToSave = Array.isArray(data) ? [...(data as WechatArticle[])] : [data as WechatArticle]
    const needApiKey = extraDataChecked.value || extraPrincipalInfoChecked.value
    if (needApiKey && !(await ensureDajialaApiKey())) {
      collecting.value = false
      isSaving.value = false
      return
    }
    if (extraPrincipalInfoChecked.value) {
      dataToSave = await augmentWechatArticlesWithPrincipalInfo(dataToSave, (msg) => tipsDisplay(msg))
    }
    if (extraDataChecked.value) {
      dataToSave = await augmentWechatArticlesWithApiData(dataToSave, (msg) => tipsDisplay(msg))
    }
  } else {
    dataToSave = data
  }

  try {
    const result = await storeCrawlData(collectionType, dataToSave, storeCfg)
    console.log('[CJDB] confirmAndSave Result:', result)

    // 检查结果（支持单条或批量）
    const results = Array.isArray(result) ? result : [result]
    const hasError = results.some((r) => !r.ok)
    if (hasError) {
      const err = results.find((r) => !r.ok)
      throw new Error(err?.error || '保存失败')
    }

    showPreview.value = false
    clearTipMessage()

    const pageIds = results.filter((r) => r.pageId).map((r) => r.pageId as string)
    const pageIdSuffix =
      pageIds.length > 0
        ? `（Page ID${pageIds.length > 1 ? 's' : ''}: ${pageIds.slice(0, 3).join(', ')}${pageIds.length > 3 ? ` 等${pageIds.length}条` : ''}）`
        : ''

    if (collectionType === CollectionType.XHSAccount) {
      ElMessage.success(`已保存账号信息${pageIdSuffix}`)
    } else if (collectionType === CollectionType.WechatArticle && Array.isArray(data)) {
      ElMessage.success(`已保存 ${data.length} 篇公众号文章${pageIdSuffix}`)
    } else if (collectionType === CollectionType.WechatArticle) {
      ElMessage.success(`已保存公众号文章${pageIdSuffix}`)
    } else if (Array.isArray(data)) {
      ElMessage.success(`已保存 ${data.length} 条笔记${pageIdSuffix}`)
    } else {
      const cl = (data as XiaohongshuNote).commentList
      const totalComments = (cl?.length || 0) + (cl?.reduce((s, c) => s + (c.replies?.length || 0), 0) || 0)
      ElMessage.success(`已保存 ${totalComments} 条评论${pageIdSuffix}`)
    }
  } catch (e: any) {
    console.error('[CJDB] 保存失败', e)
    ElMessage.error('保存失败: ' + (e.message || String(e)))
  } finally {
    collecting.value = false
    isSaving.value = false
    clearTipMessage()
  }
}

function handlePreviewClose() {
  previewData.value = null
  previewCollectionType.value = ''
  extraDataChecked.value = false
}

// 监听状态变化（勾选变化时刷新 UI）
function setupListener() {
  window.addEventListener('cjdb-collection-changed', () => {
    currentCrawler.value?.getCrawlerState?.()
  })
}

// 暴露 tipsDisplay 到全局
function tipsDisplay(msg: string) {
  tipMessage.value = msg
}

function clearTipMessage(msg?: string) {
  if (msg === undefined || !msg) {
    tipMessage.value = null
    return
  }
  if (tipMessage.value === msg) {
    tipMessage.value = null
  }
}

onMounted(async () => {
  await storeConfig.init()
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

.mode-selector {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
.mode-item {
  padding: 6px 12px;
  font-size: 12px;
  border-radius: 6px;
  cursor: pointer;
  color: #606266;
  transition: all 0.2s;
  &:hover {
    color: #409eff;
  }
  &.active {
    background: #ecf5ff;
    color: #409eff;
    font-weight: 500;
  }
  &.disabled {
    color: #c0c4cc;
    cursor: not-allowed;
    &:hover {
      color: #c0c4cc;
    }
  }
}

.dajiala-key-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: #606266;
  line-height: 1.5;
}
.dajiala-key-hint + .el-input { margin-bottom: 0; }

.history-input-step {
  .el-form-item { margin-bottom: 16px; }
  .history-input-row {
    display: flex;
    gap: 8px;
    align-items: center;
    .el-input { flex: 1; min-width: 0; }
  }
  > .el-button { margin-top: 8px; }
}

.history-account-input {
  margin-bottom: 16px;
  .el-form-item { margin-bottom: 0; }
  .history-input-row {
    display: flex;
    gap: 8px;
    align-items: center;
    .el-input { flex: 1; min-width: 0; }
  }
}

.history-select-step {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.history-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: #606266;
}

.history-table-wrapper {
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid #ebeef5;
  border-radius: 6px;
}

.history-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;

  thead {
    position: sticky;
    top: 0;
    background: #f5f7fa;
    z-index: 1;
    th {
      padding: 10px 12px;
      font-weight: 500;
      color: #606266;
      text-align: left;
      border-bottom: 1px solid #ebeef5;
    }
  }

  tbody {
    .history-row {
      cursor: pointer;
      transition: background 0.2s;
      &:hover {
        background: #f5f7fa;
      }
      &.checked {
        background: #ecf5ff;
      }
      &.disabled {
        cursor: not-allowed;
        opacity: 0.5;
        &:hover {
          background: transparent;
        }
      }
      td {
        padding: 10px 12px;
        border-bottom: 1px solid #ebeef5;
      }
    }
  }
}

.history-checkbox {
  flex-shrink: 0;
  width: 20px;
  text-align: center;
  font-weight: bold;
  color: #409eff;
  display: inline-block;
}

.history-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-date {
  font-size: 12px;
  color: #909399;
  white-space: nowrap;
}

.history-list {
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 4px;
}
.history-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  &:hover { background: #f5f7fa; }
  &.checked { background: #ecf5ff; }
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
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  padding-right: 4px;
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

  &:hover .store-item-menu {
    opacity: 1;
  }
}

.store-item-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.store-item-menu {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #909399;
  opacity: 0;
  transition: opacity 0.2s, color 0.2s;
  border-radius: 4px;
  cursor: pointer;

  .el-icon {
    font-size: 18px;
    transform: rotate(90deg); // 竖三点变横三点
  }

  &:hover {
    color: #606266;
    background: rgba(0, 0, 0, 0.05);
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
  min-width: 84px;
  width: 84px;
  height: 84px;
  border-radius: 50%;
  padding: 0;
  overflow: hidden;
  transition: background-color 0.25s, border-color 0.25s;

  :deep(.el-button__content) {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  &.collect-btn-busy {
    background: linear-gradient(135deg, #e6a23c, #f0c14b) !important;
    border-color: #e6a23c !important;
    color: #fff !important;
  }

  .collect-btn-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    margin-top: -2px;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
  }

  .collect-btn-main {
    flex-shrink: 0;
    font-size: 24px;
    font-weight: 600;
    line-height: 1.1;
    letter-spacing: 2px;
  }

  .collect-btn-type {
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 600;
    opacity: 0.95;
  }
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
  max-width: 280px;
  word-break: break-word;
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

.extra-data-section {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #ebeef5;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.extra-data-section .el-checkbox {
  font-size: 13px;
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

<!-- 非 scoped：el-select / el-dropdown / el-dialog 需全局样式确保层级正确 -->
<style lang="scss">
.cjdb-store-select-popper,
.cjdb-store-menu-popper,
.cjdb-history-select-dropdown {
  z-index: 100003 !important;
}

/* 添加存储源/编辑弹窗：层级需高于 cjdb-panel(99999)，否则会被遮挡无法操作 */
.el-overlay:has(.cjdb-config-dialog) {
  z-index: 100002 !important;
}

/* 根因：content script CSS 与页面 CSS 合并，公众号等页面的全局样式会级联影响 el-dialog__body（如 height:0）
 * 方案：仅做最小修复，恢复 el-dialog__body 高度，不覆盖 Element Plus 表单布局，避免「框缩到右侧」等错乱 */
.cjdb-config-dialog .el-dialog__body {
  min-height: 200px !important;
  overflow: visible !important;
}

/* 数据库备注弹窗：层级高于配置弹窗，确保盖在前一个弹窗之上 */
.el-overlay:has(.cjdb-remark-dialog) {
  z-index: 999999 !important;
}
</style>
