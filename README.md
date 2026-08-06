# 中断快记

中断快记是一个很轻的浏览器插件：被临时事情打断时，只写一句话，它会记住当前页面和下一步，按时间提醒你回来。

它由马骁艺设计并发起，基于真实工作流需求，通过 Codex 辅助迭代开发。

## 版本

| 版本 | 当前版本 | 数据保存在哪里 | 适合谁 |
| --- | --- | --- | --- |
| 本地版 | 1.0.4 | 只保存在本机浏览器里，不写入飞书 | 普通用户，想马上安装使用 |
| 飞书同步版 | 1.0.4 | 写入你自己的飞书多维表格；规划任务可同步到飞书日程 | 已有飞书 CLI、Codex 或其他 AI 助手，想长期沉淀记录 |

浏览器支持：Chrome、Edge，以及其他支持 Chrome 扩展的 Chromium 浏览器。暂不支持 Safari 和 Firefox。

## 主要功能

- 一句话记录被打断的工作，并自动抓取当前标签页标题和链接。
- 三类任务：中断任务、规划任务、待安排。
- 没有跨日信息时，默认归入中断任务，按设定间隔循环强提醒。
- 明确说出“明天”“后天”或具体日期时，归入规划任务，并创建飞书日程。
- 支持自然语言时间点和时间段，例如“明天 9 点整理合同”“8 月 9 日 10 点到 11 点整理周报”。
- 语音输入可配合 Windows `Win + H` 使用；文本完整后自动写入。
- Windows 飞书同步版提供本机辅助程序，托管同步服务，并让提醒窗口尽量置顶。
- 任务可完成、稍后提醒、暂停、恢复、转入待安排、加入或更改飞书日程。
- 删除已关联日程的任务时，会同步删除飞书日程，并把飞书表格状态改为“已删除”。
- 本地版保留“复制未完成”“导出全部数据”“清理已完成”。

## 项目结构

```text
interrupt-capture-extension/
  飞书同步版插件源码
  feishu-sync-service.js           本机飞书同步服务
  windows-sync-service-v3.js       Windows 本机辅助服务
  windows-topmost-helper-v3.ps1    Windows 置顶提醒辅助脚本
  sync-config.example.json         飞书同步示例配置
  base-fields.json                 多维表格字段示例

interrupt-capture-local-only/
  本地版插件源码，不连接飞书

dist/
  interrupt-capture-feishu-cli.zip
  interrupt-capture-local-only.zip
```

## 快速开始

### 飞书同步版

推荐把 GitHub 地址交给 Codex、Claude Code、Cursor 等 AI 助手配置：

```text
请帮我从这个 GitHub 项目安装并配置“中断快记”飞书同步版浏览器插件：https://github.com/sylviema2002/interrupt-capture 。
```

需要准备：

- Node.js
- lark-cli，并完成飞书账号登录
- 一个飞书多维表格
- `interrupt-capture-extension/sync-config.json`

`sync-config.json` 请从 `sync-config.example.json` 复制生成，不要直接改名覆盖示例文件。里面的 `baseToken` 是飞书多维表格文件编号，`tableId` 是具体表格编号，`serviceToken` 是插件和本机同步服务之间的本地口令。

### 本地版

1. 解压 `dist/interrupt-capture-local-only.zip`。
2. 打开 Chrome 或 Edge 扩展程序页面。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择 `interrupt-capture-local-only` 文件夹。
5. 点插件图标，先点“测试提醒”。

## 飞书字段

飞书同步版会自动补齐常用字段。建议表格包含：

- 内容
- 来源标题
- 来源链接
- 状态
- 记录时间
- 完成时间
- 插件记录ID
- 任务类型
- 日程开始时间
- 日程结束时间
- 日程状态

## 更新方式

开发者模式安装的浏览器插件不会自动从 GitHub 或飞书附件更新。已安装用户需要下载新版安装包，替换本地插件文件夹后，在 Chrome 或 Edge 扩展程序页面点击“重新加载”。

## 数据和隐私

- 插件默认不上传个人记录到作者或第三方服务器。
- 本地版只保存在浏览器本地，除非你主动导出。
- 飞书同步版只会写入你自己配置的飞书多维表格和飞书日程。
- 插件只读取当前活动标签页的标题和链接，不读取网页正文。
- `sync-config.json` 含有你的飞书表格配置和本地服务口令，不要提交到公开仓库。

## 许可证

Copyright (c) 2026 马骁艺。

本项目采用 MIT License 开源。开源意味着作者授权他人按协议使用、复制、修改和分发，不代表作者放弃版权或原创署名。任何复制、分发或二次开发都应保留本项目的版权声明和许可证文本。
