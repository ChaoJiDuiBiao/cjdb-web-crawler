# 展示素材维护

对外素材位于 ../showcase（相对于 docs），README 使用该目录内的截图、二维码及 GitHub 视频附件。

已使用：
- preview2.png：作者提供的搜索结果采集截图。
- preview3.png：作者提供的作者详情采集截图。
- save-destination.png：演示数据的保存位置截图。
- author-qr.png：作者微信二维码。
- demo-compressed.mp4：默认演示入口，低于 10 MB。
- demo.mp4：原始高清视频，“查看高清视频”入口。

collection-preview.png：作品详情预览截图，已放回项目首页；与保存位置截图一起标注使用演示数据。

后续可补充真实作品详情及 Notion 保存结果截图。
GitHub README 使用压缩视频附件作为内嵌播放器：

https://github.com/user-attachments/assets/ed365ea3-4af0-438e-8c6c-6d9b0549e834

附件通过发布 PR #2 上传。更新视频时重新上传附件并同步 README；“查看高清视频”仍链接仓库内的原始视频。

插件图标以 `components/BrandMark.vue` 的采集按钮图形为准。修改后运行 `npm run icons`（需已安装 Playwright Chromium），导出 `public/icon/` 内的 16、32、48、128 像素 PNG；README 与扩展共用这些文件。
