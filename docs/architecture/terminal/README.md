# 终端模块

## 概述

终端模块是 Nexterm 的核心模块，负责终端会话管理、PTY 桥接和 xterm.js 渲染。

## 主要组件

### 前端组件

- `src/modules/terminal/` - 终端模块根目录
- `TerminalPane.vue` - 终端面板组件
- `TerminalView.vue` - xterm.js 视图组件
- `useTerminal.ts` - 终端组合式函数
- `terminalTypes.ts` - 类型定义

### 后端模块

- `src-tauri/src/modules/pty/` - PTY 模块
- `mod.rs` - PTY 命令注册
- `session.rs` - PTY 会话管理
- `transcript.rs` - 输出转录存储

## 依赖关系

### 前端依赖

- `@/lib/native` - Tauri IPC 封装
- `@xterm/xterm` - 终端渲染引擎
- `@xterm/addon-*` - xterm 扩展

### 后端依赖

- `portable-pty` - PTY 会话管理
- `tempfile` - 临时文件存储
- `tauri` - 事件总线

## 接口定义

### Tauri 命令

| 命令 | 参数 | 返回值 | 描述 |
|------|------|--------|------|
| `pty_open` | `PtyConfig` | `PtyInfo` | 打开新的 PTY 会话 |
| `pty_write` | `id: u32, data: String` | `void` | 向 PTY 写入数据 |
| `pty_resize` | `id: u32, size: PtySize` | `void` | 调整终端大小 |
| `pty_read_transcript` | `id: u32` | `String` | 读取转录内容 |
| `pty_close` | `id: u32` | `void` | 关闭 PTY 会话 |

### 前端接口

```typescript
interface TerminalInstance {
  id: number
  element: HTMLElement
  xterm: Terminal
  fitAddon: FitAddon
  searchAddon: SearchAddon
}

interface TerminalConfig {
  shell: string
  args: string[]
  cwd: string
  env: Record<string, string>
}
```

## 配置选项

### 终端配置

```typescript
interface TerminalSettings {
  fontSize: number
  fontFamily: string
  theme: string
  cursorStyle: 'block' | 'underline' | 'bar'
  cursorBlink: boolean
  scrollback: number
}
```

## 相关文档

- [详细设计](./detailed-design.md)