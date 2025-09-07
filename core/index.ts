import type { Plugin } from 'vite'
import type { DockerDeployOptions } from './type'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import archiver from 'archiver'

const appendFile = promisify(fs.appendFile)
// Vite-plugin-docker-deploy核心文件
export default function dockerDeploy(options: DockerDeployOptions):
Plugin {
  return {
    name: 'vite-plugin-docker-deploy',
    apply: 'build',

    async closeBundle() {
      const envConfig = options.envs[options.targetEnv]
      if (!envConfig) {
        throw new Error(`未找到环境配置: ${options.targetEnv}`)
      }
      // targetEnv已经可以获取;
      const buildID = Date.now()
      const logFile = path.resolve(
        options.logDir || process.cwd(),
        `vite-plugin-docker-deploy.${options.targetEnv}.${buildID}.log`,
      )
      const log = async (msg: string) => {
        const fullMsg = `[${new Date().toISOString()}] ${msg}\n`
        await appendFile(logFile, fullMsg)
        options.onProgress?.(msg)
        console.warn(msg)
      }
      await log(`🚀 开始部署项目 环境: ${options.targetEnv}`)

      // 打包 dist + Dockerfile
      const zipPath = path.resolve(process.cwd(), `deploy_${buildID}.zip`)
      await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(zipPath)
        const archive = archiver('zip')
        archive.pipe(output)
        archive.directory('dist', 'dist')
        archive.file('Dockerfile', { name: 'Dockerfile' })
        archive.finalize()
        output.on('close', () => resolve())
        archive.on('error', reject)
      })
      await log(`📦 打包 dist + Dockerfile 完成 -> ${zipPath}`)
    },
  }
}
