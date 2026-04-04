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
    // 固定扩展 ID，避免路径变更导致 storage 丢失
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwHhl57Hg2u291PVeL6X1GTJgUjsul5WeQaVER4vHKVTUnraQ7I2PI8rPCo0TsRJTNix7ikHTiaIBGG3PGtzp5jy0q3FbqCleMRFka4Daywk3dDHHXcBr/Jkp4RxOsJumq4haM+1yPhMZjTmT99K06sXWcfuRcIW4HqCEYNtsMWllF/7XtpKWF97GmfYz0AorXZKPtdswipMloRmYNYHpft8htS3SIc8J9/tjlsQHp6G+nyYgLw1X1kIoCSwvlRC/aMGqlei/sTdZWvSecq5XidaDDb7fAOJGQFfE6V+LsKCRntY0uwa722JVd0ZHQFtCOF8QKWiGDJRgcAk8k0ozSQIDAQAB',
    name: 'CJDB 数据抓取',
    description: '小红书、公众号、飞书文档采集工具',
    permissions: ['storage', 'activeTab'],
    // content.css 需可被 Shadow DOM 内 link 加载，用于样式隔离
    web_accessible_resources: [
      {
        matches: ['<all_urls>'],
        resources: ['content-scripts/content.css', 'feishu-runtime-bridge.js']
      }
    ],
    host_permissions: [
      'https://www.xiaohongshu.com/*',
      'https://*.xiaohongshu.com/*',
      'https://*.xhscdn.com/*',
      'https://*.xhscdn.net/*',
      'https://xhslink.com/*',
      'https://mp.weixin.qq.com/*',
      'https://*.feishu.cn/*',
      'https://www.dajiala.com/*',
      'https://api.notion.com/*',
      'https://open.feishu.cn/*'
    ]
  }
});
