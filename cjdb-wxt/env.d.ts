/// <reference types="wxt/client" />
/// <reference types="@wxt-dev/module-vue/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
