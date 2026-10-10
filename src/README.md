# Docker 管理器（Dockyard）

多远程 Docker 管理客户端（Electron + React）。

## 功能

### 连接与导航

- **多主机连接管理**：同时添加多个 Docker 端点，支持 TCP、TCP+TLS（双向认证）、SSH 隧道、Unix Socket
- **每连接一个标签页**：主机旗下的仪表板、容器、镜像、网络、数据卷、Compose、容器详情等页面都在该连接自己的标签页内切换，互不串扰；标签页 keep-alive，切回不丢数据
- **主页总览**（固定不可关闭）：所有连接的在线数 / 容器 / 镜像 / vCPU 汇总、每主机状态卡片（点击直达其标签页）、最近事件、软件信息
- **会话标签页**：日志、终端、所有容器（跨主机聚合）、设置为独立可关闭标签；支持拖拽重排、中键关闭
- **侧边栏资源树**：连接分组（拖拽移动）、Compose 项目按 `com.docker.compose.project` 标签自动归类、散装容器收纳在可折叠的「容器」节点内

### 资源管理

- **容器管理**：列表（搜索 / 状态筛选 / 排序均持久化）、多选批量操作（Ctrl+点击、Shift 区间）、启动/停止/重启/暂停/强杀/删除、重命名、**创建并运行容器**（端口/卷/环境变量/网络/重启策略）、文件上传下载、commit 另存为镜像
- **容器详情**：基本信息、健康检查、实时资源流（CPU / 内存 / 网络 / 块 I/O）、资源限额在线调整、排障诊断提示、重启循环检测与一键止住
- **实时日志 / Web 终端**：日志支持等级着色、正则过滤、导出 `.log`；终端为 exec 交互会话
- **镜像**：列表、删除、拉取（带进度）、推送、打标签、历史、保存 / 加载、**从镜像一键运行**、系统清理向导
- **网络 / 数据卷**：查看、删除、创建
- **Docker Compose**：项目卡片列表、项目详情（服务表格、批量操作、更新镜像、项目下线）、**项目级日志聚合**、从文件部署

### 刷新与数据

- **事件驱动 + 兜底轮询**：接入 Docker events，资源变化实时刷新各列表与侧边栏树；仪表板 / 详情 / 聚合视图另有兜底轮询兜住漏网变更
- **keep-alive 感知**：标签页隐藏时轮询自动暂停，切回时数据过期立即补拉
- 可在设置中调整：仪表板轮询间隔（10/30/60 秒或关闭）、日志行数上限、事件保留条数

### 体验

- **快捷键**：`Ctrl+P` / `Ctrl+K` 命令面板 · 列表页 `Ctrl+F` 搜索 / `F5` 刷新 / `Ctrl+A` 全选 / `Del` 删除 / `↑↓` 移动焦点 / `Enter` 打开详情 / `Esc` 取消
- 列表过滤、排序、侧边栏折叠状态等 UI 偏好跨会话保留
- 批量启停、删除、compose down 等危险操作均有确认弹窗
- 排序表头支持键盘操作（Enter / 空格），带 aria-sort
- IDEA Darcula 风格界面，支持浅色主题

## 开发

```bash
npm install
npm run dev        # 同时启动 Vite 与 Electron，支持热更新
npm run verify     # 类型检查 + 单元测试 + IPC/逻辑/i18n 检验 + e2e 冒烟
npm start          # 以 dist/ 产物启动生产模式（改完源码需先 npm run build）
```

## 打包（Windows）

```bash
npm run build        # 产出 dist/ 与 dist-electron/
npm run dist         # 构建 + electron-builder 出 NSIS 安装包（asar 打包）
npm run dist:dir     # 仅产出免安装目录
npm run dist:compat  # 兼容模式：asar=false（本机 Defender 锁 app.asar 时临时使用）
```

产物在 `release/`（`directories.output`）：

| 文件 | 说明 |
|------|------|
| `DockerManager-<版本>-Setup.exe` | NSIS 安装包（可选安装路径） |
| `win-unpacked/` | 绿色免安装目录，直接运行 `Docker 管理器.exe` |

注意事项：

- `electronDist` 已指向 `node_modules/electron/dist`，打包不再重复下载 Electron
- 当前配置不签名（`win.sign: null`）；需要签名时再填证书
- 正式打包走 asar。若本机 Windows Defender 构建时报 app.asar 被锁，优先为项目目录添加
  Defender 排除项；排除前可临时用 `npm run dist:compat`（散装目录，勿用于分发）
- 应用图标在 `build/icon.ico`（由 `build/icon.png` 生成）
- 打包版报「JavaScript error in the main process」时优先确认是否使用了最新构建产物

## 连接配置

左侧工具栏 `+` 可添加连接：

| 类型 | 说明 |
|------|------|
| TCP | `host:port`，默认 2375；可勾选 TLS 并填写 CA/客户端证书 |
| SSH | 通过 SSH 登录远程主机后访问 `docker.sock`（底层走 `docker system dial-stdio`） |
| Unix Socket | 本机或挂载的 `/var/run/docker.sock` |

连接配置保存在 Electron `userData` 目录下的 `docker-connections.json`（凭据使用系统密钥库加密存储）。

## 目录结构

```
electron/          # 主进程：连接管理、SSH 隧道、流式 IPC
  docker/          #   connectionManager（dockerode/SSH）、ipcHandlers（safeSend 守卫）
src/
  components/      # 渲染进程 React UI（Home / Dashboard / Containers / Images / Compose / ...）
  hooks/           # usePolling（轮询+补拉）、useMultiSelect（多选区间）
  stores/          # zustand：连接状态、标签页模型（hostViews / openHostView）
  utils/           # format / containerActions / uiPrefs / localize 等
scripts/           # esbuild 打包脚本
```
