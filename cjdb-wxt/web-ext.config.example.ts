/**
 * 开发浏览器启动配置示例
 *
 * 使用方式：复制为 web-ext.config.ts（已被 gitignore，不会提交）
 *   cp web-ext.config.example.ts web-ext.config.ts
 *
 * 功能：
 * - 使用 Arc 浏览器开发（Arc 基于 Chromium，扩展兼容）
 * - 持久化用户数据，保留登录状态（避免每次 dev 都打开全新无痕浏览器）
 */
import { resolve } from 'node:path';
import { defineWebExtConfig } from 'wxt';

export default defineWebExtConfig({
  // 持久化用户数据，保留登录状态
  chromiumArgs: ['--user-data-dir=' + resolve('.wxt/chrome-data')],

  // 使用 Arc 浏览器开发
  binaries: {
    chrome: '/Applications/Arc.app/Contents/MacOS/Arc',
  },
});
