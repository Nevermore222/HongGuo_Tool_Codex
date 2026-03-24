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

## 夸克 Cookie 自动采集字段（本地运行）

你可以用脚本自动导出“已转存文件清单”CSV，再导入下载系统。

脚本：
- `scripts/export_quark_manifest.mjs`

使用方式（PowerShell）：

```powershell
$env:QUARK_COOKIE='这里放你自己的完整 Cookie'
$env:QUARK_ROOT_FID='0'          # 可选，默认 0（网盘根目录）
$env:QUARK_OUTPUT='D:\quark-manifest.csv'  # 可选，输出路径
node scripts/export_quark_manifest.mjs
```

输出字段包含：
- `drama_code`
- `drama_title`
- `episode_index`
- `file_name`
- `quark_file_id`
- `file_size`
- `pdir_fid`
- `updated_at`
- `preview_url`（预留）
- `download_url`（预留）
- `url_expire_at`（预留）

安全建议：
- 不要把 Cookie 发到聊天窗口或提交到 Git。
- 只在你自己的本机环境变量里临时设置，使用后及时清理。
- 该脚本仅用于读取你自己账号可访问的文件元数据。

## 已转存短剧：预览与下载（系统内）

当你已把某部短剧转存到自己的夸克网盘后，系统支持：
- 同步该剧分集（自动识别第1集、第2集...）
- 生成每集 `preview_url` 与 `download_url`
- 在详情面板直接 `预览 / 刷新链接 / 下载`
- 下载任务进入现有下载队列（支持并发、暂停、重试）

操作步骤：
1. 在“短剧查询总表”选中一部剧（如 `47924`）
2. 在右侧粘贴并保存夸克 Cookie（仅本机保存到 Electron userData）
3. 点击“同步本剧分集”
4. 同步完成后，直接对每一集点击预览或下载

说明：
- 链接可能过期，点击“刷新链接”可重新获取当前可用地址。
- 该能力只使用你账号可访问的数据，不处理未授权内容。

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
