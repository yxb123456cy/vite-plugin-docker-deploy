// Vite-plugin-docker-deploy相关TS类型接口文件
export interface ServerConfig {
  host: string // 目标服务器 IP 或 域名
  port?: number // SSH 端口，默认 22
  username: string // 登录用户名，比如 root
  password?: string // 登录密码（二选一）
  privateKey?: string // 私钥路径（二选一），支持免密登录
  remoteDir: string // 上传到服务器的目录，例如 /root/deploy
}
export interface EnvConfig {
  servers: ServerConfig[] // 支持多台服务器并行部署
  imageName: string // 构建的 Docker 镜像名称，例如 myapp:latest
  containerName: string // 运行的容器名称，例如 myapp_container
  buildArgs?: string[] // Docker build 参数，例如 ['--build-arg', 'NODE_ENV=production']
  runArgs?: string[] // Docker run 参数，例如 ['-p 8080:80', '-d']
  cleanupRemote?: boolean // 部署成功后是否删除远程的 dist 文件夹，默认 true
}
export interface DockerDeployOptions {
  envs: Record<string, EnvConfig> // 多环境配置，比如 { prod: {...}, test: {...} }
  targetEnv: string // 本次要部署到哪个环境，例如 'prod'
  logDir?: string // 本地日志目录，例如 ./logs，存放部署日志
  onProgress?: (msg: string) => void // 部署过程中实时回调日志（类似进度条）
  onSuccess?: (env: string, server: ServerConfig) => void // 部署成功时触发
  onError?: (env: string, server: ServerConfig, err: Error) => void // 部署失败时触发
}
