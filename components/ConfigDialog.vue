<template>
  <Modal
    class="config-modal"
    :open="open"
    title="配置"
    hide-close
    :locked="busy"
    @close="emit('close')"
    ><iframe v-if="open" ref="frame" class="config-frame" :src="url" title="采集配置"
  /></Modal>
</template>
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import { browser } from 'wxt/browser'
import Modal from './Modal.vue'
const props = defineProps<{ open: boolean; source?: string }>()
const emit = defineEmits<{ close: []; saved: [source: string] }>()
const frame = ref<HTMLIFrameElement>(),
  busy = ref(false)
const url = computed(
  () =>
    browser.runtime.getURL('/config.html') +
    '?source=' +
    (props.source === 'feishu' ? 'feishu' : 'notion')
)
function message(event: MessageEvent) {
  if (
    event.source !== frame.value?.contentWindow ||
    event.origin !== `chrome-extension://${browser.runtime.id}` ||
    event.data?.source !== 'cjdb-config'
  )
    return
  if (event.data.type === 'busy') busy.value = true
  if (event.data.type === 'idle') busy.value = false
  if (event.data.type === 'saved')
    emit('saved', event.data.storageSource === 'feishu' ? 'feishu' : 'notion')
  if (event.data.type === 'cancel' && !busy.value) emit('close')
}
watch(
  () => props.open,
  () => {
    busy.value = false
  }
)
onMounted(() => window.addEventListener('message', message))
onBeforeUnmount(() => window.removeEventListener('message', message))
</script>
<style scoped>
.config-modal {
  width: min(560px, calc(100vw - 32px));
}
.config-frame {
  display: block;
  width: 100%;
  height: 440px;
  max-height: 65vh;
  border: 0;
  background: white;
}
</style>
