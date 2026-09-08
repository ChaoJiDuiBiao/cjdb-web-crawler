<template>
  <main class="cjdb-app settings-page">
    <header class="cjdb-row cjdb-between">
      <div>
        <h1>抄级对标</h1>
        <p class="cjdb-muted">连接一次，随时选择保存位置。</p>
      </div>
      <button class="cjdb-btn" :disabled="busy" @click="load">刷新</button>
    </header>
    <nav class="cjdb-row" style="margin: 24px 0" aria-label="设置与记录">
      <button
        v-for="t in tabs"
        :key="t.id"
        class="cjdb-btn"
        :class="{ primary: tab === t.id }"
        @click="tab = t.id"
      >
        {{ t.name }}
      </button>
    </nav>
    <p v-if="error" class="cjdb-error" role="alert">{{ error }}</p>
    <p v-if="message" class="cjdb-note" role="status">{{ message }}</p>
    <section v-if="tab === 'settings'" class="cjdb-stack">
      <div class="cjdb-card cjdb-stack">
        <h2>Notion</h2>
        <ConfigForm @saved="load" />
        <p class="cjdb-muted">
          数据库会在每次采集时选择。全局只保存一个 Notion 个人令牌，作品和账号共用。
        </p>
      </div>
    </section>
    <section v-if="tab === 'records'" class="cjdb-stack">
      <h2>本地采集记录</h2>
      <p class="cjdb-muted">保存在当前浏览器，包含旧版本记录。可查看原文或重新导出。</p>
      <input
        v-model="query"
        class="cjdb-input"
        aria-label="筛选本地记录"
        placeholder="按标题搜索"
      />
      <p v-if="!filtered.length" class="cjdb-empty">
        {{ records.length ? '没有匹配的记录' : '还没有本地记录。采集时选择本地存储即可。' }}
      </p>
      <article v-for="r in filtered.slice(0, limit)" :key="r.key" class="cjdb-card cjdb-stack">
        <h3>{{ recordTitle(r) }}</h3>
        <p class="cjdb-muted">
          {{ collectionLabels[r.type as CollectionType] }} ·
          {{ r.createdAt ? new Date(r.createdAt).toLocaleString() : '旧版本记录' }}
        </p>
        <details>
          <summary>
            查看内容（{{ (Array.isArray(r.data) ? r.data : [r.data]).length }}
            项）
          </summary>
          <div v-for="(item, i) in Array.isArray(r.data) ? r.data : [r.data]" :key="i">
            <h3>{{ itemTitle(item) }}</h3>
            <p style="white-space: pre-wrap; max-height: 260px; overflow: auto">
              {{ item.content || item.description || item.contentMarkdown || '无正文' }}
            </p>
            <a
              v-if="safeUrl(item.url)"
              :href="safeUrl(item.url)"
              target="_blank"
              rel="noopener noreferrer"
              >查看原文</a
            >
          </div>
        </details>
        <div class="cjdb-row">
          <button class="cjdb-btn" :disabled="busy" @click="exportRecord(r, 'csv')">导出 CSV</button
          ><button class="cjdb-btn" :disabled="busy" @click="exportRecord(r, 'markdown')">
            导出 Markdown / 媒体包
          </button>
        </div>
      </article>
      <button v-if="filtered.length > limit" class="cjdb-btn" @click="limit += 20">
        显示更多记录
      </button>
    </section>
    <section v-if="tab === 'tasks'" class="cjdb-stack">
      <h2>最近 50 次保存任务</h2>
      <p class="cjdb-muted">
        失败或未完成的保存项可在这里继续处理，已成功的项目不会重复保存。请保持此页面打开直到完成。
      </p>
      <p v-if="!tasks.length" class="cjdb-empty">还没有保存任务。</p>
      <article v-for="task in tasks" :key="task.id" class="cjdb-card">
        <p class="cjdb-muted">
          {{ new Date(task.createdAt).toLocaleString() }} ·
          {{ collectionLabels[task.type] }}
        </p>
        <TaskResult
          :task="activeTask?.id === task.id ? activeTask : task"
          :busy="retryBusy && activeTask?.id === task.id"
          :retryable="!!task.retryData && !retryBusy"
          @retry="retryTask(task)"
        />
      </article>
    </section>
  </main>
</template>
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import ConfigForm from './ConfigForm.vue'
import TaskResult from './TaskResult.vue'
import { service } from '@/utils/service'
import { collectionLabels, itemTitle, safeUrl } from '@/utils/destinations'
import { useCollectionFlow } from '@/composables/useCollectionFlow'
import { exportCollection } from '@/utils/exportCollection'
import type { TaskRecord } from '@/types/destination'
import type { CollectionType } from '@/types'
const recovery = useCollectionFlow()
const { task: activeTask, busy: retryBusy } = recovery
async function retryTask(task: TaskRecord) {
  if (retryBusy.value) return
  try {
    const latest = (await service<TaskRecord[]>('tasks')).find((t) => t.id === task.id)
    if (!latest?.retryData) {
      await load()
      return
    }
    recovery.restore(latest)
    await recovery.retry()
    tasks.value = await service('tasks')
  } catch (e: any) {
    error.value = e.message
  }
}
const records = ref<any[]>([]),
  tasks = ref<TaskRecord[]>([]),
  query = ref(''),
  limit = ref(20)
const busy = ref(false),
  error = ref(''),
  message = ref(''),
  tab = ref(
    ['records', 'tasks'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'settings'
  )
const tabs = [
  { id: 'settings', name: '全局设置' },
  { id: 'records', name: '本地记录' },
  { id: 'tasks', name: '任务结果' }
]
const recordTitle = (r: any) =>
  Array.isArray(r.data) ? `${itemTitle(r.data[0])} 等 ${r.data.length} 项` : itemTitle(r.data)
const filtered = computed(() =>
  records.value.filter((r) => recordTitle(r).toLowerCase().includes(query.value.toLowerCase()))
)
async function run(fn: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    await fn()
  } catch (e: any) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
async function load() {
  await run(async () => {
    const [r, t] = await Promise.all([service('records'), service('tasks')])
    records.value = r
    tasks.value = t
  })
}
async function exportRecord(r: any, format: string) {
  await run(async () => {
    await exportCollection(r.type, r.data, format)
    message.value = '已发起文件下载。'
  })
}
onMounted(load)
</script>
<style scoped>
.settings-page {
  max-width: 920px;
  margin: 0 auto;
  padding: 40px 24px 80px;
  min-height: 100vh;
  background: var(--bg);
}
</style>
