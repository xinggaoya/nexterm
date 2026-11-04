<script setup lang="ts">
/**
 * 「调试桥未就绪」提示页。
 *
 * 这个页面在**桥没起来**时渲染 —— 也就是普通浏览器打开了 nexterm 的前端，
 * 但本机运行中的桌面应用没有带 `web-dev-bridge` feature 启动。
 *
 * 为什么不直接白屏：桥没起来时后续所有 invoke 都会重试到超时再 reject，
 * 顶层 await 抛错 → 整个应用起不来，用户只看到一片空白，完全不知道该做什么。
 * 这里给出一句人话 + 一条可直接复制的命令。
 *
 * 样式刻意**不依赖应用主题变量**：这个页面挂在独立的 Vue app 上，
 * MainApp 那套运行时主题（CSS 变量）根本没被应用。自带一套中性色，
 * 并跟随 `prefers-color-scheme`。
 */
import { ref } from "vue";
import { probeDevBridge } from "@/lib/devBridge";

const props = withDefaults(defineProps<{ reload?: () => void }>(), {
  reload: () => window.location.reload(),
});

const checking = ref(false);
const ready = ref(false);

async function retry(): Promise<void> {
  checking.value = true;
  ready.value = await probeDevBridge();
  checking.value = false;
  if (ready.value) props.reload();
}
</script>

<template>
  <div class="bridge-fallback">
    <div class="bridge-card">
      <span class="bridge-badge">DEBUG BRIDGE</span>

      <h1 class="bridge-title">调试桥未就绪</h1>

      <p class="bridge-text">
        当前页面运行在普通浏览器里，但本机的 Nexterm
        调试桥没有启动。调试桥是运行中的桌面应用在
        <code>127.0.0.1</code> 上开的调试端口 —— 它不在，浏览器就拿不到真实后端。
      </p>

      <p class="bridge-text">请另开一个终端，用下面的命令启动桌面应用：</p>

      <pre class="bridge-command"><code>pnpm tauri dev -- --features web-dev-bridge</code></pre>

      <p class="bridge-hint">
        启动后回到这个页面点「重新检测」。调试桥只在
        <code>127.0.0.1</code> 上监听，且仅接受来自
        <code>http://localhost:3180</code> 的浏览器请求。
      </p>

      <div class="bridge-actions">
        <button class="bridge-button" type="button" :disabled="checking" @click="retry">
          {{ checking ? "检测中…" : "重新检测" }}
        </button>
        <span v-if="ready" class="bridge-ready">调试桥已就绪，正在重新加载…</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bridge-fallback {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  box-sizing: border-box;
  background: #f6f7f9;
  color: #1c2024;
  font-family:
    "Inter Variable", "Noto Sans Mono", system-ui, -apple-system, sans-serif;
}

.bridge-card {
  width: 100%;
  max-width: 34rem;
  box-sizing: border-box;
  padding: 2rem;
  border: 1px solid #e3e6ea;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 1px 2px rgb(16 24 40 / 4%), 0 12px 32px rgb(16 24 40 / 6%);
}

.bridge-badge {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border: 1px solid #e3e6ea;
  border-radius: 999px;
  background: #f6f7f9;
  color: #6b7280;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.bridge-title {
  margin: 0.875rem 0 0;
  font-size: 1.375rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.bridge-text {
  margin: 0.75rem 0 0;
  font-size: 0.875rem;
  line-height: 1.65;
  color: #4b5563;
}

.bridge-text code,
.bridge-hint code {
  padding: 0.1rem 0.3rem;
  border-radius: 4px;
  background: #f1f3f5;
  color: #374151;
  font-family: "JetBrains Mono", "Noto Sans Mono", ui-monospace, monospace;
  font-size: 0.8125em;
}

.bridge-command {
  margin: 0.625rem 0 0;
  padding: 0.75rem 1rem;
  overflow-x: auto;
  border: 1px solid #e3e6ea;
  border-radius: 8px;
  background: #f6f7f9;
  font-family: "JetBrains Mono", "Noto Sans Mono", ui-monospace, monospace;
  font-size: 0.8125rem;
  line-height: 1.5;
  white-space: pre;
  color: #1c2024;
}

.bridge-hint {
  margin: 0.875rem 0 0;
  font-size: 0.8125rem;
  line-height: 1.65;
  color: #6b7280;
}

.bridge-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 1.5rem;
}

.bridge-button {
  padding: 0.5rem 1rem;
  border: 1px solid transparent;
  border-radius: 8px;
  background: #1c2024;
  color: #ffffff;
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 120ms ease;
}

.bridge-button:hover:not(:disabled) {
  opacity: 0.85;
}

.bridge-button:disabled {
  opacity: 0.5;
  cursor: default;
}

.bridge-ready {
  font-size: 0.8125rem;
  color: #15803d;
}

@media (prefers-color-scheme: dark) {
  .bridge-fallback {
    background: #0e1116;
    color: #e6e8eb;
  }

  .bridge-card {
    border-color: #262b33;
    background: #151a21;
    box-shadow: 0 1px 2px rgb(0 0 0 / 30%), 0 12px 32px rgb(0 0 0 / 35%);
  }

  .bridge-badge {
    border-color: #262b33;
    background: #1b212a;
    color: #9aa3af;
  }

  .bridge-text {
    color: #a8b0bb;
  }

  .bridge-text code,
  .bridge-hint code {
    background: #1b212a;
    color: #cdd3db;
  }

  .bridge-command {
    border-color: #262b33;
    background: #1b212a;
    color: #e6e8eb;
  }

  .bridge-hint {
    color: #7d8692;
  }

  .bridge-button {
    background: #e6e8eb;
    color: #0e1116;
  }

  .bridge-ready {
    color: #4ade80;
  }
}
</style>
