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

## 推荐路径

1. **短期**：维持未签名发布，在 README/Release 说明中写清安装方法（Windows「更多信息 → 仍要运行」；macOS「系统设置 → 隐私与安全性 → 仍要打开」）。
2. **开源免费路径**：申请 [SignPath Foundation](https://signpath.org)（对公开开源项目免费、CI 最顺）。
3. **自有证书**：个人开源选 Certum Open Source（€49 起/年），但需评估 SimplySign 在 CI 无人值守的会话问题；企业用户可考虑 SSL.com eSigner 的 CI 模式。
4. **若未来注册美/加/欧盟/英国主体**：Azure Artifact Signing 性价比最高（$9.99/月，electron-builder 支持 `azureSignOptions` 直连）。

## 附：exe 图标与版本资源说明

`build.win.signAndEditExecutable` 现已恢复默认 `true`：打包时会把图标与版本信息写入 `Dockyard.exe` 资源（此前为 `false`，导致 exe 在资源管理器中显示默认 Electron 图标）。沙箱内本地构建请继续使用 `npm run dist:compat`——该脚本已附加 `--config.win.signAndEditExecutable=false` 覆盖以规避沙箱环境限制。
