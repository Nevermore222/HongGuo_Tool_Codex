# 资源发现层说明

资源发现层的目标，是把“多部剧、多集元数据”的组织工作从手动单条录入里拆出来。
它不直接生成下载地址，而是先把资源目录导入到界面，再交给已有适配器层去解析最终的合法下载源。

## 适合的场景

- 你有一份团队内部维护的 JSON 资源目录
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
