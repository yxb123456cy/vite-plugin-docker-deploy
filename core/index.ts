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
        // 主机IP地址
        host: envConfig.servers[0].host,
        // SSH连接🔗端口
        port: envConfig.servers[0].port || 22,
        // 登录用户名
        username: envConfig.servers[0].username || 'root',
        // 登录密码
        password: envConfig.servers[0].password,
      })
        .then(async () => {
          await log(`🚀 登录服务器成功: SSH连接配置${JSON.stringify(envConfig.servers[0])}`)
          const dockerVersionResult = await ssh.execCommand('docker version')
          if (dockerVersionResult.stderr !== '') {
            await log(`❌ Docker未安装或未启动: ${dockerVersionResult.stderr}`)
            throw new Error(`❌ Docker未安装或未启动: ${dockerVersionResult.stderr}`)
          }
          else {
            await log(`🐳Docker版本信息: ${dockerVersionResult.stdout}`)
          }
          await log('🚀开始上传ZIP文件至服务器中...')
          let remoteZipPath = ''
          if (envConfig.servers[0].remoteDir && envConfig.servers[0].remoteDir.trim() !== '') {
            remoteZipPath = `${envConfig.servers[0].remoteDir}/${buildID}`
          }
          else {
            remoteZipPath = `/root/deploy/${buildID}`
          }
          try {
            await ssh.putFile(zipPath, `${remoteZipPath}/dist.zip`)
            await log(`🚀 上传ZIP文件至服务器成功: 本地zipPath${zipPath},远程服务器zipPath:${remoteZipPath}`)
            // 开始解压;
            const unzipResult = await ssh.execCommand(`unzip ${remoteZipPath}/dist.zip -d ${remoteZipPath}`)
            if (unzipResult.stderr !== '') {
              await log(`❌ 解压ZIP文件失败: ${unzipResult.stderr}`)
              throw new Error(`❌ 解压ZIP文件失败: ${unzipResult.stderr}`)
            }
            else {
              await log(`🚀 解压ZIP文件成功: ${remoteZipPath}/dist.zip`)
            }
            ssh.execCommand(`cd ${remoteZipPath}`) // 进入解压后的目录;
            const catDockerfileRes = await ssh.execCommand('cat Dockerfile')
            await log(`🚀 尝试读取Dockerfile文件结果: ${JSON.stringify(catDockerfileRes)}`)
            if (catDockerfileRes.stdout !== '') {
              // 开始构建镜像;

              await ssh.execCommand(`docker rm -f ${envConfig.containerName} &> error.log`)
              await ssh.execCommand(`docker rmi -f ${envConfig.imageName} &> error.log`)
              const imageBuildResult = await ssh.execCommand(`docker build -t ${`${envConfig.imageName}`} .`)
              if (imageBuildResult.stderr !== '') {
                await log(`❌ 构建镜像失败: ${imageBuildResult.stderr}`)
                throw new Error(`❌ 构建镜像失败: ${imageBuildResult.stderr}`)
              }
              else {
                await log(`🚀 构建镜像成功: ${envConfig.imageName}`)
                // 已经停止容器
                const runDockerResult = await ssh.execCommand(`docker run -d --name ${envConfig.containerName} -p 9750:80 ${envConfig.imageName}`)
                if (runDockerResult.stderr !== '') {
                  await log(`❌ 运行Docker容器失败: ${runDockerResult.stderr}`)
                  throw new Error(`❌ 运行Docker容器失败: ${runDockerResult.stderr}`)
                }
                else {
                  await log(`🚀 运行容器成功: ${envConfig.containerName}`)
                  await log(`🚀 容器运行状态: ${runDockerResult.stdout}`)
                  await log(`🚀 项目地址: ${envConfig.servers[0].host}:9750`)
                }
              }
            }
            else {
              await log('🚀 读取Dockerfile文件失败 或者不存在Dockerfile 停止部署')
              throw new Error('🚀 读取Dockerfile文件失败 或者不存在Dockerfile 停止部署')
            }
          }
          catch (err) {
            await log(`❌ 上传ZIP文件至服务器失败: ${err}`)
            throw new Error(`❌ 上传ZIP文件至服务器失败: ${err}`)
          }
        })
        .catch(async (err) => {
          await log(`❌ SSH连接🔗失败: ${err}`)
          throw new Error(`❌ SSH连接🔗失败: ${err}`)
        })
    },
  }
}
