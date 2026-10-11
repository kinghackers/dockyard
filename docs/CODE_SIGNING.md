# 代码签名（Code Signing）指南

> 本文说明 Dockyard 当前签名状态、三平台未签名安装包的实际影响、2026 年主流签名方案对比，以及 CI 接入点。构建基建已就绪：**配置证书 Secret 后自动签名，不配置则自动跳过**。

## 当前状态

| 平台 | 产物 | 签名状态 |
| --- | --- | --- |
| Windows | `Dockyard-*-Setup.exe`（NSIS） | 未签名（无证书） |
| macOS | `Dockyard-*.dmg` / `.zip`（x64 + arm64） | CI 自动 ad-hoc 签名（无正式证书） |
| Linux | `Dockyard-*.AppImage` / `.deb` | 无签名要求 |

## 未签名的实际影响

- **Windows**：SmartScreen 弹「Windows 已保护你的电脑」→ 用户需点「更多信息 → 仍要运行」。实测未签名安装包的下载→安装转化率会明显下降（首道 Modal 的「不运行」是蓝色大按钮，「仍要运行」藏在「更多信息」里）。
- **macOS**：Gatekeeper 拦截。macOS Sequoia（15.x）起已取消「右键 → 打开」绕过，需走「系统设置 → 隐私与安全性 → 仍要打开」。另注意：Apple Silicon 上**完全无签名**的二进制会直接被杀（`killed: 9`）——本仓库 CI 产出的 mac 包由 electron-builder 自动做 ad-hoc 签名兜底，可以正常安装，但仍需手动过 Gatekeeper 流程。
- **Linux**：无签名机制，无影响。

## 2026 年方案对比（价格已核实）

> **2026-10-12 更新**：SignPath Foundation 申请**已被拒绝**；用户明确「不重申、不付费」。因此本项目转为长期未签名发布 + 用户侧缓解，见「决策记录」一节。

| 方案 | 价格 | 适用对象 | CI 无人值守 | 备注 |
| --- | --- | --- | --- | --- |
| **Azure Artifact Signing**（原 Trusted Signing，2026 更名） | $9.99/月（含 5,000 签名/月，超出 $0.005/次） | **个人开发者仅限美国/加拿大**；组织限美/加/欧盟/英国 | ✅ 直连 CI/CD | 密钥存微软 HSM，无需令牌；**中国个人开发者不可用** |
| **Certum Open Source Code Signing** | €49 起/年（约 $100，不含 VAT） | 个人开源开发者 | ⚠️ 摩擦大 | SimplySign 云签（虚拟智能卡），CI 签名需手机 App 一次性码，无人值守困难；OV 级，SmartScreen 信誉随安装量逐步建立 |
| **SignPath Foundation** | **免费**（申请制） | 公开开源项目 | ✅ GitHub App 集成 | 需提交项目申请，审批数天～数周；开源 Electron 项目的主流免费路径 |
| SSL.com eSigner / DigiCert / Sectigo OV | ¥1,200–4,400/年 | 个人/企业 | 视云签方案 | OV 级 |
| 同上 EV | ¥2,500–6,600/年 | 企业 | 视云签方案 | **2024 起 EV 也不再提供 SmartScreen 即时信任**，与 OV 差异仅为信誉建立更快 |
| 自签名证书 | 免费 | 仅本机/内网测试 | ✅ | 无法消除 SmartScreen/Gatekeeper 警告 |

**重要前提（2023-06-01 起）**：CA/浏览器行业规范要求代码签名私钥存放于 HSM 或硬件令牌，**各 CA 已不再签发可导出的 `.pfx` 文件**。传统「pfx + `CSC_LINK`」签名方式仅适用于存量证书或测试自签证书。

## 已内置的 CI 接入点

`.github/workflows/release.yml` 的构建步骤已注入以下 Secrets（未配置时为空、自动跳过签名）：

```yaml
env:
  CSC_LINK: ${{ secrets.CSC_LINK }}            # 证书文件（.pfx/.p12）的 base64
  CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}  # 证书私钥密码
```

Windows 与 macOS 共用这两个变量。macOS 公证（notarization）需另配 `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`（未配置时跳过）。

若拿到可导出的证书（存量 pfx 或测试自签），配置步骤：

```bash
# 本地生成 base64
base64 -w0 cert.pfx > cert.pfx.b64
# GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret
#   CSC_LINK         = cert.pfx.b64 的内容
#   CSC_KEY_PASSWORD = pfx 私钥密码
```

之后推送 `v*` tag，Release 工作流即产出已签名安装包。

## 决策记录（2026-10-12）

| 项 | 结论 |
| --- | --- |
| SignPath Foundation 申请 | **被拒**（2026-10 提交，单人维护、项目开源不足两周、下载量极少 → 大概率卡在成熟度/声誉门槛） |
| 是否重申 | **否**（用户决定）。若日后重申，需先把「项目成熟度证据」做厚：稳定发版节奏、更多 stars/issues/下载量、完善使用文档——而非改写措辞。 |
| 是否购买商业证书 | **否**（用户决定）。Cost 最低的 Certum OV 约 €49/年，且**不解决 SAC**：SAC 要求签名者已有 Windows 云信誉，新 OV 证书无历史分，仍会被拦。 |
| 最终路线 | **长期未签名发布 + 文档化缓解措施**（README 中英双份已加「Windows 安装须知 / Windows install note」） |

### SAC 的关键事实变化（重要）

此前结论是「关闭 SAC 不可逆，必须重装系统」。**该结论已过期**：

- Windows 11 累积更新 **KB5083769（2026-04-14）** 之后，SAC 可在 Windows 安全中心里**自由开关**，无需重装系统（可「临时关闭 → 安装 → 再打开」）。需 Windows 安全中心 ≥ v1000.29554，且为全新安装而非就地升级的 Win11 22H2+。
- 未装该更新的旧系统，关闭仍不可逆。
- SAC **没有**单文件白名单、没有「仍要运行」；硬性判定的绕行选项只有两个：**清除 Mark-of-the-Web**（右键 → 属性 → 解除锁定）或**临时关闭 SAC**。

据此，「零成本方案」的成本从「系统级不可逆操作」降为「一次可逆的临时开关」，这是当前推荐给用户的做法。

### 未来可能重开的窗口

- 项目自然成长后重申 SignPath（最快路径，0 成本，需时间）。
- Azure Artifact Signing 若放开中国个人主体（$9.99/月，CI 直连）——需持续关注微软政策。
- 免费的第三方开源签名渠道出现新玩家时重评。

## 附：exe 图标与版本资源说明

`build.win.signAndEditExecutable` 现已恢复默认 `true`：打包时会把图标与版本信息写入 `Dockyard.exe` 资源（此前为 `false`，导致 exe 在资源管理器中显示默认 Electron 图标）。沙箱内本地构建请继续使用 `npm run dist:compat`——该脚本已附加 `--config.win.signAndEditExecutable=false` 覆盖以规避沙箱环境限制。
