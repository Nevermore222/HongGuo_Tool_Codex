# 适配器开发说明

这份说明的目标很简单：让你新增一个下载源时，只需要关心“如何拿到授权直链或本地文件路径”，而不用碰桌面壳、任务队列或下载执行层。

## 1. 最小契约

适配器最终要返回这些字段：

- `taskId`
- `adapterId`
- `seriesId`
- `seriesTitle`
- `episodeId`
- `episodeTitle`
- `resolution`
- `sourceUrl`
- `fileName`

其中最关键的是：

- `sourceUrl`: 真实可访问的授权下载地址，或者本地文件路径
- `fileName`: 最终保存到下载目录时使用的文件名

## 2. 开发入口

参考文件：

- 模板：[custom-direct-file.adapter.template.ts](/D:/HongGuo_AutoTools/adapter-templates/custom-direct-file.adapter.template.ts)
- 示例：[team-library.adapter.example.ts](/D:/HongGuo_AutoTools/adapter-examples/team-library.adapter.example.ts)
- 注册位置：[sourceAdapters.ts](/D:/HongGuo_AutoTools/src/sourceAdapters.ts)

## 3. 接入步骤

1. 复制模板文件，改成你自己的适配器名。
2. 在 `resolveEpisodeDownload` 里把业务参数解析成 `sourceUrl`。
3. 在 [sourceAdapters.ts](/D:/HongGuo_AutoTools/src/sourceAdapters.ts) 里导入并注册。
4. 给你的资源条目填上对应的 `adapterId` 和 `sourceId`。

## 4. 常见接法

适合接入的源：

- 你自己的对象存储直链
- 你自己的文件服务器
- 局域网 NAS 目录映射
- 团队内部维护的 JSON / 数据库索引
- 本地磁盘文件模板

不应该接入的源：

- 第三方平台抓取结果
- 需要绕过限制才能访问的地址
- 未授权的视频内容地址

## 5. 一个最短示意

```ts
const myAdapter: AdapterDefinition = {
  id: 'my-source',
  name: '我的源',
  description: '按集数拼接授权直链',
  resolveEpisodeDownload: ({ series, episode, resolution }) => ({
    taskId: `task-${series.sourceId}-${episode.index}-${resolution}`,
    adapterId: 'my-source',
    seriesId: series.id,
    seriesTitle: series.title,
    episodeId: episode.id,
    episodeTitle: episode.title,
    resolution,
    sourceUrl: `https://files.example.com/${series.sourceId}/${episode.index}-${resolution}.mp4`,
    fileName: `${series.title}-${episode.title}-${resolution}.mp4`,
  }),
}
```

## 6. 什么时候需要改别的层

通常不需要改。

只有下面两种情况，才建议继续扩展系统：

- 你不仅要“下载”，还要“发现资源列表”
- 你的源不是单个文件，而是另一种合法格式，需要新的下载执行器

如果只是替换成你自己的文件源，优先只改适配器层。  
