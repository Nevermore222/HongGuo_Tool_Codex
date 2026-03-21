# 资源发现层说明

资源发现层的目标，是把“多部剧、多集元数据”的组织工作从手动单条录入里拆出来。
它不直接生成下载地址，而是先把资源目录导入到界面，再交给已有适配器层去解析最终的合法下载源。

## 适合的场景

- 你有一份团队内部维护的 JSON 资源目录
- 你有一个能返回资源目录 JSON 的内部 HTTP API
- 你想一次导入多部剧，而不是手动一条条录入
- 你希望资源展示元数据和下载解析逻辑分离

## 清单格式

入口模板见：

- [resource-library.template.json](/D:/HongGuo_AutoTools/manifest-templates/resource-library.template.json)

最外层结构：

```json
{
  "version": 1,
  "exportedAt": "2026-03-22T12:00:00.000Z",
  "series": []
}
```

内部 HTTP API 也返回同样的结构即可，响应体可以是：

- 带 `series` 字段的对象
- 或直接返回 `series` 数组

每个 `series` 条目至少需要这些字段：

- `title`
- `adapterId`
- `sourceId`

建议同时提供：

- `id`
- `category`
- `description`
- `tags`
- `totalEpisodes`
- `updatedAt`
- `sourceNote`
- `episodes`

## 字段说明

- `adapterId`
  资源展示层使用哪个适配器。必须和你在 [index.ts](/D:/HongGuo_AutoTools/src/adapters/custom/index.ts) 或内置注册表里已有的适配器一致。
- `sourceId`
  传给适配器的业务标识。通常是你内部资源库里的剧目 ID。
- `episodes`
  可选。用于覆盖每一集的标题、时长、大小标签和是否允许预览。
- `totalEpisodes`
  如果 `episodes` 没写全，界面会自动补齐剩余集数。

## 导入规则

- 按 `id` 合并
- 同一个 `id` 的新条目会覆盖旧条目
- 缺少 `title`、`adapterId` 或 `sourceId` 的条目会被判定为无效

## API 同步与缓存

界面中的“从 API 同步”会：

1. 用你填写的内部 API 地址发起请求
2. 按请求头 JSON 附带自定义头
3. 读取返回的资源库 JSON
4. 写入本地缓存
5. 再合并进当前资源目录

Electron 桌面模式下，缓存会写入用户数据目录中的：

- `discovery-library-cache.json`

浏览器预览模式下，缓存会写入本地 `localStorage`。

## 和手动资源的区别

- 手动资源
  更适合单部剧、URL 模板直连、快速测试
- 资源发现层
  更适合批量管理目录，把“展示元数据”与“下载解析逻辑”拆开

## 推荐接法

1. 先实现你自己的适配器
2. 准备资源库 JSON 清单
3. 在界面中导入资源库清单
4. 选择导入后的剧集并加入下载队列

## 合规边界

资源发现层只适合导入你有权使用的资源目录定义。
不要把它接到未授权的第三方平台抓取结果上。
