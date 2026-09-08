<template>
  <dialog
    ref="dialog"
    class="cjdb-dialog"
    :aria-label="title"
    @cancel.prevent="!locked && emit('close')"
  >
    <header class="cjdb-dialog-header cjdb-row cjdb-between">
      <div class="cjdb-modal-title">
        <BrandMark class="cjdb-brand" />
        <div>
          <h2>{{ title }}</h2>
          <p v-if="subtitle" class="cjdb-muted">{{ subtitle }}</p>
        </div>
      </div>
      <div class="cjdb-row cjdb-header-actions">
        <slot name="actions" /><button
          v-if="!hideClose"
          class="cjdb-text cjdb-close"
          :disabled="locked"
          :aria-label="closeLabel || '关闭采集弹窗'"
          @click="emit('close')"
        >
          ×
        </button>
      </div>
    </header>
    <div class="cjdb-dialog-body"><slot /></div>
    <footer v-if="$slots.footer" class="cjdb-dialog-footer"><slot name="footer" /></footer>
  </dialog>
</template>
<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import BrandMark from './BrandMark.vue'
const props = defineProps<{
  open: boolean
  title: string
  subtitle?: string
  locked?: boolean
  hideClose?: boolean
  closeLabel?: string
}>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>()
let returnFocus: HTMLElement | null = null
watch(
  () => props.open,
  async () => {
    await nextTick()
    if (props.open && !dialog.value?.open) {
      returnFocus =
        ((dialog.value?.getRootNode() as ShadowRoot)?.activeElement as HTMLElement) ||
        (document.activeElement as HTMLElement)
      dialog.value?.showModal()
    } else if (!props.open && dialog.value?.open) {
      dialog.value.close()
      returnFocus?.focus()
    }
  },
  { immediate: true }
)
onBeforeUnmount(() => dialog.value?.close())
</script>
