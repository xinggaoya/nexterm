# Windows ConPTY 侧载组件

`conpty.dll` 与 `OpenConsole.exe` 随 nexterm.exe 部署后，portable-pty 会自动
优先加载它们（见 portable-pty `src/win/psuedocon.rs` 的 `load_conpty()`，
侧载优先于 kernel32 系统版）。

## 为什么需要

系统 conhost 版 ConPTY 会把 TUI 输出的越界光标定位序列（如
`\x1b[23;188H`）原样透传给 xterm，xterm 裁剪到行尾，导致 CJK 输入法
候选框锚定到行尾而非插入点。新版 conpty.dll + OpenConsole.exe 宿主会把
定位归一化到"本行最后一个非空字符"（即 TUI 绘制的光标格 = 插入点），
输入法候选框随之准确。已被 VS Code / Zed 等采用。

## 来源与许可

取自 pywinpty 3.0.5 wheel，构建自 microsoft/terminal（MIT License）。
升级时跟踪 microsoft/terminal 或 node-pty 的发布产物。

## 部署位置要求

两个文件必须与 nexterm.exe 同目录（LoadLibrary 按应用目录搜索）：
- 开发构建：由 `build.rs` 复制到 `target/{debug,release}/`。
- 打包分发：由 `tauri.windows.conf.json` 的 `bundle.resources` 映射到安装根目录。
