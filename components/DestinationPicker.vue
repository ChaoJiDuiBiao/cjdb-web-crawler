<template>
  <section class="cjdb-stack destination-picker">
    <div class="storage-source-header">
      <label class="cjdb-field"
        >存储源
        <div class="storage-source-controls">
          <select
            class="cjdb-input"
            aria-label="存储源"
            :value="method"
            :disabled="settingsLoading"
            @change="chooseMethod(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="s in methods" :key="s.value" :value="s.value">
              {{ s.label }}
            </option></select
          ><button v-if="method !== 'local'" class="cjdb-btn" @click="openSettings">配置</button>
        </div>
      </label>
    </div>
    <template v-if="method === 'notion' && open">
      <template v-if="connectionId">
        <form class="cjdb-search" @submit.prevent="search(false)">
          <input
            v-model="query"
            class="cjdb-input"
            aria-label="搜索保存位置"
            placeholder="输入名称，或粘贴数据库链接 / 数据源 ID"
          /><button class="cjdb-btn" :disabled="loading || checking">
            {{ loading ? (appliedQuery ? '搜索中…' : '加载中…') : '搜索 / 刷新' }}
          </button>
        </form>
        <p class="cjdb-muted">点击数据源选择本次保存位置；数据库链接会列出其中的数据源。</p>
        <section class="recent-section" aria-label="最近使用" role="region">
          <div class="cjdb-row cjdb-between">
            <h3>最近使用</h3>
            <div class="cjdb-segments" aria-label="采集类型">
              <button
                v-for="c in categories"
                :key="c.category"
                :aria-pressed="collectionCategory(type) === c.category"
                :disabled="!c.enabled || checking"
                :title="c.enabled ? '' : '当前页面不支持此类型，请打开对应页面'"
                @click="emit('category', c.category)"
              >
                {{ c.label }}
              </button>
            </div>
          </div>
          <div v-if="recent.length" class="recent-pills">
            <RecentSource
              v-for="d in recent"
              :key="`${connectionId}:${configVersion}:${d.id}`"
              :destination="recentInfo(d)"
              :selected="checked?.destination.id === d.id"
              :disabled="checking"
              @select="select(d, 'recent')"
            />
          </div>
          <p v-else class="cjdb-muted">还没有最近使用的数据源，选择后会显示在这里。</p>
          <TargetReview
            v-if="checked && selectionOrigin === 'recent'"
            :key="checked.destination.id"
            :checked="checked"
            :type="type"
            :checking="checking"
            @confirm="finish"
            @invalidate="emit('invalidate')"
          />
          <p v-if="checking && selectionOrigin === 'recent'" role="status">正在选择数据源…</p>
        </section>
        <h3>{{ appliedQuery ? '搜索结果' : '数据源列表' }}</h3>
        <div class="database-results" tabindex="0" role="region" aria-label="数据源列表">
          <div v-if="loading" class="list-loading" role="status" aria-live="polite">
            <span class="loading-spinner" aria-hidden="true"></span
            >{{ appliedQuery ? '搜索中…' : '加载中…' }}
          </div>
          <div class="database-list">
            <div v-for="d in targets" :key="`${metadataRevision}:${d.id}`" class="database-group">
              <DataSourceRow
                :destination="d"
                :selected="checked?.destination.id === d.id"
                :disambiguate="targets.filter((t) => t.name === d.name).length > 1"
                :disabled="loading || checking"
                @select="select(d)"
              >
                <TargetReview
                  v-if="checked?.destination.id === d.id && selectionOrigin === 'list'"
                  :key="d.id"
                  :checked="checked"
                  :type="type"
                  :checking="checking"
                  @confirm="finish"
                  @invalidate="emit('invalidate')"
                />
                <p v-if="checking && pendingSource === d.id" role="status">正在选择数据源…</p>
              </DataSourceRow>
            </div>
          </div>
          <div v-if="!targets.length && !loading && !error" class="cjdb-empty">
            <p>
              {{
                cursor
                  ? '还有更多数据源，继续加载查看。'
                  : '没有找到匹配项，请检查名称、ID 或数据库授权。'
              }}
            </p>
          </div>
          <button
            v-if="searched && cursor"
            class="cjdb-btn"
            :disabled="loading"
            @click="search(true)"
          >
            {{ query ? '继续检索更多' : '加载更多' }}
          </button>
        </div>
      </template>
      <section v-else class="storage-setup" role="region" aria-label="配置 Notion 引导">
        <strong>先配置 Notion，再选择保存位置</strong>
        <p>填写一次个人令牌，作品和账号即可共用。请启用令牌的 Notion API 能力。</p>
        <button class="cjdb-btn primary" @click="openSettings">配置 Notion 个人令牌</button>
      </section>
    </template>
    <template v-if="method === 'local'">
      <p class="cjdb-note">无需账号。数据保存在当前浏览器，也可同时导出文件。</p>
      <label class="cjdb-field"
        >导出格式<select v-model="format" class="cjdb-input">
          <option value="">仅保存到本地记录</option>
          <option value="csv">CSV（Excel 可打开）</option>
          <option value="markdown">Markdown / 媒体包</option>
        </select></label
      >
      <div class="cjdb-actions">
        <button class="cjdb-btn primary" :disabled="checking" @click="useLocal">
          使用本地存储
        </button>
      </div>
    </template>
    <template v-if="method === 'feishu'"
      ><button
        v-for="d in feishu"
        :key="d.id"
        class="cjdb-target"
        :disabled="checking"
        @click="finish(d)"
      >
        {{ d.name }}
      </button>
      <section v-if="!feishu.length" class="storage-setup">
        <strong>先配置飞书，再选择保存位置</strong>
        <p>添加应用凭据和目标多维表格链接。</p>
        <button class="cjdb-btn primary" @click="openSettings">配置飞书</button>
      </section>
      <div class="cjdb-row">
        <button class="cjdb-text" @click="load">刷新配置</button>
      </div></template
    >
    <p v-if="error" class="cjdb-error" role="alert">{{ error }}</p>
  </section>
</template>
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import DataSourceRow from './DataSourceRow.vue'
import TargetReview from './TargetReview.vue'
import RecentSource from './RecentSource.vue'
import { service } from '@/utils/service'
import { recentDestinations, purposeConflict, collectionCategory } from '@/utils/destinations'
import type { CollectionType } from '@/types'
import type { Destination, PublicSettings, TargetCheck } from '@/types/destination'
const props = defineProps<{
  open: boolean
  revision?: number
  configuredSource?: string
  type: CollectionType
  categories: { category: string; label: string; enabled: boolean }[]
}>()
const emit = defineEmits<{
  selected: [destination: Destination]
  invalidate: []
  configure: [source: string]
  sourceChange: [source: string]
  cancel: []
  category: [value: string]
}>()
const settings = ref<PublicSettings | null>(null),
  targets = ref<Destination[]>([]),
  checked = ref<TargetCheck | null>(null)
const configVersion = ref(0)
const appliedQuery = ref('')
const metadataRevision = ref(0)
const method = ref('notion'),
  query = ref(''),
  cursor = ref<string | null>(null),
  format = ref('')
const loading = ref(false),
  checking = ref(false),
  error = ref(''),
  searched = ref(false)
const methods = [
  { value: 'notion', label: 'Notion' },
  { value: 'local', label: '本地文件' },
  { value: 'feishu', label: '飞书' }
]
const connectionId = computed(() => settings.value?.activeConnectionId || '')
const recent = computed(() =>
  settings.value
    ? recentDestinations(settings.value, connectionId.value, props.type).filter(
        (d) => !!d.dataSourceId
      )
    : []
)
const feishu = computed(() => settings.value?.destinations.filter((d) => d.type === 'feishu') || [])
const settingsLoading = ref(true)
let request = 0
let selectionRequest = 0
const pendingSource = ref('')
const selectionOrigin = ref('list')
function recentInfo(d: Destination): Destination {
  const current = targets.value.find(
    (t) => t.dataSourceId?.replaceAll('-', '') === d.dataSourceId?.replaceAll('-', '')
  )
  return current ? { ...d, fieldNames: current.fieldNames, createdAt: current.createdAt } : d
}
function useLocal() {
  return finish({
    id: 'local:' + format.value,
    type: 'local',
    name: format.value ? '本地 · ' + format.value.toUpperCase() : '本地记录',
    exportFormat: format.value
  })
}
function chooseMethod(value: string) {
  emit('sourceChange', value)
  method.value = value
  checked.value = null
  error.value = ''
  if (value === 'notion' && connectionId.value) void search()
}
async function load() {
  settingsLoading.value = true
  try {
    settings.value = await service('settings')
  } catch (e: any) {
    error.value = e.message
  } finally {
    settingsLoading.value = false
  }
}
async function search(more = false) {
  emit('invalidate')
  selectionRequest++
  checking.value = false
  if (!more) {
    metadataRevision.value++
    targets.value = []
    cursor.value = null
  }
  searched.value = true
  appliedQuery.value = query.value.trim()
  const id = ++request
  loading.value = true
  error.value = ''
  checked.value = null
  try {
    const result = await service('search', {
      connectionId: connectionId.value,
      query: query.value,
      cursor: more ? cursor.value : undefined
    })
    if (id !== request || !props.open) return
    targets.value = [
      ...new Map(
        [...(more ? targets.value : []), ...result.targets].map((t: Destination) => [t.id, t])
      ).values()
    ] as Destination[]
    cursor.value = result.cursor
  } catch (e: any) {
    if (id === request) error.value = e.message
  } finally {
    if (id === request) loading.value = false
  }
}
async function select(d: Destination, origin = 'list') {
  selectionOrigin.value = origin
  pendingSource.value = d.id
  emit('invalidate')
  const id = ++selectionRequest
  checking.value = true
  checked.value = null
  error.value = ''
  try {
    const usedFor = settings.value?.destinations.find(target => target.id === d.id)?.usedFor || d.usedFor || []
    const result: TargetCheck = { destination: d, usedFor, conflicts: [], missing: [] }
    if (id !== selectionRequest || !props.open) return
    checked.value = result
    if (!result.conflicts.length && !purposeConflict(result.usedFor, props.type))
      await finish(result.destination)
  } catch (e: any) {
    if (id === selectionRequest) error.value = e.message
  } finally {
    if (id === selectionRequest) checking.value = false
  }
}
async function finish(d: Destination) {
  const id = ++selectionRequest
  checking.value = true
  try {
    await service('remember', { destination: d, type: props.type })
    await load()
    if (id === selectionRequest && props.open) emit('selected', d)
  } catch (e: any) {
    if (id === selectionRequest) error.value = e.message
  } finally {
    if (id === selectionRequest) checking.value = false
  }
}
function openSettings() {
  emit('configure', method.value)
}

watch(format, () => emit('invalidate'))
watch(
  method,
  () => {
    request++
    selectionRequest++
    checking.value = false
    loading.value = false
    checked.value = null
  },
  { flush: 'sync' }
)
watch(
  () => props.open,
  async (open) => {
    request++
    selectionRequest++
    loading.value = false
    checking.value = false
    checked.value = null
    error.value = ''
    settingsLoading.value = true
    query.value = ''
    cursor.value = null
    targets.value = []
    if (open) {
      await load()
      if (!props.open) return
      method.value = settings.value?.connections.length ? 'notion' : 'local'
      searched.value = false
      if (connectionId.value) await search()
    }
  },
  { immediate: true }
)
watch(
  query,
  (value, previous) => {
    emit('invalidate')
    request++
    selectionRequest++
    loading.value = false
    checking.value = false
    cursor.value = null
    checked.value = null
    if (
      !value &&
      previous &&
      props.open &&
      !settingsLoading.value &&
      method.value === 'notion' &&
      connectionId.value
    )
      void search()
  },
  { flush: 'sync' }
)
watch(
  () => props.revision,
  async () => {
    request++
    selectionRequest++
    checked.value = null
    targets.value = []
    searched.value = false
    loading.value = false
    checking.value = false
    await load()
    metadataRevision.value++
    configVersion.value++
    if (props.configuredSource) method.value = props.configuredSource
    if (props.open && method.value === 'notion' && connectionId.value) await search()
  }
)
</script>

<style scoped>
.destination-picker h3 {
  margin: 0;
}
.recent-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.recent-section {
  padding: 4px 0 10px;
  border-bottom: 1px solid var(--line);
}
.destination-picker {
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 12px;
  gap: 8px;
  background: white;
}
.storage-source-header {
  border-bottom: 1px solid var(--line);
  padding-bottom: 10px;
}
.storage-source-controls {
  display: flex;
  gap: 10px;
  width: 100%;
}
.storage-source-controls select {
  flex: 1;
  min-width: 0;
}
.storage-setup {
  background: var(--surface);
  border-radius: 10px;
  padding: 24px;
}
.storage-setup p {
  margin: 8px 0 16px;
  color: var(--muted);
}
.database-results {
  flex: 1 1 auto;
  max-height: min(42dvh, 400px);
  min-height: 100px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding: 2px;
}
.database-results .cjdb-grid {
  grid-template-columns: 1fr;
}
.database-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.database-group {
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
}
.list-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px 12px;
  color: var(--muted);
  font-size: 13px;
}
.loading-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--line);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: source-spin 0.8s linear infinite;
}
@keyframes source-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .loading-spinner {
    animation: none;
  }
}
</style>
