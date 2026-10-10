# 贡献指南 / Contributing

感谢你考虑为 Dockyard 做出贡献。

## 开发环境 / Prerequisites

- Node.js **20+**（与 CI 一致）
- npm（lockfile 已固定到官方源 `registry.npmjs.org`，全球可安装）

## 本地开发 / Local setup

```bash
npm ci
npm run dev          # 同时启动 Vite 与 Electron 开发窗口
```

应用代码位于 `src/`，`package.json` 与 Electron 构建配置位于仓库根目录。
根目录的 `.github/workflows/ci.yml` 即 CI 定义（在 push 到 `master` 或 PR 时运行）。

## 构建与打包 / Build & package

```bash
npm run build         # 仅构建渲染进程（vite build）
npm run dist          # 构建并打包 Windows NSIS 安装包（electron-builder --win）
npm run dist:compat   # 沙箱/受限环境下使用的兼容打包（asar=false，产物在 out/）
```

> Windows 上若遇到 `app.asar` 被占用（如杀毒软件锁定）导致 `dist` 失败，请改用 `npm run dist:compat`。

## 测试 / Tests

```bash
npm run test          # vitest 单元测试
npm run e2e           # 基于 mock Docker 守护进程的冒烟测试（无需真实 Docker）
npm run verify        # 全量校验：typecheck + 测试 + IPC/逻辑检查 + e2e
```

提交前请保证 `npm run verify` 通过。

## 代码规范 / Code conventions

- **TypeScript strict** 模式；类型检查为 `npm run typecheck`。
- **国际化**：本项目的 i18n 以「中文原文即 key」（`t('中文')`），英文映射在 `src//i18n/en.ts`，繁体由 OpenCC 自动转换。新增中文文案时：
  - 复用已有 key，避免重复（重复 key 会触发 `TS1117`）；
  - 中英混排的**空格由 JSX 负责**（`{t('读')} {值}`），`en.ts` 的值不要自带首尾空格；
  - 单位词 key（`分钟/小时/天/个月/年/秒`）的英文值带前导空格，是给 Docker 状态串拼接用的，自建字符串时需 `t(k).trim()` 再补空格。
- **CJK–Latin 间距（盘古之白）**：标签与紧邻的数值/Latin 之间留一个空格，禁止 `{t('读')}{值}` 紧贴写法。
- 相对时间一律走 `src//utils/format.ts` 的 `fmtTimeAgo()` + `title={fmtAbsolute()}`。
- 长文本单元格（名称/挂载点/仓库标签）需 `maxWidth` + `ellipsis` + `title`，防止撑开表格。

## 提交 / Commits

- 提交信息清晰描述改动；作者会统一决定是否 `push`。
- 涉及行为变更的 PR，请说明验证步骤与预期结果。

## 问题反馈 / Issues

请在 Gitee / GitHub Issues 中提交复现步骤、环境信息（系统、Docker 版本、应用版本）。
