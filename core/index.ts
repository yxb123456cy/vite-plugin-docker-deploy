import type { Plugin } from 'vite'
import type { DockerDeployOptions } from './type'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import archiver from 'archiver'
import { NodeSSH } from 'node-ssh'

const appendFile = promisify(fs.appendFile)

// Vite-plugin-docker-deploy核心文件
export default function dockerDeploy(options: DockerDeployOptions): Plugin {
  return {
    name: 'vite-plugin-docker-deploy',
    apply: 'build',

    async closeBundle() {
      const envConfig = options.envs[options.targetEnv]
      if (!envConfig) {
        throw new Error(`未找到环境配置: ${options.targetEnv}`)
      }

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

      const ssh = new NodeSSH()
      let zipPath = ''

      try {
        await log(`🚀 开始部署项目 环境: ${options.targetEnv}`)

        // 打包 dist + Dockerfile
        zipPath = await createDeploymentZip(buildID, log)

        // 连接服务器并部署
        await connectAndDeploy(ssh, envConfig, zipPath, buildID, log)

        await log('🎉 部署完成！')
      }
      catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        await log(`❌ 部署失败: ${errorMsg}`)
        throw error
      }
      finally {
        // 清理资源
        await cleanup(ssh, zipPath, log)
      }
    },
  }
}

// 创建部署ZIP文件
async function createDeploymentZip(buildID: number, log: (msg: string) => Promise<void>): Promise<string> {
  const zipPath = path.resolve(process.cwd(), `deploy_${buildID}.zip`)

  return new Promise<string>((resolve, reject) => {
    const output = fs.createWriteStream(zipPath)
    const archive = archiver('zip', { zlib: { level: 9 } }) // 最高压缩级别

    archive.pipe(output)

    // 检查文件是否存在
    if (!fs.existsSync('dist')) {
      reject(new Error('dist目录不存在，请先执行构建'))
      return
    }

    if (!fs.existsSync('Dockerfile')) {
      reject(new Error('Dockerfile不存在'))
      return
    }

    archive.directory('dist', 'dist')
    archive.file('Dockerfile', { name: 'Dockerfile' })

    archive.finalize()

    output.on('close', async () => {
      await log(`📦 打包完成 -> ${zipPath} (${archive.pointer()} bytes)`)
      resolve(zipPath)
    })

    archive.on('error', reject)
    output.on('error', reject)
  })
}

// 连接服务器并执行部署
async function connectAndDeploy(
  ssh: NodeSSH,
  envConfig: any,
  zipPath: string,
  buildID: number,
  log: (msg: string) => Promise<void>,
) {
  const server = envConfig.servers[0]

  // 连接SSH
  await ssh.connect({
    host: server.host,
    port: server.port || 22,
    username: server.username || 'root',
    password: server.password,
    readyTimeout: 30000, // 30秒超时
  })

  await log(`🚀 SSH连接成功: ${server.host}:${server.port || 22}`)

  // 检查Docker环境
  await checkDockerEnvironment(ssh, log)

  // 上传并解压文件
  const remoteDir = await uploadAndExtract(ssh, server, zipPath, buildID, log)

  // 构建和运行Docker容器
  await buildAndRunContainer(ssh, envConfig, remoteDir, log)
}

// 检查Docker环境
async function checkDockerEnvironment(ssh: NodeSSH, log: (msg: string) => Promise<void>) {
  const dockerVersionResult = await ssh.execCommand('docker version --format "{{.Server.Version}}"')

  if (dockerVersionResult.code !== 0) {
    throw new Error(`Docker未安装或未启动: ${dockerVersionResult.stderr}`)
  }

  await log(`🐳 Docker版本: ${dockerVersionResult.stdout.trim()}`)
}

// 上传并解压文件
async function uploadAndExtract(
  ssh: NodeSSH,
  server: any,
  zipPath: string,
  buildID: number,
  log: (msg: string) => Promise<void>,
): Promise<string> {
  const remoteDir = server.remoteDir?.trim() || '/root/deploy'
  const remoteBuildDir = `${remoteDir}/${buildID}`
  const remoteZipPath = `${remoteBuildDir}/dist.zip`

  // 创建远程目录
  await ssh.execCommand(`mkdir -p ${remoteBuildDir}`)

  await log('🚀 开始上传ZIP文件...')

  // 上传文件
  await ssh.putFile(zipPath, remoteZipPath)
  await log(`📤 上传完成: ${remoteZipPath}`)

  // 解压文件
  const unzipResult = await ssh.execCommand(`cd ${remoteBuildDir} && unzip -o dist.zip`)

  if (unzipResult.code !== 0) {
    throw new Error(`解压失败: ${unzipResult.stderr}`)
  }

  await log(`📦 解压完成: ${remoteBuildDir}`)

  // 验证Dockerfile存在
  const checkDockerfile = await ssh.execCommand(`cd ${remoteBuildDir} && test -f Dockerfile`)
  if (checkDockerfile.code !== 0) {
    throw new Error('Dockerfile不存在于解压后的目录中')
  }

  return remoteBuildDir
}

// 构建和运行Docker容器
async function buildAndRunContainer(
  ssh: NodeSSH,
  envConfig: any,
  remoteDir: string,
  log: (msg: string) => Promise<void>,
) {
  const { imageName, containerName } = envConfig
  const port = envConfig.port || 9750

  await log('🏗️ 开始构建Docker镜像...')

  // 停止并删除旧容器和镜像（忽略错误）
  await ssh.execCommand(`docker rm -f ${containerName} 2>/dev/null || true`)
  await ssh.execCommand(`docker rmi -f ${imageName} 2>/dev/null || true`)

  // 构建镜像
  const buildResult = await ssh.execCommand(`cd ${remoteDir} && docker build -t ${imageName} .`)

  if (buildResult.code !== 0) {
    throw new Error(`构建镜像失败: ${buildResult.stderr}`)
  }

  await log(`🎯 镜像构建成功: ${imageName}`)

  // 运行容器
  const runResult = await ssh.execCommand(
    `docker run -d --name ${containerName} -p ${port}:80 --restart unless-stopped ${imageName}`,
  )

  if (runResult.code !== 0) {
    throw new Error(`容器启动失败: ${runResult.stderr}`)
  }

  await log(`🚀 容器启动成功: ${containerName}`)
  await log(`🌐 访问地址: http://${envConfig.servers[0].host}:${port}`)

  // 验证容器状态
  const statusResult = await ssh.execCommand(`docker ps --filter name=${containerName} --format "table {{.Names}}\\t{{.Status}}"`)
  await log(`📊 容器状态: ${statusResult.stdout}`)
}

// 清理资源
async function cleanup(
  ssh: NodeSSH,
  zipPath: string,
  log: (msg: string) => Promise<void>,
) {
  try {
    // 关闭SSH连接
    if (ssh.isConnected()) {
      ssh.dispose()
      await log('🔌 SSH连接已关闭')
    }

    // 删除本地ZIP文件
    if (zipPath && fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath)
      await log(`🗑️ 本地ZIP文件已删除: ${zipPath}`)
    }
  }
  catch (error) {
    await log(`⚠️ 清理资源时出现警告: ${error}`)
  }
}
