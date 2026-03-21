# HongGuo Tool Framework

一个面向桌面工具方向演进的短剧资源管理框架，当前技术栈为 `React + Vite + TypeScript + Electron`。

这个项目当前提供的是通用桌面工作台和本地任务编排骨架，不包含任何第三方平台接口、内容解析或平台内容下载能力。它适合继续接入你自有的、已获授权的 `MP4` / `M3U8` 资源源，或者后续实现本地文件导入、合法下载执行器。

## 当前能力

- Electron 桌面窗口与预加载桥接
- 资源搜索与分类浏览
- 剧集详情与分辨率切换
- 单集加入队列 / 全部加入队列
- 本地模拟下载进度、暂停恢复、并发控制
- 原生下载目录选择与打开目录
- 用户配置写入 Electron `userData` 目录
- 手动导入合法资源元信息
- `localStorage` 持久化保存手动资源与任务队列
- 演示预览弹窗

## 设计边界

- 不接入红果短剧或任何第三方视频平台
- 不实现平台资源抓取、批量解析、绕过限制或批量下载
- 演示资源仅用于联调界面和任务状态

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

- `electron/main.cjs`: Electron 主进程，负责窗口、系统对话框和配置文件
- `electron/preload.cjs`: 安全的预加载桥，向前端暴露桌面 API
- `src/App.tsx`: 主界面、状态管理、任务队列逻辑
- `src/desktop.ts`: 桌面上下文与配置类型
- `src/catalog.ts`: 演示资源数据与类型定义
- `src/App.css`: 主界面样式
- `src/index.css`: 全局视觉变量和基础样式

## 后续可继续接的方向

- 真实下载执行层与失败重试
- 本地文件导入与目录扫描
- 合法直链下载器
- 下载日志与任务历史
- 自动更新与安装包签名
