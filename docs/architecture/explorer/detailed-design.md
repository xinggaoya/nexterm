# 文件浏览器模块详细设计

> 历史说明：本文件此前描述的是 `ExplorerPane.vue` / `FileTree.vue` / `useExplorer.ts`
> 架构，这三个文件在 Vue 3 重构中已被删除。现内容按 2026-09 的实现重写。

## 1. 整体结构

```
FileExplorer.vue（712 行：props / 组装 / 模板）
  ├─ composables/useFileTreeData.ts    数据层：加载、展开态、行集、虚拟滚动、watcher 编排
  ├─ composables/useTreeSelection.ts   选择层：多选集、键盘光标、Shift 锚点、键盘导航
  └─ composables/useTreeTransfer.ts    搬运层：拖拽 / 剪贴板 / OS 拖入共用的搬运编排
       ├─ lib/fileTransfer.ts           纯函数：计划解析、落点守卫、命名规则
       ├─ lib/fileClipboard.ts          per-instance 内存剪贴板
       └─ lib/usePointerDragReorder     （实为 @/lib）指针拖拽手势
```

三层依赖**单向、无环**：

```
Transfer ──▶ Selection ──▶ Data ──▶ lib/*
```

搬运层需要知道"当前多选了哪些行"（拖拽源 / 粘贴落点），选择层需要知道"行集
怎么算出来的"，数据层两者都不需要。反向持有会成环，因此各层只通过 options
回调交互。

## 2. 数据流

```
用户交互 ─┬─▶ 行点击 / 键盘 ─▶ useTreeSelection ─▶ 选择集
          │                          │
          ├─▶ pointerdown ─▶ usePointerDragReorder ─▶ useTreeTransfer.runTransfer
          ├─▶ Cmd+C/X/V ──────────────────────────────────────┘
          └─▶ OS 拖入 ────▶ native.onOsFileDragDrop ───────────┘
                                        │
                          fileTransfer.planTransfer（纯函数）
                                        │
                    冲突？──▶ FileTransferConflictDialog ─▶ 策略
                                        │
                    wsNative.fsMoveMany / fsCopyMany ──▶ Rust fs-core
                                        │
              ┌─────────────────────────┴──────────────────────┐
        emit pathRenamed                              loadChildren(父目录)
              │                                                │
      WorkspaceHost → tabs.followPath                    展开目标目录
```

`WorkspaceFsChangedEvent`（watcher）单独一条线进数据层：180ms 防抖 →
`refreshTargetsForPaths` → 静默重读受影响的已加载目录。

## 3. 关键决策

### 3.1 为什么搬运走"共享 crate + 批量命令"

同一套搬运语义要在三个地方跑：本地（宿主直接 `std::fs`）、WSL（发行版内的
`nexterm-agent`）、SSH（远端主机内的 `nexterm-agent`）。差别只是"代码在哪个
进程里跑"，规则完全一致。

规则集中在 `nexterm-fs-core`：

| 规则 | 说明 |
|------|------|
| 冲突三策略 | `overwrite`（先删后写，目录递归删除）/ `skip` / `rename`（`foo.ext` → `foo copy.ext` → `foo copy 2.ext`） |
| 跨设备回落 | `rename` 遇 `EXDEV`(18) / `ERROR_NOT_SAME_DEVICE`(17) 退化为 copy + delete；删源失败显式冒泡并标 `crossDevice` |
| 防自噬 | 目标落在源自身或子目录内直接拒绝 —— 没有这道闸，跨设备回落会把源一路吞掉 |
| 符号链接 | 按链接本身重建而非跟随目标（判型必须用 `symlink_metadata`；Windows 无权限时跳过并产出 warning） |
| 逐条结算 | 多选搬运经常是"一部分成功一部分失败"，必须逐条回报，不能用 `Result<(), String>` 表达 |

放在共享 crate 而不是主 crate，是为了让 agent 复用同一份实现。历史上
`mutate.rs` 与 `agent/handlers.rs` 各有一份 `copy_dir_recursive`，两者行为已经
不一致（符号链接在两边都被静默跳过）。

### 3.2 为什么冲突检测在前端也做一遍

批量搬运的**策略要由人定**（覆盖不可逆，多选拖拽极易撞名），而后端只能拿到
已经定好的 `to` 路径。分工：

- 前端（`fileTransfer.planTransfer`）：发现冲突、征询用户、预排落点。
- 后端（`fs-core`）：在同批次内逐条继续避让（第一条改名成 `a copy` 后，第二条
  同名项要接着往后找序号）。

`planTransfer` 是纯函数、零 IO：存在性靠注入的 `exists` 回调（只读已加载的目录
条目），因此不必为一次拖拽把整条路径上的目录都拉起来。未加载的目录按"不冲突"
处理，由后端的 `rename` 策略兜底 —— 同样不丢数据。

### 3.3 为什么树内拖拽用 Pointer Events 而不是 HTML5 DnD

Tauri v2 默认 `dragDropEnabled: true`：系统层拖拽由 Tauri 拦截并以事件广播给
webview，webview 内的原生 `dragstart` / `drop` 拿不到。那条通道留给"从 Finder /
资源管理器拖文件进窗口"（`native.onOsFileDragDrop`）。两条通道互不干扰。

手势本体（阈值、ghost、click 抑制、window 监听成对移除）抽在
`@/lib/usePointerDragReorder`，与标签重排、工作区重排共用同一份实现；
`pointerDragBoundary.test.ts` 用静态扫描锁死"不再出现手写副本"。

### 3.4 为什么剪贴板不写系统剪贴板

文件树的 `Cmd+C` 与"复制文本"是同一个物理按键。放进系统剪贴板会互相覆盖 ——
用户选中一个文件按 Cmd+C，期望粘到另一个目录，却在别处粘贴出一串路径。
文本剪贴板由 `@/lib/clipboard` 负责，文件剪贴板只存在于内存。

`useFileClipboard()` 每次返回**独立实例**并由 FileExplorer 持有：文件树在每个
WorkspaceHost 里各有一份，所以剪贴板天然按工作区隔离、组件卸载即丢弃。

### 3.5 为什么树过滤只作用在已加载的行上

保持懒加载语义。真正的全量搜索走 `ExplorerSearch`（按名字）与 `FindInFilesPanel`
（按内容），树过滤只是"当前视图的快速筛选"。

`filterFileTreeRows` 的三条规则缺一不可：

- 保留命中项的**祖先链** —— 否则深层命中的文件因为父目录被隐藏而点不到；
- 保留命中**目录**的全部可见后代 —— 否则过滤 `src` 只得到一个点开是空的目录；
- `status` / `pending` 行不参与过滤 —— 错误提示与"新建文件"输入框属于结构而
  不是内容，隐藏它们会让内联输入框凭空消失。

祖先链与"是否在命中目录内"都用向上走查实现，复杂度 O(行数 × 深度)，不会因为
命中目录多而退化。

### 3.6 展开全部只处理已加载目录

为了铺开一棵树就把每个子目录都拉一遍，正是文件树在大仓里卡顿的主因。
未展开的目录仍然可以在点开时懒加载。

## 4. 时序与性能

| 机制 | 参数 | 原因 |
|------|------|------|
| watcher 事件防抖 | 180ms | 一次批量事件只触发一次重读 |
| 在途去重 | `inFlightLoads: Map<path, {rerun, silent}>` | 同一目录并发读合并为一次 + 一次补跑 |
| 静默刷新 | `silent: true` | 目录成员没变走 patch（只重算该目录的行），有增删才整棵重建 |
| 虚拟滚动 | 定高 24px，阈值 200 行 | 大仓（5k+ 文件）全量渲染会让 mount 与滚动掉到个位数 FPS |
| 边缘自动滚动 | 28px 触发区，rAF 驱动 | 指针不动时也要继续滚；虚拟滚动靠 scroll 事件更新可视区 |
| 悬停自动展开 | 600ms | 拖到折叠目录上停一下就展开；跳过源自身及其子目录 |
| 冲突征询 | 弹出前不写盘 | 覆盖不可逆，默认焦点落在"全部改名"；同名目标是**文件夹**时还需勾选确认 |

## 5. 事件契约

| 事件 | 消费方 | 语义 |
|------|--------|------|
| `pathRenamed` | WorkspaceHost → `tabs.followPath` | 重命名 / 移动后让已打开的编辑器 tab 跟随新路径。不跟随的话脏缓冲保存会写回不存在的路径 |
| `pathDeleted` | WorkspaceHost → `tabs.dropPath` | 目录删除按前缀批量关 tab；**脏编辑器保留**并提示用户（缓冲只在内存里） |
| `pathDuplicated` | 目前无消费方 | 纯通知型事件；树刷新与源控刷新已由 fsEvent 覆盖。待统一搬运事件 `pathsTransferred` 落地后由那条链路取代 |
| `openFilePreview` | WorkspaceHost → `tabs.newFilePreviewTab` | 图片 / 大文件走专用预览 tab，不进 CodeMirror |

## 6. 错误处理

- 单条搬运失败不阻断其余条目（后端逐条结算，前端逐条 toast）。
- 拒绝搬运的条目按**单一原因**折叠成具体说法（"不能把文件夹移动到自己的子目录
  里"）而不是"N 个项目无法移动"。
- 非法落点在拖拽过程中就变禁用态，松手不执行 —— 不能"先搬了再报错"。
- 跨设备回落单列汇报：语义是移动但中途可能留下双份，不能混进普通成功。
- `loadChildren` 失败写入 `nodes[path].status = "error"`，行集里出现一行红色状态
  文本，而不是整棵树变空。
- OS 拖入订阅失败（部分 Linux Wayland 组合）时降级为"不支持拖入"，不让整棵树挂掉。

## 7. 测试

| 文件 | 覆盖 |
|------|------|
| `lib/fileTransfer.test.ts` | 计划解析、落点守卫、命名规则、结果摘要 |
| `lib/fileClipboard.test.ts` | 实例隔离、快照语义、零项清空、复制可重复粘贴 |
| `lib/fileTreeRows.test.ts` | 行集构建、增量 patch、`filterFileTreeRows` |
| `lib/fileTreeRowsUpdate.test.ts` | 增量更新的正确性 |
| `lib/fileTreeService.test.ts` | 树数据源 |
| `FileExplorer.vue.test.ts` | 组件行为契约：加载、选择、键盘、拖拽、剪贴板、OS 拖入、过滤、折叠 |
| `ExplorerContextMenu.vue.test.ts` | 菜单项与动作 |
| `explorerVueBoundary.test.ts` | 模块边界（无 React 残留） |
| `@/lib/pointerDragBoundary.test.ts` | 拖拽手势只有一份实现 |

## 8. 相关文件

- 前端：`src/modules/explorer/`
- 共享搬运语义：`src-tauri/fs-core/`
- 后端命令：`src-tauri/src/modules/fs/mutate.rs`
- 拖拽手势：`src/lib/usePointerDragReorder.ts`
- 虚拟滚动：`src/lib/useVirtualWindow.ts`
