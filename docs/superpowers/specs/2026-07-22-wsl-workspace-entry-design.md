# Windows WSL 工作区入口设计

## 背景

当前工作区栏的“添加工作区”事件不携带 `WorkspaceEnv`，`MainApp` 会使用默认的 local 环境打开目录选择器。即使用户在 Windows 目录选择器中进入 `\\wsl.localhost\<distro>\...`，这条入口仍可能把目录作为 Windows UNC 路径授权和打开。

欢迎页虽然已经展示“打开 WSL · <distro>”快捷按钮，但按钮目前只更新临时 `pendingEnv`，没有立即启动对应 WSL 环境的目录选择流程。界面表达和实际行为不一致。

## 目标

- Windows 下提供明确、可发现的 WSL 工作区添加入口。
- 用户选择某个 WSL 发行版后，目录选择、后端授权和工作区实例始终使用同一个显式 `WorkspaceEnv`。
- 本机工作区入口继续明确使用 local 环境。
- 非 Windows 平台保持现有界面和行为。

## 非目标

- 不根据 `\\wsl.localhost` 或 `\\wsl$` 路径自动推断工作区环境。
- 不改变 Rust 侧 WSL 路径规范化和授权逻辑。
- 不改变最近工作区、工作区恢复或新窗口打开流程。
- 不引入新的全局环境单例。

## 交互设计

工作区栏继续保留“+”按钮作为本机工作区入口。在 Windows 且检测到 WSL 发行版时，在其旁边显示服务器图标按钮；点击后弹出紧凑菜单，列出已安装发行版。选择发行版会立即打开以该发行版 home 为默认位置的目录选择器。

嵌入左侧栏的工作区列表使用相同入口：本机入口是一行普通命令，WSL 入口是一行带发行版菜单的命令。没有检测到 WSL 发行版时不显示空菜单按钮。

欢迎页上的“打开本机 home”和“打开 WSL · <distro>”快捷按钮改为直接启动对应环境的目录选择器，不再只修改 `pendingEnv`。顶部环境选择器仍可作为主“打开文件夹”按钮的目标环境选择控件。

## 架构与数据流

新增一个工作区模块内的轻量控制组件，负责：

1. 从 `workspaceEnvPinia` 读取 WSL 发行版列表。
2. 根据 `IS_WINDOWS` 和发行版列表决定是否显示 WSL 菜单。
3. 将本机操作发出为 `LOCAL_WORKSPACE`，将 WSL 操作发出为 `{ kind: "wsl", distro }`。
4. 支持工作区栏的图标模式和嵌入侧栏的行模式，避免复制菜单映射逻辑。

`WorkspaceBar -> TitleBar/LeftSidebar -> WorkspaceHost -> MainApp` 的 `add-workspace` 事件统一携带 `WorkspaceEnv`。`MainApp` 直接调用现有 `startAddWorkspace(env)`；目录选择结果继续由 `workspaceRootPinia.pickWorkspaceDirectory(env)` 生成，并由 `workspacesPinia.addWorkspace(path, env)` 授权和创建实例。

欢迎页的 `chooseWorkspace` 事件同样携带 `WorkspaceEnv`，从而复用 `MainApp` 的同一入口。`pendingEnv` 只服务于欢迎页环境选择器，不再作为其他添加入口的隐式默认值。

## 错误处理

继续复用 `startAddWorkspace` 现有异常处理。WSL home 查询失败时，`workspaceRootPinia` 会以无默认目录打开选择器；授权失败时向用户显示原始错误。发行版列表为空时不渲染 WSL 菜单，避免不可操作入口。

## 测试

- 新增工作区添加控制组件测试：非 Windows/无发行版时不显示 WSL 入口；Windows 下列出发行版；选择后发出正确 `WorkspaceEnv`。
- 更新 `WorkspaceWelcome.vue` 测试：本机和 WSL 快捷按钮直接发出带环境的 `chooseWorkspace`。
- 更新事件链相关组件测试，确认 `WorkspaceEnv` 不会在转发中丢失。
- 更新 `MainApp.vue` 测试，确认 WSL 入口调用目录选择器时传入所选发行版，并创建 WSL 工作区。
- 运行聚焦 Vitest、完整 `pnpm test` 和 `pnpm build`。
