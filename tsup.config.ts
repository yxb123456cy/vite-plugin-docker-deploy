import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['core/index.ts'], // 插件入口文件
  format: ['cjs', 'esm'], // 输出 CommonJS + ESModule
  dts: true, // 生成类型声明
  splitting: false, // Vite 插件一般不需要 code splitting
  sourcemap: true, // 生成 sourcemap，方便调试
  clean: true, // 打包前清理 dist
  minify: false, // 插件库无需压缩，方便调试
  target: 'node18', // 插件运行在 Node 环境
  outDir: 'dist', // 输出目录
})
