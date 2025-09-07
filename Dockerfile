# 使用 Node.js 22.14 作为基础镜像
FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/node:22.14.0-alpine

# 将当前工作目录设置为/app
WORKDIR /app

# 将 package.json 和 package-lock.json 复制到 /app 目录下
COPY package*.json ./

# 运行 npm install 安装依赖
RUN npm install --registry=https://registry.npmmirror.com

# 将源代码复制到 /app 目录下
COPY . .

# 打包构建
RUN npm run build

# 将构建后的代码复制到 nginx 镜像中
FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/nginx:alpine3.22-slim
COPY --from=0 /app/dist /usr/share/nginx/html

# 暴露容器的 80 端口
EXPOSE 80

# 启动 nginx 服务
CMD ["nginx", "-g", "daemon off;"]
