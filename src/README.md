# IDEA Docker Manager

参考 IntelliJ IDEA 的 Docker 工具窗口，实现的多远程 Docker 管理客户端（Electron + React）。

## 功能

- **多主机连接管理**：同时添加多个 Docker 端点，支持 TCP、TCP+TLS（双向认证）、SSH 隧道、Unix Socket
- **容器管理**：列表、启动/停止/重启/暂停/删除、实时日志、Web 终端（exec）、**创建并运行容器**（端口/卷/环境变量/网络/重启策略）
- **镜像 / 网络 / 卷**：查看、删除、拉取镜像、**从镜像一键运行**、**创建网络 / 数据卷**
- **Docker Compose 项目**：按 `com.docker.compose.project` 标签自动归类，支持一键启停整个项目
- **实时刷新**：接入 Docker events，容器/镜像/网络/卷列表与侧边栏树在资源变化时自动刷新
- **容器资源流**：详情页 CPU / 内存 / 网络 / 块 I/O 实时推送（非轮询）
- **仪表板**：CPU / 内存 / 网络 I/O / 块 I/O / 容器数等资源统计
- **IDEA Darcula 风格**界面

## 开发

```bash
npm install
npm run dev        # 同时启动 Vite 与 Electron，支持热更新
```

## 构建 / 运行

```bash
npm run build      # 产出 dist/ 与 dist-electron/
npm start          # 启动生产模式
```

## 连接配置

左侧工具栏 `+` 可添加连接：

| 类型 | 说明 |
|------|------|
| TCP | `host:port`，默认 2375；可勾选 TLS 并填写 CA/客户端证书 |
| SSH | 通过 SSH 登录远程主机后访问 `docker.sock`（底层走 `docker system dial-stdio`） |
| Unix Socket | 本机或挂载的 `/var/run/docker.sock` |

连接配置保存在 Electron `userData` 目录下的 `docker-connections.json`。

## 目录结构

```
electron/          # 主进程：连接管理、SSH 隧道、IPC
src/               # 渲染进程：React UI
scripts/           # esbuild 打包脚本
```
