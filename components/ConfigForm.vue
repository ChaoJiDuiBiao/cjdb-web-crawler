<template>
  <form class="cjdb-app cjdb-stack config-form" @submit.prevent="save">
    <label class="cjdb-field"
      >存储源<select v-model="source" class="cjdb-input" :disabled="busy || loading">
        <option value="notion">Notion</option>
        <option value="feishu">飞书</option>
      </select></label
    >
    <template v-if="source === 'notion'">
      <label class="cjdb-field"
        >Notion 个人访问令牌（PAT）<input
          v-model="token"
          class="cjdb-input"
          type="password"
          autocomplete="off"
          :disabled="busy || loading"
          :placeholder="
            hasToken ? '已配置，留空保留当前 Token' : '粘贴 Notion 个人访问令牌（PAT）'
          "
      /></label>
      <p class="cjdb-muted">
        全局只需一个个人令牌，作品和账号共用。可访问所选工作区中你有权限的内容，无需逐个数据库添加连接。
      </p>
      <p class="cjdb-muted">
        <a
          class="cjdb-link"
          href="https://developers.notion.com/guides/get-started/personal-access-tokens"
          target="_blank"
          rel="noopener"
          >创建个人令牌</a
        >：在 Developer portal 的 Personal access tokens 中创建，启用 Notion
        API，并选择工作区和有效期。
      </p>
      <p v-if="authType === 'connection'" class="cjdb-muted">
        当前仍使用连接 Token，可粘贴个人令牌替换；留空保留现有配置。
      </p>
      <p v-if="hasToken" class="cjdb-muted">
        更换个人令牌后请重新选择保存位置，避免沿用其他工作区的最近使用。
      </p>
    </template>
    <template v-else>
      <p class="cjdb-muted">飞书需要应用凭据和目标表格链接。</p>
      <label class="cjdb-field"
        >保存位置<select
          v-model="feishuId"
          class="cjdb-input"
          :disabled="busy || loading"
          @change="chooseFeishu"
        >
          <option value="new">新增保存位置</option>
          <option v-for="d in destinations" :key="d.id" :value="d.id">{{ d.name }}</option>
        </select></label
      >
      <label class="cjdb-field"
        >名称<input v-model="feishu.name" class="cjdb-input" :disabled="busy"
      /></label>
      <label class="cjdb-field"
        >App ID<input v-model="feishu.appId" class="cjdb-input" :disabled="busy"
      /></label>
      <label class="cjdb-field"
        >App Secret<input
          v-model="feishu.appSecret"
          class="cjdb-input"
          type="password"
          autocomplete="off"
          :disabled="busy"
          :placeholder="feishuId !== 'new' ? '留空保留原密钥' : ''"
      /></label>
      <label class="cjdb-field"
        >多维表格链接<input v-model="feishu.wikiUrl" class="cjdb-input" :disabled="busy"
      /></label>
    </template>
    <p v-if="error" class="cjdb-error" role="alert">{{ error }}</p>
    <p v-if="message" class="cjdb-success" role="status">{{ message }}</p>
    <div class="config-actions">
      <button type="button" class="cjdb-btn" :disabled="busy" @click="cancel">取消</button
      ><button class="cjdb-btn primary" :disabled="busy || loading">
        {{ busy ? '保存中…' : '保存' }}
      </button>
    </div>
  </form>
</template>
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { service } from '@/utils/service'
const source = ref(
  new URLSearchParams(location.search).get('source') === 'feishu' ? 'feishu' : 'notion'
)
const emit = defineEmits<{ saved: [] }>()
const destinations = ref<any[]>([]),
  feishuId = ref('new'),
  feishu = ref({ name: '', appId: '', appSecret: '', wikiUrl: '' })
function chooseFeishu() {
  const d = destinations.value.find((d) => d.id === feishuId.value)
  feishu.value = {
    name: d?.name || '',
    appId: d?.appId || '',
    appSecret: '',
    wikiUrl: d?.wikiUrl || ''
  }
}
const authType = ref('')
const token = ref(''),
  error = ref(''),
  message = ref(''),
  busy = ref(false),
  loading = ref(true),
  hasToken = ref(false)
function notify(type: string) {
  if (window.parent !== window)
    window.parent.postMessage({ source: 'cjdb-config', type, storageSource: source.value }, '*')
}
async function load() {
  const state = await service('configState')
  destinations.value = state.destinations
  hasToken.value = state.hasToken
  authType.value = state.authType || ''
}
onMounted(async () => {
  try {
    await load()
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
})
function cancel() {
  token.value = ''
  error.value = ''
  message.value = ''
  feishuId.value = 'new'
  chooseFeishu()
  notify('cancel')
}
async function save() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  message.value = ''
  notify('busy')
  try {
    if (source.value === 'notion' && !hasToken.value && !token.value.trim())
      throw new Error('请填写 Notion 个人访问令牌（PAT）。')
    await service('saveConfig', {
      token: source.value === 'notion' ? token.value : '',
      ...(source.value === 'feishu' && feishuId.value
        ? { feishu: { ...feishu.value, id: feishuId.value === 'new' ? undefined : feishuId.value } }
        : {})
    })
    token.value = ''
    await load()
    message.value = '已保存'
    emit('saved')
    notify('saved')
  } catch (e: any) {
    error.value = e.message
  } finally {
    busy.value = false
    notify('idle')
  }
}
</script>
<style scoped>
.config-form {
  padding: 8px;
  background: white;
}
.config-form a {
  color: var(--cjdb-primary, #cd1339);
}
.config-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 10px;
}
</style>
