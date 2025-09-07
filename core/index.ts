import type { Plugin } from 'vite'
import type { DockerDeployOptions } from './type'
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
      console.warn(`🚀 开始部署环境: ${options.targetEnv}`)
    },
  }
}
