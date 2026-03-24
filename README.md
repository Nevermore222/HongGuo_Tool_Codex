# HongGuo AutoTools

短剧资源管理与下载桌面工具，基于 `Electron + React + TypeScript`。

当前版本已经拆成两种角色：
- `客户端`：默认简洁界面，适合发给朋友安装使用。
- `管理端`：你自己使用，负责 Excel 导入、夸克 Cookie、远程服务、自动转存和分集同步。

## 系统概览

主数据源来自 Excel 模板 `(短剧查询)表格视图.xlsx`：
- 解析短剧编号、剧名、夸克链接、百度链接
- 写入本地 SQLite 数据库
- 支持重复导入自动更新
- 支持客户端通过管理端远程读取资源

客户端和管理端的职责：
- `客户端`：搜索短剧、进入详情、触发请求准备资源、预览、下载、查看下载队列
- `管理端`：导入 Excel、保存夸克 Cookie、开启远程服务、自动转存夸克分享、同步分集、代理预览与下载

## 主要能力

- Excel 模板导入与幂等更新
- SQLite 持久化
- 夸克 Cookie 本机保存
- 夸克分享链接自动转存
- 分集自动同步
- 封面图识别、缓存与详情页展示
- 桌面端预览播放
- 批量下载、下载队列、下载历史、暂停、恢复、失败重试
- 分集多选、下载选中、全选/全不选
- 队列多选、批量暂停/恢复/移除
- 客户端默认可回落连接本机管理端

## 环境要求

- Node.js 24+
- npm 10+
- Windows 桌面环境

说明：
- 项目当前主要按 Windows 桌面端使用方式设计与验证。
- Electron 用户数据默认写入 `%APPDATA%\hongguo-autotools`

## 安装

```bash
npm install
```

## 启动方式

### 1. 浏览器预览

```bash
npm run dev
```

用途：
- 只看前端页面
- 不读取 Electron `userData`
- 不可用 Excel 导入、夸克 Cookie、远程服务、本地数据库

### 2. 客户端开发模式

```bash
npm run dev:desktop
```

用途：
- 默认启动 `客户端界面`
- 用于模拟朋友安装后的使用体验
- 如果本机已开启管理端远程服务，且客户端没有手动填写管理端地址，会默认连接 `http://127.0.0.1:<管理端端口>`

### 3. 管理端开发模式

```bash
npm run dev:desktop:admin
```

用途：
- 启动完整 `管理端界面`
- 用于 Excel 导入、夸克 Cookie 保存、自动转存、远程服务配置

### 4. 仅前端管理端调试

```bash
npm run dev:web:admin
```

### 5. 仅 Electron 客户端壳调试

```bash
npm run dev:electron
```

### 6. 仅 Electron 管理端壳调试

```bash
npm run dev:electron:admin
```

说明：
- `dev:electron` / `dev:electron:admin` 已内置 `NODE_OPTIONS=--max-old-space-size=8192`
- 主进程改动后，需要完整重启 Electron，热更新不一定生效

## 构建与打包

### 构建前端

```bash
npm run build
npm run build:client
npm run build:admin
```

说明：
- `npm run build` 等于 `客户端构建`
- `npm run build:admin` 构建管理端前端资源

### 构建桌面目录

```bash
npm run build:desktop
npm run build:desktop:admin
```

### 打 Windows 安装包

```bash
npm run dist:win
npm run dist:win:client
npm run dist:win:admin
```

建议：
- 发给朋友用：`npm run dist:win`
- 你自己维护用：`npm run dist:win:admin`

## 首次使用流程

### 管理端首次配置

1. 启动管理端：`npm run dev:desktop:admin`
2. 导入 Excel：点击 `导入短剧查询 Excel`
3. 选择 `(短剧查询)表格视图.xlsx`
4. 在短剧详情中保存夸克 Cookie
5. 在桌面设置中开启 `管理端远程服务`
6. 设置端口和访问令牌

建议：
- 端口默认可用 `39095`
- 访问令牌建议开启，不要留空

### 客户端首次配置

1. 启动客户端：`npm run dev:desktop`
2. 如果和管理端在同一台机器：
   - 管理端远程服务已开启时，客户端会默认连接 `127.0.0.1`
   - 不需要手工填写管理端地址
3. 如果客户端在朋友电脑：
   - 顶部填写你的管理端地址，例如 `http://192.168.1.8:39095`
   - 如已启用令牌，同时填写访问令牌
   - 点击 `保存连接`

## Excel 导入说明

数据源模板：
- `(短剧查询)表格视图.xlsx`

导入内容：
- `drama_code`
- `drama_name`
- `quark_url`
- `baidu_url`

导入特点：
- 重复导入同编号短剧时自动更新
- `replace` 模式下可清理模板中已下线数据
- 导入批次会记录新增、更新、移除、跳过统计

## 自动转存与分集同步

客户端进入某部短剧详情页后，如果管理端还没有该剧的已同步分集，会自动触发：

1. 查询你的夸克网盘中是否已经有这部短剧
2. 若已有，直接同步分集
3. 若没有，则读取 Excel 中的 `quark_url`
4. 自动调用夸克分享转存接口，转存到你的网盘目录
5. 转存完成后自动扫描视频文件
6. 扫描目录内图片文件并挑选封面候选图
7. 将封面缓存进本地数据库，避免详情页重复请求夸克
8. 生成每集 `preview_url` 和 `download_url`
9. 客户端轮询后展示可预览、可下载的分集

默认转存目录：

```text
/duanju/<短剧编号>
```

例如：

```text
/duanju/47920
```

## 客户端默认行为

如果满足以下条件：
- 当前是 `客户端模式`
- 当前运行在 Electron 桌面端
- 没有手工填写 `管理端地址`
- 本机管理端远程服务已开启

则客户端默认会连接：

```text
http://127.0.0.1:<remoteServicePort>
```

这意味着你在同一台机器上测试时：
- 不需要再单独填写管理端地址
- 点进详情页就会自动触发管理端的准备资源流程

## 预览与下载说明

预览和下载都不会直接暴露夸克 Cookie 给朋友客户端。

当前方案：
- `客户端` 发起预览/下载请求
- `管理端` 通过本地或远程媒体代理请求夸克
- 自动补齐 `Cookie + Referer`
- 再把视频流返回给客户端播放器或下载器

好处：
- 朋友客户端不需要保存你的夸克 Cookie
- 预览和下载都统一走你的管理端

## 封面图说明

短剧转存并同步时，系统会递归扫描该剧目录中的图片文件：
- 支持 `jpg`、`jpeg`、`png`、`webp`、`gif`、`bmp`
- 不再要求封面图必须排在文件夹首位
- 会优先匹配类似 `0.jpg`、`cover.*`、`poster.*`、包含“封面/海报”的图片名称

同步成功后：
- 封面元数据写入 `short_drama_resources`
- 封面图片二进制缓存写入 `short_drama_cover_cache`
- 客户端详情页优先直接读取数据库缓存封面

这样做的目的：
- 切换详情页时不需要重复请求夸克图片
- 同一部短剧封面只在首次同步或刷新时抓取一次
- 远程客户端也可以通过管理端直接拿到缓存封面

远程封面接口：

```text
GET /api/short-dramas/:code/cover
```

本地桌面端封面数据默认来自 SQLite 缓存，不依赖浏览器缓存。

## 客户端下载能力

客户端详情页当前支持：
- 单集 `预览`
- 单集 `下载`
- `全部下载`
- `下载未入队`
- `下载选中`
- `全选`
- `全不选`

右侧任务区支持两个页签：
- `下载队列`
- `下载历史`

说明：
- `下载队列` 展示当前任务状态、进度、暂停/恢复、打开位置
- `下载队列` 支持多选任务后的 `暂停选中 / 恢复选中 / 移除选中`
- 每条任务也支持单独 `暂停或恢复 / 移除 / 打开目录`
- `下载历史` 展示已记录的下载日志，可导出或清空
- 批量下载使用稳定任务 ID，同一分辨率下同一集不会重复入队

## 远程服务说明

管理端开启远程服务后，会提供以下能力：
- 短剧列表读取
- 单剧分集读取
- 请求准备资源
- 夸克媒体代理

客户端会用到的核心地址：

```text
GET  /api/health
GET  /api/short-dramas
GET  /api/short-dramas/:code/cover
GET  /api/short-dramas/:code/episodes
GET  /api/short-dramas/:code/request
POST /api/short-dramas/:code/request
GET  /api/quark-media?target=...
```

## SQLite 数据库

默认路径：

```text
%APPDATA%\hongguo-autotools\short-drama-library.db
```

主要表：
- `short_drama_resources`
- `short_drama_import_batches`
- `short_drama_episodes`
- `short_drama_cover_cache`

当前 `short_drama_resources` 额外记录：
- `save_status`
- `save_requested_at`
- `save_completed_at`
- `save_error`
- `saved_root_fid`
- `cover_file_id`
- `cover_file_name`
- `cover_url`

`short_drama_cover_cache` 额外存储：
- `drama_code`
- `mime_type`
- `image_blob`
- `source_file_id`
- `source_file_name`
- `updated_at`

## 导出夸克清单脚本

你可以导出自己夸克网盘中的已保存文件清单：

```bash
npm run quark:export
npm run short-drama:prefetch-top
```

PowerShell 示例：

```powershell
$env:QUARK_COOKIE='这里放你自己的完整 Cookie'
$env:QUARK_ROOT_FID='0'
$env:QUARK_OUTPUT='D:\quark-manifest.csv'
node scripts/export_quark_manifest.mjs
```

注意：
- 该脚本只用于你自己的账号数据导出
- 不要把 Cookie 写入 Git 或聊天记录

## 预转存前 2000 部短剧

为了让客户端首屏和详情页更快展示封面，并减少首次点击详情页时的等待，可以先做一轮预转存与封面缓存。

默认命令：

```bash
npm run short-drama:prefetch-top
```

默认行为：
- 按短剧编号倒序处理前 `2000` 部
- 若网盘中已有目录，则直接同步分集并缓存封面
- 若网盘中没有目录，则尝试用 Excel 中的 `quark_url` 自动转存
- 每部短剧之间默认延迟 `800ms`

可用环境变量：

```powershell
$env:SHORT_DRAMA_PREFETCH_LIMIT='2000'
$env:SHORT_DRAMA_PREFETCH_DELAY_MS='800'
npm run short-drama:prefetch-top
```

补充：
- 这个命令适合在管理端机器上运行
- 批量预转存耗时较长，建议独立开 PowerShell 跑
- 如果夸克空间不足、分享失效或接口限流，会在输出日志中显示失败原因

## 常用命令总览

```bash
npm run dev
npm run dev:desktop
npm run dev:desktop:admin
npm run dev:web:admin
npm run dev:electron
npm run dev:electron:admin
npm run build
npm run build:client
npm run build:admin
npm run build:desktop
npm run build:desktop:admin
npm run dist:win
npm run dist:win:client
npm run dist:win:admin
npm run lint
npm run quark:export
npm run short-drama:prefetch-top
```

## 注意事项

- 管理端和客户端分离打包，不要把管理端安装包发给朋友
- 夸克 Cookie 只应保存在管理端机器上
- 主进程改动后需要重启 Electron，不能只看前端热更新
- 夸克下载直链会过期，必要时需要刷新链接
- 分享链接如果失效、被删、或需要提取码但未提供，自动转存会失败
- 自动转存依赖你自己的夸克账号剩余空间
- 如果你的网盘空间不足，管理端无法完成转存，客户端会看见失败状态
- 封面图会缓存进本地 SQLite，对应数据库体积会随着已同步短剧数量增长
- 预转存前 2000 部前，建议先确认夸克账号空间与本机磁盘空间都足够

## 排障

### 1. 客户端点进详情页没有触发转存

检查以下几点：
- 当前是否真的是 `客户端模式`
- 管理端是否已开启远程服务
- 客户端是否连接到了正确的管理端地址
- 如果在同机测试，管理端远程服务是否已开启
- 该短剧是否已有同步分集；如果已经同步，不会重复触发转存

### 2. 客户端一直显示“正在加载分集”

- 管理端可能正在转存或同步，等待几秒后会轮询更新
- 检查管理端远程服务是否可访问
- 检查访问令牌是否正确

### 3. 预览失败

- 先尝试刷新链接
- 确认管理端可正常访问夸克
- 确认管理端夸克 Cookie 仍有效

### 4. 下载失败，HTTP 412

- 说明夸克请求缺少有效 Cookie/Referer 或链接已过期
- 确认管理端 Cookie 有效
- 在管理端重新刷新链接后再下载

### 5. 自动转存失败

常见原因：
- 分享链接失效
- 分享内容被删除
- 需要提取码但链接中没有 `pwd`
- 夸克接口异常
- 你的夸克网盘空间不足

### 6. 导入成功但前台没显示

- 确认运行的是 Electron 桌面模式，不是纯浏览器模式
- 重启 Electron
- 在列表页点击刷新

## 关键文件

- `electron/main.cjs`
- `electron/quarkDrive.cjs`
- `electron/shortDramaImport.cjs`
- `electron/preload.cjs`
- `src/App.tsx`
- `src/App.css`
- `src/desktop.ts`

## 合规说明

本项目仅用于管理你有权访问、保存和下载的资源链接与元数据。
不应将未授权内容、账号凭证或共享 Cookie 分发给第三方客户端。
