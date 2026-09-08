<template>
  <div class="cjdb-app">
    <div v-if="currentCrawler || data || task" class="cjdb-launch-wrap">
      <span
        v-if="!opened && (progress || error || uiError)"
        class="cjdb-launch-status"
        role="status"
        >{{ progress || error || uiError }}</span
      >
      <button
        class="cjdb-launcher"
        :class="{ busy: phase === 'collecting' }"
        :disabled="busy"
        :aria-busy="phase === 'collecting'"
        aria-label="识别并采集当前页面"
        @click="launch"
      >
        <BrandMark /><span class="cjdb-tooltip">{{ '采集当前页面' }}</span>
      </button>
    </div>
    <Modal
      :open="opened"
      :class="{ 'picker-mode': picking }"
      :title="task ? '采集结果' : picking ? '选择保存位置' : '预览采集内容'"
      :subtitle="subtitle"
      @close="opened = false"
    >
      <template #actions
        ><button class="cjdb-text cjdb-help" @click="contactOpen = true"><strong>加我微信</strong> 交流学习</button></template
      >
      <div class="cjdb-stack">
        <section
          v-if="picking && data"
          class="collection-summary"
          role="region"
          aria-label="本次采集摘要"
        >
          <div class="cjdb-row cjdb-between">
            <strong>{{ contentKind }} · {{ countLabel }}</strong
            ><button class="cjdb-text" @click="backToPreview">返回预览</button>
          </div>
          <p class="summary-titles">{{ summaryTitles }}</p>
          <p v-if="keyword" class="cjdb-muted">关键词：{{ keyword }}</p>
        </section>
        <DestinationPicker
          v-show="picking"
          :open="opened && picking"
          :revision="configRevision"
          :configured-source="configSource"
          @configure="openSettings"
          @source-change="sourceChanged"
          @invalidate="destination = null"
          :type="type"
          :categories="
            categoryChoices.map((c) => ({
              category: c.category,
              label: c.label,
              enabled: !!c.crawler
            }))
          "
          @category="switchCategory(categoryChoices.find((c) => c.category === $event)?.crawler)"
          @selected="selected"
          @cancel="opened = false"
        />
        <div v-if="!picking && destination" class="cjdb-row cjdb-between cjdb-destination-line">
          <span
            >保存到：<strong>{{ destination.name }}</strong></span
          ><button
            class="cjdb-text"
            :disabled="busy || preparing || !!task"
            @click="picking = true"
          >
            更换数据库
          </button>
        </div>
        <p v-if="progress" role="status" class="cjdb-note">{{ progress }}</p>
        <ContentPreview
          v-if="phase === 'preview' && data"
          v-show="!picking"
          ref="preview"
          :key="previewRevision"
          :data="data"
          :type="type"
          :destination-name="destination?.name || '本地'"
          hide-action
          @confirm="confirmPreview"
          @preparing="preparing = $event"
        />
        <TaskResult v-if="task" :task="task" :busy="busy" retryable @retry="flow.retry" />
        <p v-if="busy || preparing" class="cjdb-muted">
          请保持当前网页打开。关闭弹窗不会停止处理。
        </p>
        <p v-if="error || uiError" class="cjdb-error" role="alert">{{ error || uiError }}</p>
      </div>
      <template #footer>
        <div class="cjdb-row">
          <span v-if="picking" class="cjdb-muted">{{
            destination ? '已选择：' + destination.name : '选择保存位置后保存'
          }}</span>
        </div>
        <div v-if="phase === 'preview' && !picking" class="cjdb-row">
          <button class="cjdb-btn" :disabled="preparing" @click="recollect">重新采集</button>
          <button class="cjdb-btn primary" :disabled="preparing" @click="preview?.confirm()">
            {{ preparing ? '正在准备…' : '确认' }}
          </button>
        </div>
        <button
          v-if="phase === 'preview' && picking"
          class="cjdb-btn primary"
          :disabled="!destination || preparing"
          @click="saveConfirmed"
        >
          {{ destination ? '保存到 ' + destination.name : '请先选择保存位置' }}
        </button>
        <button
          v-if="phase === 'saving'"
          class="cjdb-btn"
          :disabled="stopRequested"
          @click="flow.stop"
        >
          {{ stopRequested ? '当前项完成后停止' : '停止后续保存' }}
        </button>
        <button v-if="task && !busy" class="cjdb-btn primary" @click="opened = false">
          关闭
        </button>
      </template>
    </Modal>
    <ContactDialog :open="contactOpen" @close="contactOpen = false" />
    <ConfigDialog
      :source="configSource"
      :open="configOpen"
      @close="configOpen = false"
      @saved="configSaved"
    />
  </div>
</template>
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { CollectionType } from '@/types'
import type { Destination } from '@/types/destination'
import { collectionLabels, collectionCategory, itemTitle } from '@/utils/destinations'
import { service } from '@/utils/service'
import { useCollectionFlow } from '@/composables/useCollectionFlow'
import DestinationPicker from './DestinationPicker.vue'
import ContentPreview from './ContentPreview.vue'
import TaskResult from './TaskResult.vue'
import Modal from './Modal.vue'
import ConfigDialog from './ConfigDialog.vue'
import BrandMark from './BrandMark.vue'
import ContactDialog from './ContactDialog.vue'
const props = defineProps<{ crawlers: any[]; resolveCrawler: () => any }>()
const flow = useCollectionFlow()
const { phase, progress, error, data, type, destination, task, busy, stopRequested } = flow
const contactOpen = ref(false)
const configOpen = ref(false)
const configSource = ref('notion')
const configRevision = ref(0)
const opened = ref(false),
  picking = ref(false),
  preparing = ref(false),
  uiError = ref('')
const previewRevision = ref(0)
const confirmedData = ref<any>(null)
const preview = ref<InstanceType<typeof ContentPreview>>()
const currentCrawler = computed(() => props.crawlers[0])
const category = computed(() => collectionCategory(type.value))
const count = computed(() => (Array.isArray(data.value) ? data.value.length : data.value ? 1 : 0))
const contentKind = computed(
  () =>
    ({
      [CollectionType.XHSNoteDetail]: '单篇笔记',
      [CollectionType.XHSFeed]: '搜索结果',
      [CollectionType.XHSAccount]: '账号详情',
      [CollectionType.WechatArticle]: '公众号文章',
      [CollectionType.FeishuDoc]: '飞书文档'
    })[type.value]
)
const countLabel = computed(
  () =>
    `${count.value} ${type.value === CollectionType.XHSFeed ? '条作品' : category.value === 'account' ? '个账号' : '篇内容'}`
)
const rows = computed(() =>
  Array.isArray(data.value) ? data.value : data.value ? [data.value] : []
)
const summaryTitles = computed(
  () => rows.value.slice(0, 3).map(itemTitle).join(' · ') + (count.value > 3 ? ' 等' : '')
)
const keyword = computed(() =>
  type.value === CollectionType.XHSFeed
    ? rows.value[0]?.keyword || rows.value[0]?.searchKeyword || ''
    : ''
)
const subtitle = computed(
  () =>
    `${picking.value ? '第 2 步：选择存储位置' : task.value ? '保存结果' : '第 1 步：检查内容'} · ${contentKind.value}`
)
const categoryChoices = computed(() =>
  ['work', 'account'].map((category) => ({
    category,
    label: category === 'work' ? '作品' : '账号',
    crawler: props.crawlers.find(
      (c) => collectionCategory(c.getCrawlerState().collectionType) === category
    )
  }))
)
async function recognize(crawler: any) {
  if (!crawler || busy.value || preparing.value) return
  opened.value = false
  configOpen.value = false
  uiError.value = ''
  data.value = null
  task.value = null
  error.value = ''
  const url = location.href
  await flow.collect(crawler)
  if (location.href !== url) {
    data.value = null
    phase.value = 'idle'
    uiError.value = '识别期间页面已变化，请重新采集。'
    return
  }
  if (phase.value !== 'preview' || !data.value) return
  showPreview()
}
function showPreview() {
  destination.value = null
  confirmedData.value = null
  picking.value = false
  configOpen.value = false
  previewRevision.value++
  opened.value = true
}
async function launch() {
  if (busy.value || preparing.value) return
  const crawler = props.resolveCrawler()
  if (!crawler) {
    opened.value = false
    uiError.value = '当前页面不支持采集。'
    return
  }
  await recognize(crawler)
}
async function recollect() {
  if (busy.value || preparing.value) return
  opened.value = false
  discard()
  await launch()
}
async function switchCategory(crawler: any) {
  if (!crawler || collectionCategory(crawler.getCrawlerState().collectionType) === category.value)
    return
  await recognize(crawler)
}
function selected(d: Destination) {
  destination.value = d
}
function confirmPreview(value: any) {
  confirmedData.value = value
  destination.value = null
  picking.value = true
}
function backToPreview() {
  if (busy.value) return
  confirmedData.value = null
  destination.value = null
  picking.value = false
}
function sourceChanged(source: string) {
  if (source !== 'local') configSource.value = source
  destination.value = null
}
async function saveConfirmed() {
  if (!destination.value || !confirmedData.value || busy.value) return
  picking.value = false
  await flow.save(confirmedData.value)
}
function discard() {
  data.value = null
  task.value = null
  phase.value = 'idle'
  destination.value = null
  opened.value = false
  picking.value = false
  confirmedData.value = null
}
function openSettings(source: unknown = configSource.value) {
  if (source === 'feishu' || source === 'notion') configSource.value = source
  configOpen.value = true
}
function configSaved(source: string) {
  configSource.value = source
  configOpen.value = false
  destination.value = null
  configRevision.value++
}
const receiveTip = (message: string) => {
  if (busy.value) progress.value = message
}
const beforeUnload = (event: BeforeUnloadEvent) => {
  if (busy.value || preparing.value) {
    event.preventDefault()
    event.returnValue = ''
  }
}
onMounted(() => {
  ;(window as any).CJDB_TipsDisplay = receiveTip
  window.addEventListener('beforeunload', beforeUnload)
})
onBeforeUnmount(() => {
  if ((window as any).CJDB_TipsDisplay === receiveTip) delete (window as any).CJDB_TipsDisplay
  window.removeEventListener('beforeunload', beforeUnload)
})
</script>
