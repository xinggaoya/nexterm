# picker（文件 / 文件夹选择器）

## 1. 概述

环境感知的应用内文件 / 文件夹选择对话框。本机与 WSL 环境的工作区目录选择统一
走本模块 —— 浏览范围被限制在目标环境自己的文件系统里：WSL 发行版内是 Linux
路径（/home/...），本机是 Windows 路径（C:/...，快捷位置含 `local_list_roots`
枚举的盘符）—— 从根上避免「在 WSL 工作区里选出 Windows 盘符 / UNC 路径」的
环境混淆。SSH 环境不选目录，走连接对话框。

## 2. 目录与文件

```
src/modules/picker/
  pickerTypes.ts        # PickerMode / PickerPlace / FilePickerOptions
  pickerService.ts      # 纯函数：面包屑、父子路径、排序、过滤、确认目标
  FilePickerDialog.vue  # 对话框 UI（NModal 预设 card）
  filePickerDialog.ts   # 命令式挂载 openFilePicker(options) => Promise<string|null>
  index.ts
```

## 3. 依赖

### 3.1 内部依赖

- `@/lib/native` -- `createNativeForEnv(workspace).fsReadDir / fsCreateDir`（环境
  路由的核心：传 WSL env 时后端把 Linux 路径映射到 `\\wsl.localhost` 读取），
  `native.getWslHome / getLaunchDir`（初始目录探测）
- `@/modules/workspace/workspaceEnvSnapshot` -- `WorkspaceEnv` 类型（仅类型）
- `@/modules/workspace/workspacePath` -- `normalizeWorkspacePath`（仅纯函数）
- `@/modules/explorer/lib/iconResolver` -- 文件 / 文件夹图标（Catppuccin）
- `@/modules/theme/naiveTheme` -- 独立挂载时读取当前 Naive UI 主题

### 3.2 外部依赖

- `naive-ui` -- NModal / NInput / NButton / NTag / NSpin
- `@vicons/ionicons5` -- 工具栏图标

## 4. 数据契约

### 4.1 公共类型

```ts
type PickerMode = "directory" | "file";
type PickerPlace = { key: string; label: string; path: string };
type FilePickerOptions = {
  mode: PickerMode;
  workspace: WorkspaceEnv; // 决定浏览哪个文件系统
  title?: string;
  initialPath?: string;
  fileName?: string;
  places?: PickerPlace[];
};
```

### 4.2 Tauri 命令

不注册新命令；复用 fs 模块的 `fs_read_dir`、`fs_create_dir`（经 `native.ts`），
以及 workspace 模块的 `local_list_roots`（本机盘符/根枚举，本机模式快捷位置）。

### 4.3 事件

无。

## 5. Pinia 状态

无（无状态模块；命令式 API，返回 Promise）。

## 6. 关键算法 / 数据流

```
openFilePicker({ mode, workspace, ... })
  → detached mount FilePickerDialog（NConfigProvider 注入当前主题）
  → onMounted: getWslHome / getLaunchDir 解析初始目录，失败逐级退回（initial → home → "/"）
  → navigate(path): createNativeForEnv(workspace).fsReadDir(path, showHidden)
      · requestSeq 丢弃过期响应
      · 失败保留当前目录并显示错误
      · 大目录：排序一次后按 PICKER_LOAD_CHUNK 分块注入响应式数组，
        块间 await nextTick() 让出主线程（懒注入，首屏即时可交互）
  → 渲染: NVirtualList 只绘制视口内行（虚拟列表，几万条不卡顿）
  → confirm: resolvePickerConfirm 按 mode 计算目标路径 → emit confirm(path)
```

- 路径在 webview 内统一以 "/" 表示；WSL 返回 Linux 绝对路径，本机返回
  `C:/...` 形态（`normalizeWorkspacePath` 规范化）。
- `parentPickerPath` / `splitPickerPath` 按 env 区分 POSIX 根 `/` 与 Windows
  盘符根 `C:/`。
- 大目录三件套：`NVirtualList` 虚拟渲染 + 分块懒注入 + 过滤输入 120ms 防抖；
  工具栏实时显示过滤后条目数（`picker.itemCount`）。

## 7. 配置项

无偏好设置；常量见 `FilePickerDialog.vue`（`ROW_HEIGHT`、
`PICKER_LOAD_CHUNK`、`FILTER_DEBOUNCE_MS`）。

## 8. 测试

- `pickerService.test.ts` -- 路径切分 / 父子 / 排序 / 过滤 / 确认目标 / 大小格式化
- `FilePickerDialog.vue.test.ts` -- 列表渲染、单击选中、双击进入、过滤（防抖）、
  隐藏文件开关、初始目录失败回退、5000 条大目录分块注入 + 计数、file 模式
  手输文件名、取消；文件头安装 jsdom 下 NVirtualList 所需的
  matchMedia / ResizeObserver / 布局属性 stub（与 SourceControlPanel 同款）

## 9. 相关文档

- [workspace 模块](../workspace/) -- 调用方：`pickWorkspaceDirectory` 的
  local → 本模块（盘符快捷入口）/ wsl → 本模块（Linux 文件系统）/
  ssh → 连接对话框 分流；`local_list_roots` 命令在 workspace 模块
- [02-module-contracts](../02-module-contracts.md) -- IPC 契约总览
