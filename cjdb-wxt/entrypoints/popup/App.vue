<template>
  <div class="popup">
    <h2>CJDB 数据抓取</h2>
    <el-alert type="info" :closable="false">
      请在小红书页面使用采集功能
    </el-alert>

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
import { ref } from 'vue'
import { storage } from 'wxt/utils/storage'
import type { XiaohongshuNote } from '@/types'

const loading = ref(false)
const localData = ref<XiaohongshuNote[]>([])

async function loadLocalData() {
  loading.value = true
  try {
    const data = await storage.getItem('local:collected')
    localData.value = data || []
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
