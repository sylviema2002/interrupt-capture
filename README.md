# 中断快记

中断快记是一个很轻的浏览器插件：被临时事情打断时，只写一句话，它会记住当前页面和下一步，把记录写入你自己的飞书多维表格，并按时间提醒你回来。

它由马骁艺设计并发起，基于真实工作流需求，通过 Codex 辅助迭代开发。

## 浏览器支持

支持 Chrome、Edge，以及其他支持 Chrome 扩展的 Chromium 浏览器。暂不支持 Safari 和 Firefox。

## 主要功能

- 一句话记录被打断的工作，并自动抓取当前标签页标题和链接。
- 三类任务：中断任务、规划任务、待安排。
- 没有跨日信息时，默认归入中断任务，按设定间隔循环强提醒。
- 明确说出“明天”“后天”或具体日期时，归入规划任务，并创建飞书日程。
- 支持自然语言时间点和时间段，例如“明天九点半汇报”“8 月 9 日 10 点到 11 点整理周报”。
- 输入任务后按 Enter 才开始识别和写入，不再根据停顿自动提交。
- 本机辅助程序会托管飞书同步服务，并让提醒窗口尽量置前。
- 任务可完成、稍后提醒、暂停、恢复、转入待安排、加入或更改飞书日程。
- 删除已关联日程的任务时，会同步删除飞书日程，并把飞书表格状态改为“已删除”。

## 项目结构

```text
interrupt-capture-extension/
  浏览器插件源码
  feishu-sync-service.js           本机飞书同步服务
  windows-sync-service-v3.js       Windows 本机辅助服务
  windows-topmost-helper-v3.ps1    Windows 置顶提醒辅助脚本
  mac-sync-service.js              跨平台辅助服务预留
  mac-topmost-helper.js            跨平台提醒辅助脚本预留
  start-sync-service.cmd           本机辅助程序启动脚本
  start-sync-service.command       本机辅助程序启动脚本预留
  sync-config.example.json         飞书同步示例配置
  base-fields.json                 多维表格字段示例

dist/
  interrupt-capture-feishu-cli.zip 最新安装包
```

## 快速开始

推荐把 GitHub 地址交给 Codex、Claude Code、Cursor 等 AI 助手配置：

```text
请帮我从这个 GitHub 项目安装并配置“中断快记”浏览器插件：https://github.com/sylviema2002/interrupt-capture 。
请根据 README 和示例配置创建 sync-config.json，并注意不要上传或公开我的个人配置。
```

需要准备：

- Node.js
- lark-cli，并完成飞书账号登录
- 一个飞书多维表格
- `interrupt-capture-extension/sync-config.json`

`sync-config.json` 请从 `sync-config.example.json` 复制生成，不要直接改名覆盖示例文件。里面的 `baseToken` 是飞书多维表格文件编号，`tableId` 是具体表格编号，`serviceToken` 是插件和本机同步服务之间的本地口令。

不同电脑环境的本机辅助程序启动方式可能不同。建议把仓库地址交给 AI 助手，让它根据当前电脑环境选择合适的启动脚本，并保留你自己的 `sync-config.json`。

## 飞书字段

插件会自动补齐常用字段。建议表格包含：

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

## 数据和隐私

- 插件默认不上传个人记录到作者或第三方服务器。
- 记录只会写入你自己配置的飞书多维表格和飞书日程。
- 插件只读取当前活动标签页的标题和链接，不读取网页正文。
- `sync-config.json` 含有你的飞书表格配置和本地服务口令，不要提交到公开仓库。

## 反馈

遇到问题可以提交 GitHub Issue：

https://github.com/sylviema2002/interrupt-capture/issues/new

## 桌面入口

桌面版会作为浏览器插件之外的另一个入口继续推进，用来接住 Excel、Word、PPT、WPS、微信、飞书客户端、PDF 等非浏览器场景。当前设计草案见 `DESKTOP_CAPTURE.md`。

## 许可证

Copyright (c) 2026 马骁艺。

本项目采用 MIT License 开源。开源意味着作者授权他人按协议使用、复制、修改和分发，不代表作者放弃版权或原创署名。任何复制、分发或二次开发都应保留本项目的版权声明和许可证文本。
