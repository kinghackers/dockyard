## Install note (Windows)

Dockyard installers are **not code-signed** — this is a single-maintainer project with no feasible code signing option. Windows therefore shows a security prompt on first run. This is expected, not a broken download:

- **SmartScreen** ("Windows protected your PC") → click **More info** → **Run anyway**.
- **Smart App Control (SAC)** (hard block, no override button) → SAC decides on cloud reputation; **unsigned means blocked** and "right-click → Unblock" does **not** help it. The only no-cost workaround is to temporarily turn it off: **Windows Security → App & browser control → Smart App Control → Off**, run the installer, then turn it back on (freely toggleable since the April 2026 update KB5083769; one-way on older builds).

On macOS: right-click → **Open**, or **System Settings → Privacy & Security → Open Anyway**.

Prefer not to rely on any trust verdict? Build from source — every build definition in this repository is public and auditable.

<details>
<summary>安装须知（中文）</summary>

安装包**未做代码签名**（独立维护者项目，暂无可行的签名渠道），首次运行出现安全提示属正常现象，并非文件损坏：

- **SmartScreen**（蓝框）→ 点击 **更多信息** → **仍要运行**。
- **智能应用控制 SAC**（直接阻止、无「仍要运行」）→ SAC 按云端信誉判定，**未签名 = 直接拦**，「右键 → 解除锁定」无效。零成本绕法：临时关闭「Windows 安全中心 → 应用和浏览器控制 → 智能应用控制 → 关闭」，装完**再打开**（2026 年 4 月 KB5083769 起支持自由切换；更早版本关后不可逆）。

不希望依赖任何信任判断？可直接从源码构建——本仓库所有构建脚本公开可审计。

</details>
