# 安全策略

## 支持的版本

下表说明 Nexterm 各个发布线目前的安全更新支持情况:

| 版本线  | 支持状态            |
| ------- | ------------------- |
| 0.2.x   | :white_check_mark: 活跃维护 |
| 0.1.x   | :warning: 仅修复关键安全问题 |
| < 0.1.0 | :x: 不再支持 |

## 报告漏洞

请**不要**通过公开的 GitHub issue 报告安全问题。请通过以下私密渠道之一:

- **GitHub Security Advisories**: <https://github.com/xinggaoya/nexterm/security/advisories/new>
- **Email**: `nexterm-security@users.noreply.github.com`(使用 GitHub no-reply 别名作为占位)

请在报告中包含:

- 受影响的版本号
- 问题类型(命令注入、路径穿越、XSS、权限提升等)
- 可复现的攻击场景与最小 PoC
- 复现步骤与影响范围
- 是否已在公开渠道披露

## 响应流程

我们承诺在收到报告后:

1. **48 小时内**确认收到
2. **7 天内**给出初步评估与时间线
3. 修复完成后通过 Security Advisory 发布,并在 [CHANGELOG.md](./CHANGELOG.md) 记录
4. 致谢报告者(经报告者同意)

## 安全设计要点

Nexterm 在以下方面特别关注安全:

- **IPC 边界** — Webview 不直接访问文件系统、进程、shell、密钥。所有 native 调用通过 `@/lib/native` 与 Rust 命令的单向契约。
- **PTY 沙箱** — Windows 上使用 Job Object 隔离终端子进程,避免进程逃逸。
- **路径处理** — Windows / Unix / OSC 7 / 文件树来源的路径在边界处统一规范化,防止路径穿越。
- **CSP** — 严格的 Content Security Policy 限制 script / style / connect / frame 源。
- **签名更新** — Tauri updater 使用私钥签名所有 release 产物,客户端使用 tauri.conf.json 中的公钥校验。

详细设计见 [docs/architecture/04-security-model.md](./docs/architecture/04-security-model.md)。

## 安全最佳实践

部署/分发方应注意:

- 始终通过官方 GitHub Releases 安装
- 验证签名(`.sig` 文件)后再分发
- 不要在不可信上下文中禁用 Webview sandbox
- 报告异常行为给我们

## 致谢

负责任地披露安全问题的报告者将列入对应 Security Advisory 的致谢名单(经报告者同意)。
