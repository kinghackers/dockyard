# 安全政策 / Security Policy

## 漏洞上报 / Reporting a vulnerability

请**不要**在公开的 Issue 中披露安全漏洞。请通过以下方式私下联系维护者：

- 项目 Issue 中标记为「安全」/ 使用 Gitee 的私有反馈通道；
- 或直接邮件联系维护者（见 `LICENSE` 中的版权方信息）。

我们会在收到后 72 小时内确认，并协商修复与披露时间线。

## 凭据处理 / How credentials are handled

Dockyard 是一个**本地桌面客户端**，连接凭据（SSH 密码 / 口令、TLS 私钥）由应用在本机妥善保管：

- 凭据写入磁盘前会使用 Electron `safeStorage` **加密存储**；
- 若运行环境不可用系统密钥库（加密存储不可用），应用会明确告警，并退化为**明文**保存于本机配置文件中（仅本机、仅该用户可读）；
- 「导出连接配置」提供 **含 / 不含 敏感信息** 两种选项；不含敏感信息时，密码与密钥会被剔除。

因此：请勿将真实的连接配置文件、导出的含密钥备份、或测试用的私钥提交到仓库或 Issue。

## 依赖安全 / Dependencies

- `package-lock.json` 已固定到官方源 `registry.npmjs.org`（不含第三方镜像）。
- 安装请使用 `npm ci` 以复现锁定的依赖版本。
- 报告依赖漏洞时，请提供受影响的包、版本范围与建议修复方式。

## 运行来源 / Build provenance

安装包通过 `electron-builder` 生成（NSIS）。当前 Windows 安装包**未做代码签名**，首次运行可能触发系统的 SmartScreen 提示，这是预期行为，不影响功能。如需签名版本，请关注后续 Release 说明。
