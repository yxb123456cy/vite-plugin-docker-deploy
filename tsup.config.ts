import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['core/index.ts'], // 插件入口
  format: ['cjs', 'esm'], // 输出 CommonJS + ESM
  dts: true, // 生成类型声明
  clean: true, // 打包前清理
  minify: false, // 插件一般不需要压缩
  target: 'node18', // ssh2、fs 等需要 Node 环境
})
