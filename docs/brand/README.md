# Nexterm · Brand Board v3.1

> **N × Cursor** — 几何等宽笔画的 N，右柱下半演化为发光的 cyan 方块光标。
>
> **v3.1 打磨**：N 字符 inner gradient（顶部白→底部灰）、光标 inner highlight（顶部反光带）+ inner shadow（底部暗带）、背景细微噪点纹理 + 顶部弧形高光带、N 微弱内描边让 mark 从背景"浮出"。光标方块现在是真正的 3D 立体方块，不再是平面色块。

## 快速查看

直接在浏览器打开 [`index.html`](./index.html) 即可看到完整设计稿：

- **Live 动画 hero**：光标方块持续呼吸（1.4s 周期，与终端光标 blink 同频）
- 新旧对比
- 全尺寸缩放（16 → 512）
- 多背景适配（深色 / 浅色 / 品牌渐变 / 噪点）
- 应用场景模拟（macOS dock / Windows taskbar / Android launcher / iOS home screen / favicon / toast）
- Android 13+ 单色变体在 4 种主题下的效果
- 几何构造 + 设计令牌 + 交付清单
- **横版 Lockup** 在深/浅/品牌背景下的自适应效果
- **动画 mark** 3 背景预览

## 文件结构

```
docs/brand/
├── README.md                       本文件
├── index.html                     品牌预览页（直接在浏览器打开）
├── logo-mark.svg                   透明背景 mark（README inline 嵌入）
├── logo-lockup.svg                 横版 lockup（mark + wordmark，自适应颜色）
└── logo-mark-animated.svg          光标呼吸动画 mark（splash / about / 营销）
```

## 设计资产（在 `src-tauri/` 下）

| 文件 | 用途 | viewBox |
|---|---|---|
| `app-icon.svg` | 主图标（macOS / Windows / Linux 主源） | 1024×1024 |
| `app-icon-fg.svg` | Android adaptive icon 前景层 | 108 dp |
| `app-icon-bg.svg` | Android adaptive icon 背景层（纯色） | 108 dp |
| `app-icon-monochrome.svg` | Android 13+ Themed Icon 单色版 | 108 dp |
| `app-icon-manifest.json` | `pnpm tauri icon` 入口清单 | — |

## 重新生成

改 SVG 后跑：

```bash
pnpm icon:regen
```

整套装会自动重新生成（含 macOS .icns / Windows .ico / Linux .png / Windows Store Square* / Android 全 mipmap / iOS 全 AppIcon）。

## 运行时窗口图标

`src-tauri/tauri.conf.json` 的 `app.windows[0].icon` 已指向 `icons/32x32.png`，
所以 `pnpm tauri dev` 运行时窗口、托盘、任务栏都会立即用上新图标。

## v3.1 打磨细节

| 维度 | v3 | v3.1 |
|---|---|---|
| 背景 | 双段对角渐变 | **三段对角渐变 + 细微噪点纹理 + 顶部弧形高光带** |
| N 字符 | 平涂 `#F4F8FB` | **inner gradient**（`#FFFFFF`→`#F4F8FB`→`#DDE3EA`）+ **微弱内描边** |
| 光标方块 | 渐变 + 外发光 | **渐变 + 外发光 + 顶部反光带（玻璃质感）+ 底部 inner shadow（深青蓝）+ 内核反光点** |
| 字符体积感 | 平面 | **3D 立体方块**（顶亮底暗） |

## 设计令牌

| Token | Hex | 用途 |
|---|---|---|
| `bg-deep` | `#0A0D12` | 圆角方框背景顶角 |
| `bg-mid` | `#11151B` | 圆角方框背景中段（v3.1 新增） |
| `bg-light` | `#161D26` | 圆角方框背景底角 |
| `gloss-top` | `#FFFFFF` α=0.09 | 顶部弧形高光带 |
| `grain-opacity` | `0.045` | 背景噪点纹理（v3.1 新增） |
| `ink-top` | `#FFFFFF` | N 字符顶部（inner gradient） |
| `ink-mid` | `#F4F8FB` | N 字符中段 |
| `ink-bottom` | `#DDE3EA` | N 字符底部（inner gradient，v3.1 新增） |
| `accent-cyan` | `#22D3EE` | 光标主色（electric cyan） |
| `accent-mint` | `#5EEAD4` | 光标中段（teal） |
| `accent-lime` | `#BEF264` | 光标高亮（acid lime） |
| `cursor-highlight` | `#FFFFFF` α=0.55→0 | 光标顶部反光带（v3.1 新增） |
| `cursor-shadow` | `#0E7490` α=0→0.55 | 光标底部 inner shadow（v3.1 新增） |

## 几何

- **画布**：1024 × 1024
- **圆角**：rx=224（≈ 22%，macOS 自动圆角 ≈ 18% 会二次叠加）
- **N 笔宽**：100 px
- **N 高度**：600 px（y: 212–812）
- **光标**：右柱下半 (662,512)–(762,812)，lime→mint→cyan 渐变 + 双层 Gaussian 外发光 + 顶部反光带 + 底部 inner shadow
- **安全边距**：≥ 12.5%（128 px）
- **小尺寸策略**：≥ 16 px 保留三段式 N 字符 + 异色光标块

## 动画节奏

光标方块呼吸动画（仅 `logo-mark-animated.svg`，不影响打包图标）：

| 元素 | 属性 | 周期 | 节奏 |
|---|---|---|---|
| 光标主体 | opacity 0.68 ↔ 1.00 + scale 0.985 ↔ 1.000 | 1.4s | ease-in-out infinite |
| 外发光宽 | opacity 0.18 ↔ 0.55 | 1.4s | ease-in-out infinite |
| 外发光紧凑 | opacity 0.18 ↔ 0.55 | 1.4s + 0.1s delay | ease-in-out infinite |
| N 字符 | scale 1.000 ↔ 1.004 | 4s | ease-in-out infinite（很微弱） |

**无障碍**：`@media (prefers-reduced-motion: reduce)` 时所有动画停止，光标方块停在第一帧（呼吸峰值）。