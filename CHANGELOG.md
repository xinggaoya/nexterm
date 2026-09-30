# Changelog

Nexterm 所有值得注意的变更都记录在本文件中。版本遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/) 规范。

## [Unreleased]

### 新增 ✨

- **多行粘贴守卫** — 终端里跑的 TUI AI 编码工具（claude code / aider / opencode）把输入框里的换行当成提交：从网页/笔记粘一大段 prompt 过去、末尾自带换行 → **一贴就被执行**，命令真跑起来事后很难挽回。超过 4 行的粘贴先弹一次确认（可在设置关闭）。守卫拦在 `term.paste` 层面，所以普通 `Ctrl+V`、右键粘贴、中键主选区三条路径一视同仁；单行、勾选删除、以及只有尾随换行的情况一律不拦（编辑器复制带一个结尾换行是常态，为此弹窗只会把人训练成无脑点确认）
- **状态坞右半边** — 此前 `justify-between` 却只有一个子元素，24px 高的常驻条右侧整片空着。现在显示活动终端的 `cols×rows`（直接决定 TUI 工具的布局）、**实际生效**的渲染器（WebGL 可能已静默回退到 DOM，字形与抗锯齿都会变）、以及非运行态的会话状态。没有活动终端时不占位

### 修复 🐛

- **终端聚焦时全局快捷键几乎全部失效** — xterm 用隐藏的 `<textarea class="xterm-helper-textarea">` 接收键盘，被 `isEditableTarget()` 判成普通输入框，于是除命令面板/快速打开外的所有快捷键（`Mod+W`、`Ctrl+Tab`、`Alt+方向键`、`Ctrl+Shift+F`、`Ctrl+G`、`F12`…）在终端里都被放行成裸字节发给 PTY。用户 95% 时间在终端里，等于快捷键系统整个失效
- **Alt+方向键抢走 shell 的前后词跳转** — 该键在 bash/zsh/fish 里都绑定词跳转。现在只有**确实存在该方位相邻分屏**时命令才生效，单分屏时还给 shell
- **分屏拖拽条是死的** — `TerminalResizer` 手势完整并 emit `resize`/`reset`，但树里没有任何监听者，`layout.resizeSplit` 从未被调用：把手画得出来、hover 有高亮，拖下去什么都不发生
- **分屏关不掉** — `TerminalPane` 声明了 `close` emit 却没有触发点，`closeLeafInTab` 只能收到一个永不发出的事件。分屏之后只能整标签关掉
- **终端内 Ctrl+F 不工作** — `TerminalSearch` 组件与 `SearchAddon` 早已写好并装载，全项目零引用
- **`tab.closeOthers` 的默认键位撞车** — `"Mod+K Mod+W"` 被 `normalizeKeybinding` 静默折叠成 `"Mod+W"`，与 `tab.close` 冲突；分发时按数组顺序先命中 `tab.close`，`closeOthers` 变成一条永远执行不到的死命令
- **`terminal.rename` 是孤儿命令** — 存在于 `CommandId` 联合类型和处理器表，却没有 spec 条目：既不进命令面板、也无法绑定
- **`Ctrl+G` 在终端里会打断正在敲的命令** — bash 的 `Ctrl+G` 是 abort。编辑器专属命令现在只在活动标签是编辑器时可用

### 新增 ✨

- **每个分屏一条标题栏** — 状态点（运行/启动中/已退出）+ 退出码、标题、cwd，以及分屏与关闭按钮。激活的分屏用 `--terminal-focus` 描边（此前 `isFocused` 唯一的副作用是 `outline: 0`，多 pane 时完全无法判断输入落在哪）
- **终端内查找面板** — `Ctrl+F` 开关，Enter/↓ 下一个、Shift+Enter/↑ 上一个、实时高亮与命中计数、Esc 关闭
- **回到底部浮层** — 上翻之后新内容还在往下涌，底部的“末尾”看不见也不知道差多少行；按钮直接显示差距并一键回底
- **终端右键菜单补全** — 清屏 / 重置 / 分屏 / 重命名 / 字号± / 关闭分屏，且全部文案走 i18n（此前只有 Copy/Paste/Select All 三项且**硬编码英文**，zh-CN 用户看到英文）
- **快捷键设置页** — 搜索过滤、冲突逐条详情、录入当场拒绝（撞车 / 无修饰键）、一键全部重置

### 重构 ♻️

- **命令系统单一事实源** — 49 分支 `switch` 改为 `Record<CommandId, …>`（漏写一条处理器从静默 no-op 变成编译期错误）；抽出 `specToDefinition` 供命令面板与设置页共用，不再各拼一遍
- **快捷键不再静默折叠** — `normalizeKeybinding` 拒绝和弦（多键序列）而不是取最后一个非修饰键 token
- **`CommandSpec` 承载可用性条件** — 新增 `when`（如“该方位有相邻分屏”）与 `captureInTerminal`，可用性判断从快捷键分发处收回 spec
- **分屏把手改 pointer 事件** — 鼠标版在 webview 里手感发涩；顺带补上最小边长夹取与 `containerSize` 上报

### 测试 🧪

- `commandSpecsContract.test.ts` / `shortcutCapture.test.ts` — 锁死「`CommandId` 联合类型 ↔ spec 表一致」「默认键位两两不撞」「终端 textarea 不算输入框」
- `paneInteraction.test.ts` / `paneWiring.test.ts` — 锁死把手与 pane 事件链完整、粘贴守卫挂在 `term.paste` 上
- `pasteGuard.test.ts` — 纯函数判定：单行 / 尾随换行 / 勾选删除一律不拦，只对大块多行内容拦
- `StatusDock.vue.test.ts` — 无活动终端时不占位；有则显示尺寸 / 渲染器 / 异常状态

### 门禁

- `pnpm test` 858 passed / 143 files、`pnpm build` ✓、`vue-tsc --noEmit` clean、`cargo clippy --all-targets --locked -- -D warnings` ✓

## [0.2.2] - 2026-09-27

### 新增 ✨

- **文件树拖拽搬运** — 默认拖拽即**移动**，按住 `Alt`/`Ctrl` 拖拽变**复制**；支持多选整批拖走、悬停目录 600ms 自动展开、拖到容器边缘自动滚动、非法落点提前变禁用态
- **文件剪贴板** — `Cmd/Ctrl+X/C/V` 剪切 / 复制 / 粘贴，右键菜单同步提供三项（多选时也能"复制"文件，此前只能复制路径）
- **从系统拖文件进工作区** — 从 Finder / 资源管理器把文件拖进文件树即复制到目标目录（走 Tauri webview drag-drop 通道，与树内拖拽共存）
- **批量搬运命令** `fs_move_many` / `fs_copy_many` — 逐条结算（成功 / 跳过 / 失败 / 跨设备），冲突三策略：覆盖 / 跳过 / 全部改名（默认，目录覆盖需二次勾选确认）
- **LSP 补全 / 悬浮 / 跳转定义** — `F12` 或 `Ctrl/Cmd+点击` 跳转，悬浮框显示类型与文档
- **树过滤 + 折叠/展开全部** — 过滤只作用在已加载的行上，保留命中项的祖先链与命中目录的后代
- **拖到行边缘 = 同级插入（drop-between）** — 行的上/下缘带画插入线，缩进跟随行层级；中间仍是"放进目录"
- **搬运进度条 + 取消** — 字节级进度（每 256KiB 一跳），协作式取消；已完成的条目保持完成、正在写的记失败、剩余的记跳过
- **撤销上一次移动** — 工具条按钮，单步撤销；只撤销移动不撤销复制，批量移动不提供撤销
- **剪切行变淡** — 剪切后待粘贴的行变淡，粘贴完成后恢复（VS Code 行为）
- **拖拽中按 Esc 取消** — 三处拖拽（标签 / 工作区 / 文件）统一支持
- **LSP 重命名符号（F2）** — 跨文件改动先给用户确认再落盘；查找引用（Shift+F12）
- **编辑器符号面包屑** — 光标所在的符号容器链，点击任一层跳转
- **保存时格式化** — 走语言服务器的 `textDocument/formatting`（rustfmt / gofmt 等），**默认关闭**
- **终端布局跨重启恢复** — 恢复标签排列、每个分屏的 cwd 与启动命令；不恢复运行中的进程（PTY 缓冲无法序列化，假装能恢复只会更糟）

### 修复 🐛

- **重命名 / 删除后编辑器标签指向失效路径** — explorer 发出的 `pathRenamed` / `pathDeleted` 事件在 `WorkspacePanel` 只声明不转发，脏缓冲保存会写回磁盘上不存在的文件，静默丢改动
- **图片预览从文件树打不开** — `openFilePreview` 同样被丢弃，文件树右键"打开预览"对图片完全无响应
- **复制会静默丢失符号链接** — 本地与 agent 各有一份 `copy_dir_recursive`，用 `file_type()` 同时判 `is_dir`/`is_file`，两头都不匹配就跳过；仓库里的 `node_modules` 符号链接复制后会凭空消失
- **跨设备移动无回退** — `fs_rename` 遇 `EXDEV` 直接失败；现在回退为 copy + delete，并在删源失败时显式报错（磁盘上已有两份）
- **拖进自身子目录会吞掉源目录** — 跨设备回退下的 copy + delete 会自噬；搬运层新增前置守卫
- **LSP 客户端能力声明为空对象** — 多数语言服务器据此判定客户端不支持补全/悬浮/跳转，**静默**降级为"没补全"
- **LSP 看不到未保存的编辑** — `didChange` 只在保存时发，server 手里的文档停留在上次保存的文本；而且声明了 `didSave` 能力却从未真正发送。改为编辑后防抖 300ms 推送 + 保存时 flush 并发 didSave
- **复制到尚不存在的目标目录会失败** — `File::create` 不建父目录。UI 一直落在已存在目录里所以从未暴露，但引擎必须能自建目标父目录
- **进度字节数被重复累加** — 回调契约写成了"增量"而实现给的是"累计"，进度会直接翻倍（测试抓到）
- **CodeMirror 桩缺 `domEventHandlers`** — 导致 EditorPane 测试里编辑器从未挂载，全部用例走兜底路径假绿

### 重构 ♻️

- **新增 `nexterm-fs-core` 共享 crate** — 搬运语义（冲突策略 / 跨设备回落 / 防自噬 / 符号链接）的唯一实现，宿主与 `nexterm-agent` 共同依赖，保证本地 / WSL / SSH 三条路径行为一致
- **抽出 `usePointerDragReorder`** — 标签重排、工作区重排、文件搬运三处重复的指针手势统一到一份实现（阈值 / ghost 缓存 / click 抑制 / window 监听成对移除），并加边界测试锁死
- **拆分 `FileExplorer.vue`** — 1771 行 → 712 行，拆为 `useFileTreeData`（数据）/ `useTreeSelection`（选择）/ `useTreeTransfer`（搬运）三个 composable，依赖单向无环
- **抽出 `useVirtualWindow`** 的消费方统一（文件树与 Git 历史共用）
- **新偏好 `terminalLayouts`** — 布局解析失败时丢弃该条而不是让整个偏好加载失败（偏好坏了不该让应用打不开）

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
