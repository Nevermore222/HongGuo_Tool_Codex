# HongGuo Tool Framework

一个面向桌面工具方向演进的短剧资源管理框架，当前技术栈为 `React + Vite + TypeScript + Electron`。

这个项目当前提供的是通用桌面工作台、真实直链下载执行层和可替换的数据源适配器骨架，不包含任何第三方平台接口、内容解析或平台内容下载能力。它适合继续接入你自有的、已获授权的 `MP4` / 本地文件资源源。

## 当前能力

- Electron 桌面窗口与预加载桥接
- 资源搜索与分类浏览
- 剧集详情与分辨率切换
- 单集加入队列 / 全部加入队列
- 真实下载执行层
- 直链 HTTP/HTTPS 文件下载
- 本地文件复制式下载
- 暂停 / 恢复 / 失败重试 / 并发控制
- 原生下载目录选择与打开目录
- 用户配置写入 Electron `userData` 目录
- 手动导入合法资源模板
- 浏览器模式下的队列模拟预览

## 设计边界

- 不接入红果短剧或任何第三方视频平台
- 不实现平台资源抓取、批量解析、绕过限制或批量下载
- 当前真实下载层只处理直接文件资源，不处理流媒体分片解析

## 适配器架构

当前的关键扩展点在 [src/sourceAdapters.ts](D:/HongGuo_AutoTools/src/sourceAdapters.ts)。

现有内置适配器：

- `demo-library`: 返回公开演示视频直链，用于验证整个下载链路
- `manual-template`: 把手动录入的模板解析成最终下载地址，是后续换源时最接近业务的一层

开发参考文件：

- 模板：[custom-direct-file.adapter.template.ts](/D:/HongGuo_AutoTools/adapter-templates/custom-direct-file.adapter.template.ts)
- 示例：[team-library.adapter.example.ts](/D:/HongGuo_AutoTools/adapter-examples/team-library.adapter.example.ts)
- 文档：[adapter-development.md](/D:/HongGuo_AutoTools/docs/adapter-development.md)

统一适配输出为：

- `taskId`
- `seriesId` / `episodeId`
- `resolution`
- `sourceUrl`
- `fileName`

也就是说，桌面下载执行层并不关心资源来自哪里，只关心适配器最终是否返回一个合法直链或本地文件路径。

## 模板令牌

手动模板当前支持：

- `{episode}`
- `{episodeIndex}`
- `{seriesId}`
- `{seriesTitle}`
- `{episodeTitle}`
- `{resolution}`

示例：

```text
https://example.com/drama/{episode}.mp4
```

```text
D:\media\series-{episodeIndex}.mp4
```

## 本地开发

```bash
npm install
npm run dev:desktop
```

这会同时启动 Vite 开发服务和 Electron 桌面窗口。

## 浏览器预览

```bash
npm run dev
```

## 构建

```bash
npm run build
npm run lint
```

## 桌面打包

```bash
npm run build:desktop
```

生成无安装的桌面构建目录。

```bash
npm run dist:win
```

生成 Windows 安装包。

## 代码结构

- `electron/main.cjs`: Electron 主进程、下载调度、文件保存、IPC
- `electron/preload.cjs`: 安全的预加载桥，向前端暴露桌面 API
- `src/App.tsx`: 主界面、下载任务交互、桌面配置
- `src/sourceAdapters.ts`: 适配器契约、内置适配器、手动模板解析
- `src/desktop.ts`: 桌面上下文、下载任务和 IPC 类型
- `src/catalog.ts`: 演示资源数据与类型定义

## 后续只需要补的地方

如果你要替换下载源，优先改这里：

1. 在 `src/sourceAdapters.ts` 增加新的适配器定义
2. 让适配器把你的业务数据转换成 `sourceUrl` 和 `fileName`
3. 如果有新的资源发现逻辑，再决定是否补新的资源列表生成逻辑

桌面壳、队列、并发、下载目录、失败重试这些层可以继续复用。
