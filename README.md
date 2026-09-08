<div align="center">

<img src="public/icon/128.png" width="80" alt="抄级对标">

# 抄级对标｜小红书、抖音浏览器采集插件

**一款浏览器采集插件，支持采集搜索结果、作品详情、作品评论和作者详情。**

采集正文、图片、视频与互动数据，用于个人研究学习和后续 AI 分析。

**支持存储到 Notion 数据库、本地（CSV / Markdown）、飞书多维表格。**

**非自动化采集**

[**下载插件**](https://github.com/ChaoJiDuiBiao/cjdb-web-crawler/releases) · [**下载与使用**](#下载与使用) · [**问题反馈**](https://github.com/ChaoJiDuiBiao/cjdb-web-crawler/issues)

<sub>v2.0.0</sub>

</div>

## 演示视频

https://github.com/user-attachments/assets/ed365ea3-4af0-438e-8c6c-6d9b0549e834

[查看高清视频](docs/showcase/videos/demo.mp4)

## 功能

| 采集范围 | 内容 |
| --- | --- |
| **搜索结果** | 作品列表、标题、作者、互动数据与链接 |
| **作品详情** | 正文、图片、视频、发布时间与互动数据 |
| **作品评论** | 已加载的评论内容 |
| **作者详情** | 作者资料、粉丝量、获赞等数据 |

同时支持公众号文章、飞书文档采集。

## 存储

| 存储方式 | 支持形式 |
| --- | --- |
| **Notion 数据库** | 搜索数据源、最近使用快捷选择 |
| **本地** | CSV、Markdown、媒体文件 |
| **飞书多维表格** | 保存到指定表格 |

## 界面截图

**搜索结果采集**

![搜索结果采集：关键词、作品列表与互动数据](docs/showcase/images/preview2.png)

**作者详情采集**

![作者详情采集：账号资料、粉丝量与作品列表](docs/showcase/images/preview3.png)

**选择保存位置**

![选择保存位置](docs/showcase/images/save-destination.png)

<sub>保存位置截图使用演示数据。</sub>

## 下载与使用

[**下载插件安装包 →**](https://github.com/ChaoJiDuiBiao/cjdb-web-crawler/releases)

也可以自行构建（需要先安装 Node.js 和 Git）：

```bash
git clone https://github.com/ChaoJiDuiBiao/cjdb-web-crawler.git
cd cjdb-web-crawler
npm ci
npm run build
```

打开 Chrome 的 `chrome://extensions`，开启“开发者模式”，点击“加载已解压的扩展程序”，选择 `output/抄级对标数据采集器-v2.0.0` 文件夹。刷新目标网页即可使用。

使用 Release 安装包时，先解压 ZIP，再加载其中包含 `manifest.json` 的文件夹。

## 交流与反馈

[提交问题或功能建议](https://github.com/ChaoJiDuiBiao/cjdb-web-crawler/issues)

<p align="center">
  <img src="docs/showcase/images/author-qr.png" width="240" alt="作者微信二维码">
  <br>交流学习欢迎扫码添加微信
</p>

## 使用声明

**仅供个人研究学习，严禁用于商业及其他违法用途。**
