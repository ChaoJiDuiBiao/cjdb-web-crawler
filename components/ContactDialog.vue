<template>
  <Modal
    class="contact-modal"
    :open="open"
    title="加我微信 交流学习"
    close-label="关闭交流弹窗"
    @close="emit('close')"
  >
    <div class="contact-content">
      <h3>扫码加我微信，交流学习</h3>
      <img :src="qrUrl" width="240" height="240" alt="作者微信二维码" />
      <p class="contact-note">添加时请备注「超级对标插件」</p>
    </div>
  </Modal>
</template>
<script setup lang="ts">
import { browser } from 'wxt/browser'
import Modal from './Modal.vue'
defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const qrUrl = browser.runtime.getURL('/contact-qr.png')
</script>
<style scoped>
.contact-modal {
  width: min(440px, calc(100vw - 32px));
}
.contact-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 8px 0 16px;
  text-align: center;
  line-height: 1.7;
}
.contact-content img {
  display: block;
  width: min(240px, 100%);
  height: auto;
  border-radius: 12px;
}
.contact-note {
  font-weight: 500;
}
</style>
