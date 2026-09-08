<template>
  <main class="cjdb-app popup cjdb-stack">
    <h2>抄级对标</h2>
    <p class="cjdb-muted">在小红书、公众号或飞书文档页面，点击右下角墨镜图标开始。</p>
    <div class="cjdb-card">
      <strong>{{ connections ? 'Notion 已连接' : '尚未连接 Notion' }}</strong>
      <p class="cjdb-muted">
        {{
          connections ? '每次采集都可以选择保存位置。' : '可先使用本地存储，或在设置中连接 Notion。'
        }}
      </p>
    </div>
    <button class="cjdb-btn primary" @click="open('settings')">全局设置</button>
    <div class="cjdb-row">
      <button class="cjdb-btn" @click="open('records')">本地记录</button
      ><button class="cjdb-btn" @click="open('tasks')">任务结果</button>
    </div>
    <p v-if="error" class="cjdb-error" role="alert">{{ error }}</p>
  </main>
</template>
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { service } from '@/utils/service'
const connections = ref(0),
  error = ref('')
onMounted(async () => {
  try {
    connections.value = (await service('settings')).connections.length
  } catch (e: any) {
    error.value = e.message
  }
})
async function open(section: string) {
  try {
    await service('openSettings', { section })
  } catch (e: any) {
    error.value = e.message
  }
}
</script>
<style scoped>
.popup {
  width: 360px;
  padding: 24px;
  background: var(--bg);
}
</style>
