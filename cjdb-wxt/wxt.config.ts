import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],

  // 输出到 output 而非 .output，便于 macOS 文件选择器直接选择（以点开头的文件夹会隐藏）
  outDir: 'output',

  // 开发时浏览器启动配置（可被项目根目录的 web-ext.config.ts 覆盖）
  webExt: {
    // 持久化用户数据，保留登录状态，避免每次 dev 都打开全新浏览器
    chromiumArgs: ['--user-data-dir=./.wxt/chrome-data'],
    // 使用 Arc 浏览器开发（取消注释并修改路径）：
    // binaries: { chrome: '/Applications/Arc.app/Contents/MacOS/Arc' },
  },

  manifest: {
    name: 'CJDB 数据抓取',
    description: '小红书、公众号数据采集工具',
    permissions: ['storage', 'activeTab'],
    host_permissions: [
      'https://www.xiaohongshu.com/*',
      'https://xhslink.com/*',
      'https://mp.weixin.qq.com/*',
      'https://api.notion.com/*',
      'https://open.feishu.cn/*'
    ]
  }
});
