import type { AdapterDefinition } from '../types'

/**
 * 在这里注册你自己的业务适配器。
 *
 * 推荐做法：
 * 1. 把自定义适配器文件放到 src/adapters/custom/
 * 2. 在这里 import
 * 3. 加入 customAdapters 数组
 */
export const customAdapters: AdapterDefinition[] = []
