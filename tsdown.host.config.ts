import type { UserConfig } from 'tsdown'

/**
 * Host 半打包：把 src/index.ts 编译成自包含的 lib/index.js。
 * 官方渠道（dsh plugin add / Web 插件页）安装的是本包自身的 lib/，宿主不会
 * 从 profile 解析本包的运行期依赖，因此这里内联 schemastery / zod /
 * @deepseek-ai/dsh-* 等 helper，只保留 node: 内建模块为外部依赖。
 */
export default {
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: { alwaysBundle: (id: string) => !id.startsWith('node:') },
  outputOptions: { entryFileNames: 'index.js' },
} satisfies UserConfig
