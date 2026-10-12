# Dockyard

> 一款开源的多主机 Docker 管理客户端（Electron + React）。

[![CI](https://github.com/kinghackers/dockyard/actions/workflows/ci.yml/badge.svg)](https://github.com/kinghackers/dockyard/actions/workflows/ci.yml)
[![Release](https://github.com/kinghackers/dockyard/actions/workflows/release.yml/badge.svg)](https://github.com/kinghackers/dockyard/actions/workflows/release.yml)

- 主仓库（Gitee）：<https://gitee.com/kinghackers/dockyard>
- GitHub 镜像：<https://github.com/kinghackers/dockyard>

[特性](#功能特性) · [快速开始](#快速开始) · [连接模式](#连接模式) · [开发](#开发) · [许可证](#许可证)

---

## 功能特性

- **多主机统一管理**：容器、镜像、数据卷、网络、Compose 项目在同一界面聚合查看。
- **多种连接方式**：TCP（可选 TLS 加密）、SSH 隧道、本地 Docker socket。
- **容器全生命周期**：启动 / 停止 / 重启 / 删除 / 重命名、终端、日志（支持筛选与正则）、文件浏览器（上传 / 下载）。
- **镜像操作**：拉取、从 tar 导入（`docker load`）、打标签、推送、构建层历史、回收清理（prune）。
- **列表体验优化**：相对时间显示（悬停看精确时间）、筛选匹配计数、一键清除筛选、数字列右对齐、长文本截断。
- **国际化**：简体中文 / 繁体中文 / 英文。

## 截图

| 界面 | 说明 |
| --- | --- |
| ![仪表板](docs/screenshots/dashboard.png) | 多主机总览与资源统计 |
| ![容器列表](docs/screenshots/containers.png) | 容器列表、筛选与批量操作 |
| ![连接配置](docs/screenshots/connection.png) | 新增 / 编辑 Docker 连接（TCP / SSH / socket） |
| ![终端与日志](docs/screenshots/terminal-logs.png) | 容器终端与日志查看 |
| ![设置](docs/screenshots/settings.png) | 偏好设置与关于 |

> 截图请放入 `docs/screenshots/`（PNG，建议约 1280×800）。当前为占位，待补充真实图片。

## 快速开始

### 下载安装包

前往 [GitHub Releases](https://github.com/kinghackers/dockyard/releases)（或 [Gitee Releases](https://gitee.com/kinghackers/dockyard/releases)）下载 Windows 安装包（`Dockyard-x.y.z-Setup.exe`）。

### Windows 安装须知

Dockyard 的安装包**目前没有代码签名**（原因见下方 [Code Signing Policy](#code-signing-policy)），因此 Windows 首次运行会给出安全提示，属正常现象并非文件损坏。按提示类型分别处理：

| 提示 | 表现 | 处理方式 |
| --- | --- | --- |
| **SmartScreen**（蓝框，有按钮） | 「Windows 已保护你的电脑」 | 点击 **更多信息** → **仍要运行** 即可。 |
| **智能应用控制 SAC**（无「仍要运行」，直接阻止） | 「此应用已被阻止，可能对你的设备有害」 | SAC 按云端信誉判定，**未签名 = 直接拦**；「右键 → 解除锁定」对它**无效**。唯一零成本绕法是**临时关闭**：Windows 安全中心 → 应用和浏览器控制 → 智能应用控制设置 → 关闭，装完**再打开**（2026 年 4 月 KB5083769 起支持自由切换；更早的版本关闭后不可逆，请权衡）。 |

> macOS 同理会出现「无法验证开发者」提示：视系统版本，走右键 → **打开**，或「系统设置 → 隐私与安全性 → **仍要打开**」。
>
> 若希望完全不依赖信任判断，可直接从源码构建（见下一节）——所有构建脚本公开可审计。

### 一键安装（Windows，推荐）

不想手动处理提示？在 PowerShell（管理员或普通用户均可）里执行一行，即可自动下载并启动安装包（自动清除 Mark-of-the-Web，缓解 SmartScreen 提示）：

```powershell
irm https://raw.githubusercontent.com/kinghackers/dockyard/master/install.ps1 | iex
```

> 该脚本只简化 **SmartScreen** 流程；若设备开启了 **SAC**，未签名安装包仍会被硬拦，需先按上方「临时关闭 SAC」处理。

### 从源码构建

```bash
# 主仓库（Gitee）
git clone https://gitee.com/kinghackers/dockyard.git dockyard
# 或使用 GitHub 镜像（GitHub Mirror）
git clone https://github.com/kinghackers/dockyard.git dockyard
cd dockyard
npm ci
npm run dev      # 启动开发窗口（Vite + Electron）
npm run dist     # 打包 Windows NSIS 安装包（推送 v* tag 到 GitHub 会触发自动发版）
```

> 若 `npm run dist` 在 Windows 上因 `app.asar` 被占用而失败，改用 `npm run dist:compat`。

## 连接模式

| 模式 | 说明 |
| --- | --- |
| TCP | 直连 Docker 守护进程 TCP 端口；可勾选 TLS 以加密传输。 |
| SSH 隧道 | 通过 SSH 跳板连接远端 Docker，凭据在本机加密存储。 |
| 本地 socket | 连接本机 Docker socket（Windows 命名管道 / Linux、macOS Unix socket）。 |

## 技术栈

- **Electron** + **React 18** + **Vite 5** + **TypeScript**
- **dockerode** —— Docker Engine API 客户端
- **ssh2** —— SSH 隧道
- **zustand** —— 状态管理
- **lucide-react** —— 图标
- **OpenCC** —— 简→繁中文转换
- **vitest** —— 单元测试 / 冒烟测试

## 开发

详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。应用源码位于 `src/`，Electron 主进程在 `electron/`，构建与脚本在仓库根。常用命令：

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动开发环境（Vite + Electron） |
| `npm run test` | 单元测试（vitest） |
| `npm run e2e` | 基于 mock 守护进程的冒烟测试 |
| `npm run verify` | 全量校验（typecheck + tests + IPC/logic + e2e） |

## 安全

连接凭据在**本机加密存储**；导出连接配置时可选择剔除敏感信息。详见 [SECURITY.md](./SECURITY.md)。

### Code Signing Policy

- Dockyard releases are built automatically by GitHub Actions from tagged commits of this repository; all build definitions live in this repository and are publicly auditable.
- Signed artifacts, when available, are published exclusively as assets of the corresponding GitHub Release (tag); this is the only distribution channel covered by this policy.
- **Current status: unsigned.** This is a single-maintainer project. It applied to [SignPath Foundation](https://signpath.org) for free open-source code signing and was declined; commercial certificates are not currently feasible. Because releases are unsigned, Windows may show SmartScreen warnings or Smart App Control blocks — see [Windows 安装须知](#windows-安装须知) for how to proceed. Until then, the strongest guarantee offered is that every artifact is reproducible from the public repository: build from source and compare.
- If code signing becomes available, this section will be updated and the release notes for that version will announce it.
- The maintainer acts as Author, Reviewer, and Approver, with multi-factor authentication enabled on the distribution accounts.

## 路线图

- 多平台发布：Windows / macOS（dmg+zip，x64+arm64）/ Linux（AppImage+deb）三平台自动发布工作流已就绪（`.github/workflows/release.yml`，tag 触发）
- 代码签名：Windows SmartScreen / macOS Gatekeeper 消除（选型与接入见 [docs/CODE_SIGNING.md](docs/CODE_SIGNING.md)）
- 安装包代码签名
- 容器指标实时图表
- 更多镜像仓库集成

## 许可证

本项目以 [MIT License](./LICENSE) 开源。

## 商标声明

"Docker" 是 Docker, Inc. 的商标。本项目与 Docker, Inc. 无隶属或背书关系。
