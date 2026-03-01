<template>
  <div class="popup">
    <h2>CJDB 数据抓取</h2>
    <el-alert type="info" :closable="false">
      支持小红书、公众号页面采集
    </el-alert>

    <el-divider />

    <h3>大加辣 API Key（公众号采集）</h3>
    <p class="hint">文章数据、历史列表需配置大加辣 API</p>
    <el-input
      v-model="dajialaApiKey"
      type="password"
      placeholder="如：JZL2446596c08cb8fb2"
      show-password
      clearable
      @blur="saveDajialaApiKey" />
    <el-button size="small" type="primary" @click="saveDajialaApiKey">保存</el-button>

    <el-divider />

    <h3>本地存储数据</h3>
    <el-button @click="loadLocalData" :loading="loading">查看本地数据</el-button>

    <div v-if="localData.length > 0" class="data-list">
      <el-card v-for="(item, index) in localData" :key="index" class="data-item">
        <h4>{{ item.title }}</h4>
        <p>{{ item.content?.slice(0, 100) }}...</p>
        <div class="meta">
          <el-tag size="small">❤️ {{ item.likes }}</el-tag>
          <el-tag size="small">💬 {{ item.comments }}</el-tag>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { storage } from 'wxt/utils/storage'
import type { XiaohongshuNote } from '@/types'

const loading = ref(false)
const localData = ref<XiaohongshuNote[]>([])
const dajialaApiKey = ref('')

onMounted(async () => {
  const key = await storage.getItem('local:dajialaApiKey')
  dajialaApiKey.value = (key as string) || ''
})

async function saveDajialaApiKey() {
  await storage.setItem('local:dajialaApiKey', dajialaApiKey.value)
  ElMessage.success('已保存')
}

async function loadLocalData() {
  loading.value = true
  try {
    const data = await storage.getItem('local:collected')
    localData.value = (data as XiaohongshuNote[]) || []
  } catch (e) {
    console.error('加载数据失败', e)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped lang="scss">
.popup {
  width: 400px;
  padding: 16px;
}

h2 {
  margin: 0 0 16px;
  font-size: 18px;
  font-weight: 600;
}

h3 {
  margin: 16px 0 12px;
  font-size: 14px;
  font-weight: 600;
}

.hint {
  margin: 0 0 8px;
  font-size: 12px;
  color: #909399;
}

.el-input {
  margin-bottom: 8px;
}

.data-list {
  margin-top: 12px;
  max-height: 400px;
  overflow-y: auto;
}

.data-item {
  margin-bottom: 12px;

  h4 {
    margin: 0 0 8px;
    font-size: 14px;
  }

  p {
    margin: 0 0 8px;
    font-size: 12px;
    color: #666;
  }

  .meta {
    display: flex;
    gap: 8px;
  }
}
</style>
