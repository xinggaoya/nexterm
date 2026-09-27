# Changelog

Nexterm 所有值得注意的变更都记录在本文件中。版本遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/) 规范。

## [Unreleased]

### 新增 ✨

- **文件树拖拽搬运** — 默认拖拽即**移动**，按住 `Alt`/`Ctrl` 拖拽变**复制**；支持多选整批拖走、悬停目录 600ms 自动展开、拖到容器边缘自动滚动、非法落点提前变禁用态
- **文件剪贴板** — `Cmd/Ctrl+X/C/V` 剪切 / 复制 / 粘贴，右键菜单同步提供三项（多选时也能"复制"文件，此前只能复制路径）
- **从系统拖文件进工作区** — 从 Finder / 资源管理器把文件拖进文件树即复制到目标目录（走 Tauri webview drag-drop 通道，与树内拖拽共存）
- **批量搬运命令** `fs_move_many` / `fs_copy_many` — 逐条结算（成功 / 跳过 / 失败 / 跨设备），冲突三策略：覆盖 / 跳过 / 全部改名（默认，目录覆盖需二次勾选确认）
- **LSP 补全 / 悬浮 / 跳转定义** — `F12` 或 `Ctrl/Cmd+点击` 跳转，悬浮框显示类型与文档
- **树过滤 + 折叠/展开全部** — 过滤只作用在已加载的行上，保留命中项的祖先链与命中目录的后代

### 修复 🐛

- **重命名 / 删除后编辑器标签指向失效路径** — explorer 发出的 `pathRenamed` / `pathDeleted` 事件在 `WorkspacePanel` 只声明不转发，脏缓冲保存会写回磁盘上不存在的文件，静默丢改动
- **图片预览从文件树打不开** — `openFilePreview` 同样被丢弃，文件树右键"打开预览"对图片完全无响应
- **复制会静默丢失符号链接** — 本地与 agent 各有一份 `copy_dir_recursive`，用 `file_type()` 同时判 `is_dir`/`is_file`，两头都不匹配就跳过；仓库里的 `node_modules` 符号链接复制后会凭空消失
- **跨设备移动无回退** — `fs_rename` 遇 `EXDEV` 直接失败；现在回退为 copy + delete，并在删源失败时显式报错（磁盘上已有两份）
- **拖进自身子目录会吞掉源目录** — 跨设备回退下的 copy + delete 会自噬；搬运层新增前置守卫
- **LSP 客户端能力声明为空对象** — 多数语言服务器据此判定客户端不支持补全/悬浮/跳转，**静默**降级为"没补全"

### 重构 ♻️

- **新增 `nexterm-fs-core` 共享 crate** — 搬运语义（冲突策略 / 跨设备回落 / 防自噬 / 符号链接）的唯一实现，宿主与 `nexterm-agent` 共同依赖，保证本地 / WSL / SSH 三条路径行为一致
- **抽出 `usePointerDragReorder`** — 标签重排、工作区重排、文件搬运三处重复的指针手势统一到一份实现（阈值 / ghost 缓存 / click 抑制 / window 监听成对移除），并加边界测试锁死
- **拆分 `FileExplorer.vue`** — 1771 行 → 712 行，拆为 `useFileTreeData`（数据）/ `useTreeSelection`（选择）/ `useTreeTransfer`（搬运）三个 composable，依赖单向无环
- **抽出 `useVirtualWindow`** 的消费方统一（文件树与 Git 历史共用）

### 文档 📚

- **重写 `docs/architecture/explorer/detailed-design.md`** — 旧版描述的是已删除的 `ExplorerPane` / `FileTree` / `useExplorer` 架构
- **`CODE_WIKI.md` 同步** — FS 命令表补 `fs_move_many` / `fs_copy_many` / `fs_force_flush_workspace`，删掉实际未注册的 `fs_stat` / `fs_canonicalize` / `list_subdirs`；Git 表补标签命令；新增 `fs-core` / `lsp` / `ssh` / `agent` 模块说明

## [0.2.1] - 2026-09-16

### 工程 🔧

- **CI Actions 升级到 Node 24** — `actions/checkout` v5、`actions/upload-artifact` v6、`actions/download-artifact` v7,消除 Node 20 deprecation warning
- **tauri-action 升级到 v1** — `includeUpdaterJson` 重命名为 `uploadUpdaterJson`,跨 jobs 自动合并 `latest.json`
- **Release workflow 分层重构**:
  - 新增 `create-release` job: agent 完成后创建 draft release
  - `build` job 改用 `releaseId` 模式,三平台并发追加资产
  - 新增 `publish` job: 三平台完成后从 CHANGELOG 自动生成 release notes、发布 draft、commit Cargo.lock 刷新、sync latest.json fallback
- **`latest.json` 跨平台汇总** — 之前只有 linux,现在 linux + windows + macOS 三个平台的 updater 签名都包含

## [0.2.0] - 2026-09-16

### 新增 ✨

- **全新品牌系统** — 完整的 LOGO 设计(N × Cursor)、lockup、动画版本、跨平台图标集
- **终端优先壳层 v3** — 全新基础布局,侧栏 + 工作区面板 + 画布的停靠式结构
- **工作区面板右移(v3.2)** — 终端内容居中布局,工作区面板改为右侧停靠
- **工作区面板拖拽重排** — 侧栏工作区支持拖拽排序
- **应用内文件选择器** — 统一替换系统文件夹对话框
- **Git 标签管理** — 支持在 Source Control 面板查看、创建、删除与推送 Git 标签
- **文件浏览器多选 + 二次确认** — 移除工作区时的二次确认对话框
- **autostart 启动项管理** — 系统启动时自动启动 Nexterm
- **icon:regen 脚本** — `pnpm icon:regen` 重新生成全套平台图标

### 修复 🐛

- **CJK 输入法候选框锚定行尾漂移** — 侧载 conpty.dll 修复 Windows 下中文输入法候选框位置
- **终端滚动条覆盖内容** — 内边距移至 `.xterm`,修正 FitAddon 列数计算
- **独立挂载的 SSH 对话框主题注入** — 为独立挂载的 SSH 对话框注入当前主题
- **updater 边缘节点 404** — 添加 `raw.githubusercontent.com` 作为 release JSON 备用 endpoint

### 重构 ♻️

- **移除 tasks 任务模块** — 会话条新增溢出滚动,任务模块功能并入会话条
- **shell 模块拆分 profiles 测试 cfg 门控** — 修复 Linux CI 失败
- **CI 配置简化** — 让 CI 接受 lock file 自动 reconcile,避免 stale checksum 假红

### 文档 📚

- **架构文档全面同步** — 同步终端优先壳层 v3、模块文档与实现现状
- **品牌文档** — 新增 `docs/brand/` 文档说明品牌资产使用

### 工程 🔧

- 选择 **Apache License 2.0** 作为开源许可证
- 仓库从私有转为公开
- 添加完整开源元数据(topics / description / homepage / license 字段)
- 添加 [CONTRIBUTING](./CONTRIBUTING.md)、[CODE_OF_CONDUCT](./CODE_OF_CONDUCT.md)、[SECURITY](./SECURITY.md) 文档

## [0.1.4] - 2026-09-08

### 修复

- 修复 macOS CI rust targets 缺失,恢复 universal build 支持
- 修复 musl agent cross-compile 的 lock file 校验失败
- 添加 raw.githubusercontent.com 作为 release JSON fallback endpoint
- 改进 updater 错误信息

## [0.1.3] - 2026-09-08

### 修复

- 同步 tauri.conf.json 版本号

## [0.1.1] - 2026-05-21

### 修复

- 早期补丁版本

## [0.1.0] - 2026-05-21

### 新增

- 首个公开发布版本
- 基于 Tauri 2 的终端开发环境基础架构
- 多标签终端、文件浏览器、代码编辑器、Git 集成

[Unreleased]: https://github.com/xinggaoya/nexterm/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/xinggaoya/nexterm/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/xinggaoya/nexterm/compare/v0.1.4...v0.2.0
[0.1.4]: https://github.com/xinggaoya/nexterm/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/xinggaoya/nexterm/compare/v0.1.1...v0.1.3
[0.1.1]: https://github.com/xinggaoya/nexterm/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/xinggaoya/nexterm/releases/tag/v0.1.0
