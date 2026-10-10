# Dockyard

> 一款开源的多主机 Docker 管理客户端（Electron + React）。
> An open-source, multi-host Docker manager built with Electron + React.

[特性](#功能特性--features) · [快速开始](#快速开始--quick-start) · [连接模式](#连接模式--connection-modes) · [开发](#开发--development) · [许可证](#许可证--license)

---

## 功能特性 / Features

- **多主机统一管理**：容器、镜像、数据卷、网络、Compose 项目在同一界面聚合查看。
  Manage containers, images, volumes, networks and Compose projects across many hosts in one place.
- **多种连接方式**：TCP（可选 TLS 加密）、SSH 隧道、本地 Docker socket。
  Connect via TCP (optional TLS), SSH tunnel, or the local Docker socket.
- **容器全生命周期**：启动 / 停止 / 重启 / 删除 / 重命名、终端、日志（支持筛选与正则）、文件浏览器（上传 / 下载）。
  Full container lifecycle: start / stop / restart / remove / rename, terminal, logs (filter & regex), file browser (upload / download).
- **镜像操作**：拉取、从 tar 导入（`docker load`）、打标签、推送、构建层历史、回收清理（prune）。
  Images: pull, import from tar, tag, push, layer history, prune.
- **列表体验优化**：相对时间显示（悬停看精确时间）、筛选匹配计数、一键清除筛选、数字列右对齐、长文本截断。
  Polished lists: relative timestamps (exact time on hover), filter match count, one-click clear, right-aligned numeric columns, ellipsis for long text.
- **国际化**：简体中文 / 繁体中文 / 英文。
  Internationalized: Simplified Chinese / Traditional Chinese / English.

## 截图 / Screenshots

> 待补充。请将应用截图放入 `docs/screenshots/` 并在此引用。
> To be added — drop screenshots into `docs/screenshots/` and link them here.

## 快速开始 / Quick Start

### 下载安装包 / Download a release

前往仓库的 Releases 页面下载 Windows 安装包（`Dockyard-x.y.z-Setup.exe`）。
Go to the Releases page and download the Windows installer.

### 从源码构建 / Build from source

```bash
git clone <repo-url> dockyard
cd dockyard
npm ci
npm run dev      # 启动开发窗口（Vite + Electron）
npm run dist     # 打包 Windows NSIS 安装包
```

> 若 `npm run dist` 在 Windows 上因 `app.asar` 被占用而失败，改用 `npm run dist:compat`。
> If `npm run dist` fails on Windows (e.g. `app.asar` locked), use `npm run dist:compat`.

## 连接模式 / Connection modes

| 模式 Mode | 说明 Description |
| --- | --- |
| TCP | 直连 Docker 守护进程 TCP 端口；可勾选 TLS 以加密传输。 Plain or TLS-encrypted TCP to the daemon port. |
| SSH 隧道 | 通过 SSH 跳板连接远端 Docker，凭据在本机加密存储。 Tunnel through SSH; credentials are encrypted at rest locally. |
| 本地 socket | 连接本机 Docker socket（Windows 命名管道 / Linux、macOS Unix socket）。 The local Docker socket. |

## 技术栈 / Tech stack

- **Electron** + **React 18** + **Vite 5** + **TypeScript**
- **dockerode** —— Docker Engine API 客户端
- **ssh2** —— SSH 隧道
- **zustand** —— 状态管理
- **lucide-react** —— 图标
- **OpenCC** —— 简→繁中文转换
- **vitest** —— 单元测试 / 冒烟测试

## 开发 / Development

详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。常用命令：

| 命令 Command | 作用 Purpose |
| --- | --- |
| `npm run dev` | 启动开发环境 Launch dev (Vite + Electron) |
| `npm run test` | 单元测试 Unit tests (vitest) |
| `npm run e2e` | 基于 mock 守护进程的冒烟测试 Smoke test against a mock daemon |
| `npm run verify` | 全量校验 Full verify (typecheck + tests + IPC/logic + e2e) |

## 安全 / Security

连接凭据在**本机加密存储**；导出连接配置时可选择剔除敏感信息。详见 [SECURITY.md](./SECURITY.md)。
Connection credentials are stored encrypted on the local machine; exports can strip secrets. See [SECURITY.md](./SECURITY.md).

## 路线图 / Roadmap

- macOS / Linux 安装包与自动发布工作流
  macOS / Linux installers and automated release workflows
- 安装包代码签名
  Code signing for installers
- 容器指标实时图表
  Live per-container metrics charts
- 更多镜像仓库集成
  Broader registry integrations

## 许可证 / License

本项目以 [MIT License](./LICENSE) 开源。
Released under the [MIT License](./LICENSE).

## 商标声明 / Trademark

"Docker" 是 Docker, Inc. 的商标。本项目与 Docker, Inc. 无隶属或背书关系。
"Docker" is a trademark of Docker, Inc. This project is not affiliated with or endorsed by Docker, Inc.
