<template>
  <div class="cjdb-stack">
    <div class="cjdb-row cjdb-between">
      <h3>本次采集全貌</h3>
      <span class="cjdb-tag">共 {{ rows.length }} {{ batch ? '条结果' : '项' }}</span>
    </div>
    <p v-if="keyword" class="cjdb-note">搜索关键词：{{ keyword }}</p>
    <div
      v-if="batch"
      class="preview-table-wrap"
      tabindex="0"
      role="region"
      aria-label="批量采集预览"
    >
      <table class="preview-table">
        <thead>
          <tr>
            <th>序号</th>
            <th>标题</th>
            <th>作者</th>
            <th>点赞</th>
            <th>发布时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, i) in rows" :key="i">
            <td>{{ i + 1 }}</td>
            <td>
              <a
                v-if="safeUrl(item.url)"
                :href="safeUrl(item.url)"
                target="_blank"
                rel="noopener noreferrer"
                >{{ itemTitle(item) }}</a
              ><span v-else>{{ itemTitle(item) }}</span>
            </td>
            <td>{{ item.authorNickname || item.principalInfo?.nickname || '—' }}</td>
            <td>{{ item.likes ?? item.zan ?? '—' }}</td>
            <td>{{ item.publishTimeStr || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <article v-else v-for="(item, i) in rows" :key="i" class="cjdb-card">
      <div class="preview-heading">
        <img
          v-if="safeUrl(item.coverUrl || item.avatarUrl)"
          :src="safeUrl(item.coverUrl || item.avatarUrl)"
          alt="内容封面"
          referrerpolicy="no-referrer"
          @error="($event.target as HTMLImageElement).style.display = 'none'"
        />
        <div>
          <h3>{{ itemTitle(item) }}</h3>
          <span v-if="type === CollectionType.XHSNoteDetail" class="cjdb-tag">{{ item.workType || '作品类型待识别' }}</span>
          <a
            v-if="safeUrl(item.url)"
            :href="safeUrl(item.url)"
            target="_blank"
            rel="noopener noreferrer"
            >查看原文</a
          >
        </div>
      </div>
      <section v-for="group in factGroups(item)" :key="group.title" :aria-label="group.title">
        <h4 class="preview-group-title">{{ group.title }}</h4>
        <div :class="{ 'preview-fact-columns': group.title === '作品信息' }">
          <dl v-for="(column, index) in factColumns(group)" :key="index"
            class="preview-facts" :class="{ 'single-column': group.title === '作品信息' }"
            :aria-label="group.title === '作品信息' ? (index === 0 ? '作品详情' : '互动数据') : group.title">
            <template v-for="[label, value] in column" :key="label">
              <dt>{{ label }}</dt><dd>{{ value }}</dd>
            </template>
          </dl>
        </div>
      </section>
      <p v-if="body(item)" class="preview-excerpt">
        {{ body(item).slice(0, 300) }}{{ body(item).length > 300 ? '…' : '' }}
      </p>
      <details v-if="body(item).length > 300">
        <summary>展开完整正文 / 简介</summary>
        <p class="preview-body">{{ body(item) }}</p>
      </details>
      <div v-if="item.noteListText" class="preview-body">
        <strong>笔记列表</strong>
        <p>{{ item.noteListText }}</p>
      </div>
      <details v-if="item.commentList?.length">
        <summary>已采集评论 {{ item.commentList.length }} 条</summary>
        <p v-for="(c, j) in item.commentList" :key="j" class="preview-body">
          {{ Number(j) + 1 }}. {{ c.comment }}
        </p>
      </details>
    </article>
    <div class="cjdb-card cjdb-options">
      <label
        ><input
          v-model="media"
          type="checkbox"
          :disabled="busy"
        />保存图片与视频文件（耗时较长）</label
      >
      <p class="cjdb-muted">关闭后保留媒体链接；本地导出不打包媒体文件。</p>
    </div>
    <p v-if="error" class="cjdb-error" role="alert">{{ error }}</p>
    <button v-if="!hideAction" class="cjdb-btn primary" :disabled="busy" @click="confirm">
      {{ busy ? '正在准备保存…' : '保存到 ' + destinationName }}
    </button>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CollectionType } from '@/types'
import { itemTitle, safeUrl } from '@/utils/destinations'

const props = defineProps<{
  data: any
  type: CollectionType
  destinationName: string
  hideAction?: boolean
}>()
const emit = defineEmits<{
  confirm: [data: any]
  preparing: [busy: boolean]
}>()
const rows = computed(() => (Array.isArray(props.data) ? props.data : [props.data]))
const batch = computed(() => props.type === CollectionType.XHSFeed || rows.value.length > 1)
const keyword = computed(() => rows.value.find((item) => item.searchKeyword)?.searchKeyword || '')
const body = (item: any) => String(item.contentMarkdown || item.content || item.description || '')
const media = ref(true),
  busy = ref(false),
  error = ref('')
watch(
  () => props.type,
  (type) => {
    media.value = type !== CollectionType.XHSFeed
  },
  { immediate: true }
)
function facts(item: any): [string, any][] {
  const entries: [string, any][] =
    props.type === CollectionType.XHSAccount
      ? [
          ['账号 ID', item.userId],
          ['粉丝', item.fansCount],
          ['关注', item.followingCount],
          ['获赞', item.likedCount],
          ['笔记', item.notesCount],
          ['归属地', item.location]
        ]
      : [
          ['发布时间', item.publishTimeStr],
          ['点赞', item.likes ?? item.zan],
          ['收藏', item.favorites ?? item.collectNum],
          ['评论', item.comments ?? item.commentCount],
          ['阅读', item.read],
          ['发布地点', item.location || item.ipLocation],
          ['文档类型', item.docType],
          ['空间', item.workspace],
          ['图片', props.type === CollectionType.XHSNoteDetail
            ? new Set([item.coverUrl, ...String(item.imageUrls || '').split(',')].filter(Boolean)).size + ' 张'
            : item.imageUrls ? String(item.imageUrls).split(',').filter(Boolean).length + ' 张' : undefined],
          ['视频', props.type === CollectionType.XHSNoteDetail
            ? (safeUrl(item.videoUrl) ? 1 : 0) + ' 个'
            : safeUrl(item.videoUrl) ? '1 个' : undefined]
        ]
  return entries.filter(([, value]) => value !== undefined && value !== null && value !== '')
}
function factColumns(group: { title: string; entries: [string, any][] }) {
  if (group.title !== '作品信息') return [group.entries]
  const metrics = new Set(['点赞', '收藏', '评论', '阅读'])
  return [
    group.entries.filter(([label]) => !metrics.has(label)),
    group.entries.filter(([label]) => metrics.has(label))
  ]
}
function factGroups(item: any) {
  const groups = [{ title: props.type === CollectionType.XHSAccount ? '账号信息' : '作品信息', entries: facts(item) }]
  if (props.type !== CollectionType.XHSAccount) {
    const entries: [string, any][] = [
      ['作者名称', item.authorNickname || item.principalInfo?.nickname],
      ['作者 ID', item.authorUserId],
      ['粉丝量', item.authorFansCount],
      ['获赞与收藏', item.authorLikes],
      ['关注数', item.authorFollowing]
    ]
    groups.push({ title: '作者信息', entries: entries.filter(([, value]) => value !== undefined && value !== null && value !== '') })
  }
  return groups.filter(group => group.entries.length)
}
async function confirm() {
  if (busy.value) return
  busy.value = true
  emit('preparing', true)
  error.value = ''
  try {
    let items = JSON.parse(JSON.stringify(rows.value))
    if (props.type === CollectionType.WechatArticle) {
      items = items.map((item: any) => ({
        ...item,
        downloadImages: media.value
      }))
    } else
      items = items.map((item: any) => ({
        ...item,
        _metaData: { ...item._metaData, downloadImagesAndVideo: media.value }
      }))
    emit('confirm', Array.isArray(props.data) ? items : items[0])
  } catch (e: any) {
    error.value = e.message
  } finally {
    busy.value = false
    emit('preparing', false)
  }
}
defineExpose({ confirm })
</script>
<style scoped>
.preview-table-wrap {
  max-height: 50dvh;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 10px;
  overscroll-behavior: contain;
}
.preview-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.preview-table th {
  position: sticky;
  top: 0;
  background: var(--surface);
  text-align: left;
}
.preview-table th,
.preview-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  vertical-align: top;
}
.preview-table td:nth-child(2) {
  min-width: 160px;
  overflow-wrap: anywhere;
}
.preview-group-title { margin: 16px 0 8px; font-size: 13px; }
.preview-fact-columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; }
.preview-facts.single-column { grid-template-columns: max-content minmax(0, 1fr); align-content: start; }
.preview-facts {
  display: grid;
  grid-template-columns: max-content 1fr max-content 1fr;
  gap: 8px 16px;
  font-size: 13px;
  margin: 16px 0;
}
.preview-facts dt {
  color: var(--muted);
}
.preview-facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.preview-excerpt {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 13px;
}
@media (max-width: 520px) {
  .preview-fact-columns { grid-template-columns: minmax(0, 1fr); gap: 0; }
  .preview-facts {
    grid-template-columns: max-content 1fr;
  }
}
.preview-heading {
  display: flex;
  gap: 12px;
}
.preview-heading img {
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: 8px;
  flex-shrink: 0;
}
.preview-body {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin-top: 12px;
  max-height: 280px;
  overflow: auto;
}
</style>
