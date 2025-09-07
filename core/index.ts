import type { Plugin } from 'vite'
import type { DockerDeployOptions } from './type'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import archiver from 'archiver'
import { NodeSSH } from 'node-ssh'
// 现在已经可以成功生成部署日志  ZIP文件(包含前端项目打包生成的dist目录以及DockerFile);
const appendFile = promisify(fs.appendFile)
// 创建SSH实例
const ssh = new NodeSSH()
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
      // 先实现单服务器部署; 现 使用本地虚拟机进行测试;
      ssh.connect({
        host: '192.168.136.130',
        port: 22,
        password: '123456',
      })
        .then(async () => {
          const dockerVersionResult = await ssh.execCommand('docker version')
          console.warn('🐳 docker version:', dockerVersionResult.stdout)
        })
    },
  }
}
