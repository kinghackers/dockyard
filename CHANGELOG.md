# 更新日志 / Changelog

所有 notable 变更均记录于此。本文件遵循 [Keep a Changelog](https://keepachangelog.com/) 精神。

## [0.2.0] — 2026-10-10

首个对外公开版本。

### 功能 Features
- 多主机 Docker 管理：容器 / 镜像 / 数据卷 / 网络 / Compose 项目统一视图；
- 多种连接模式：TCP(+TLS)、SSH 隧道、本地 socket；
- 仪表板：主机资源使用、容器运行状态概览；
- 容器操作：启动 / 停止 / 重启 / 删除、重命名、终端、日志（支持筛选/正则）、文件浏览器（上传/下载）；
- 镜像操作：拉取、导入（docker load）、打标签、推送、构建层历史、回收清理（prune）；
- 列表体验：相对时间显示 + 悬停精确时间、筛选匹配计数、内联清除按钮、空状态一键清除筛选、数字列右对齐、长文本截断；
- 国际化：简体中文 / 繁体中文 / 英文。

### 工程 Engineering
- Electron + React + Vite + TypeScript；
- 凭据本机加密存储（Electron safeStorage）；
- 单元测试（vitest）、mock 守护进程冒烟测试、CI 工作流。
