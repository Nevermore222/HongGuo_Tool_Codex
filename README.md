# HongGuo AutoTools

短剧资源管理与下载桌面工具（Electron + React + TypeScript）。

当前版本以 **Excel 模板导入（短剧查询表格）** 为主数据源：
- 导入 `(短剧查询)表格视图.xlsx`
- 解析剧名与网盘超链接（夸克/百度）
- 写入 SQLite 数据库
- 在前台以“短剧查询总表”方式展示与检索

## 核心能力

- Excel 模板解析（读取工作表与超链接）
- SQLite 持久化与幂等导入（重复导入自动更新）
- 同步模式 `replace`（可清理模板中已下线数据）
- 导入批次历史（新增/更新/移除/跳过统计）
- 前台高密度表格视图（分页、搜索、打开网盘链接）
- 下载队列（针对直链/本地文件源）

## 技术栈

- React 19
- Vite
- TypeScript
- Electron
- Node `node:sqlite`

## 快速开始

```bash
npm install
npm run dev:desktop
```

说明：
- `npm run dev` 只启动浏览器预览，不会读取 Electron `userData` 下的数据库。
- 请使用 `npm run dev:desktop` 运行桌面模式，才能使用 Excel 导入和数据库功能。

## Excel 导入流程

1. 启动桌面模式：`npm run dev:desktop`
2. 在界面中点击：`导入短剧查询 Excel`
3. 选择文件：`(短剧查询)表格视图.xlsx`
4. 导入完成后，前台“短剧查询总表”会显示数据

导入结果会记录：
- `importedRows`
- `insertedRows`
- `updatedRows`
- `removedRows`
- `skippedRows`

## SQLite 数据库位置

默认路径（Windows）：

`C:\Users\Administrator\AppData\Roaming\hongguo-autotools\short-drama-library.db`

说明：
- 这是 Electron `app.getPath('userData')` 下的数据库文件。
- 如果更换系统用户，路径会对应变化。

## 主要数据表

- `short_drama_resources`
  - 短剧主数据（编号、名称、夸克/百度链接、更新时间等）
- `short_drama_import_batches`
  - 导入批次日志（新增/更新/移除/跳过、导入时间、来源文件）

## 常用命令

```bash
npm run dev
npm run dev:desktop
npm run build
npm run lint
npm run build:desktop
npm run dist:win
```

## 关键文件

- `electron/shortDramaImport.cjs`：Excel 解析 + SQLite 导入 + 批次记录
- `electron/main.cjs`：Electron 主进程 IPC
- `electron/preload.cjs`：前台桥接 API
- `src/App.tsx`：前台主界面（总表视图/详情/操作）
- `src/App.css`：前台样式
- `src/desktop.ts`：前台类型定义

## 排障

### 导入成功但前台没显示

- 确认运行的是 `npm run dev:desktop`，不是纯浏览器 `npm run dev`
- 重新启动 Electron 窗口（主进程改动后需要重启）
- 点击总表区域“刷新”按钮

### 只看到演示数据

- 说明当前不是桌面模式或未完成 Excel 导入

## 合规说明

本项目仅用于管理你有权使用的资源信息与链接，不包含对未授权内容的抓取或绕过限制下载逻辑。
