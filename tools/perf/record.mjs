#!/usr/bin/env node
/**
 * 性能录制主脚本。
 *
 * 一条命令完成「建会话目录 → 以录制态启动 Nexterm → 旁路采样 OS 指标
 * → 应用退出后出报告」的全流程。
 *
 * 用法：
 *   node tools/perf/record.mjs                     # 自动选择 dev / release
 *   node tools/perf/record.mjs --mode=dev          # 开发模式（含热更新，最真实）
 *   node tools/perf/record.mjs --mode=release      # release 二进制
 *   node tools/perf/record.mjs --label=git-操作     # 给会话起个名字
 *   node tools/perf/record.mjs --duration=120       # 采样 120 秒后收尾（应用继续跑）
 *
 * 产物：perf-reports/<时间戳>-<label>/{frontend.json,backend.json,os-samples.csv,report.md,summary.json}
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeSession } from "./lib/analyze.mjs";
import { startOsSampler } from "./lib/osSampler.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const defaultOutDir = join(repoRoot, "perf-reports");

function parseArgs(argv) {
  const options = {
    mode: "auto",
    label: "session",
    durationSec: 0,
    os: true,
    outDir: defaultOutDir,
  };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    switch (key) {
      case "mode":
        options.mode = value ?? "auto";
        break;
      case "label":
        options.label = value ?? "session";
        break;
      case "duration":
        options.durationSec = Number(value ?? 0);
        break;
      case "out":
        options.outDir = resolve(repoRoot, value ?? defaultOutDir);
        break;
      case "no-os":
        options.os = false;
        break;
      case "help":
        options.help = true;
        break;
      default:
        break;
    }
  }
  return options;
}

function help() {
  console.log(`
性能录制脚本

  --mode=auto|dev|release   启动方式（默认 auto：优先 release 二进制，没有则 dev）
  --label=<名字>             会话标签（默认 session）
  --duration=<秒>            采样多少秒后收尾（0 = 等应用退出）
  --out=<目录>               报告输出根目录（默认 perf-reports/）
  --no-os                    不做进程级 OS 采样
  --help                     显示本帮助
`);
}

/** 找到可用的 release / debug 二进制。 */
function findBinary(profile) {
  const names = process.platform === "win32" ? ["nexterm.exe"] : ["nexterm"];
  for (const name of names) {
    const path = join(repoRoot, "src-tauri", "target", profile, name);
    if (existsSync(path)) return path;
  }
  return null;
}

/** 二进制是否比源码旧（旧的二进制里没有 perf 埋点）。 */
function isStale(binaryPath) {
  const binaryTime = statSync(binaryPath).mtimeMs;
  let newest = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "target" || entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (/\.(rs|ts|vue)$/.test(entry.name)) {
        newest = Math.max(newest, statSync(path).mtimeMs);
      }
    }
  };
  walk(join(repoRoot, "src-tauri", "src"));
  walk(join(repoRoot, "src"));
  return binaryTime < newest;
}

function launch(mode, env) {
  const spawnDev = () =>
    spawn("pnpm", ["tauri", "dev"], {
      env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

  if (mode === "release") {
    const binary = findBinary("release") ?? findBinary("debug");
    if (!binary) throw new Error("找不到 release 二进制，请先执行 pnpm tauri build");
    return spawn(binary, [], { env, stdio: "inherit" });
  }
  if (mode === "dev") {
    return spawnDev();
  }
  // auto：优先用"不比源码旧"的二进制（省一次编译），
  // 否则回退 dev 模式（cargo 会自动增量编译）。
  for (const profile of ["release", "debug"]) {
    const binary = findBinary(profile);
    if (binary && !isStale(binary)) {
      console.log(`→ 使用 ${profile} 二进制启动（${binary}）`);
      return spawn(binary, [], { env, stdio: "inherit" });
    }
  }
  console.log("→ 没有比源码新的二进制，使用 dev 模式（首次会编译）");
  return spawnDev();
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function sessionStamp() {
  const now = new Date();
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    help();
    return;
  }

  const sessionId = `${sessionStamp()}-${options.label.replace(/[^\w.-]+/g, "_")}`;
  const sessionDir = join(options.outDir, sessionId);
  mkdirSync(sessionDir, { recursive: true });

  const env = { ...process.env, NEXTERM_PERF_DIR: sessionDir };

  console.log("┌──────────────────────────────────────────────┐");
  console.log("│  Nexterm 性能录制                              │");
  console.log("└──────────────────────────────────────────────┘");
  console.log(`会话目录：${sessionDir}`);
  console.log("现在正常使用应用（开终端、跑 git、切文件、滚动列表……），");
  console.log("完成后关闭应用窗口即可自动出报告。Ctrl+C 也会收尾。");
  console.log("");

  const sampler = startOsSampler({
    outFile: join(sessionDir, "os-samples.csv"),
    enabled: options.os,
  });

  let child;
  try {
    child = launch(options.mode, env);
  } catch (error) {
    await sampler.stop();
    console.error(`启动失败：${error.message}`);
    process.exitCode = 1;
    return;
  }

  let finished = false;
  const finish = async (reason) => {
    if (finished) return;
    finished = true;
    console.log(`\n→ ${reason}，正在收尾…`);
    await sampler.stop();
    const { summary, markdown } = analyzeSession(sessionDir);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(sessionDir, "report.md"), markdown, "utf8");
    writeFileSync(
      join(sessionDir, "summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
      "utf8",
    );
    console.log(`报告：${join(sessionDir, "report.md")}`);
    if (summary.findings?.length) {
      console.log("");
      console.log("要点：");
      for (const finding of summary.findings) {
        console.log(`  - ${finding.replace(/\*\*/g, "")}`);
      }
    } else {
      console.log("（未触发任何告警阈值）");
    }
  };

  let durationTimer = null;
  if (options.durationSec > 0) {
    durationTimer = setTimeout(() => {
      void finish(`已采样 ${options.durationSec} 秒`);
      child.kill();
    }, options.durationSec * 1000);
  }

  child.on("exit", (code) => {
    if (durationTimer) clearTimeout(durationTimer);
    void finish(`应用已退出（code=${code}）`);
  });

  child.on("error", (error) => {
    console.error(`应用启动错误：${error.message}`);
  });

  process.on("SIGINT", () => {
    console.log("");
    void finish("收到 Ctrl+C");
    child.kill();
    setTimeout(() => process.exit(0), 1500);
  });
}

main();
