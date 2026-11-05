#!/usr/bin/env node
/**
 * 性能报告分析 CLI。
 *
 * 用法：
 *   node tools/perf/analyze.mjs                 # 分析最近一次录制
 *   node tools/perf/analyze.mjs <会话目录>       # 分析指定会话
 *
 * 产物：<会话目录>/report.md + <会话目录>/summary.json
 */
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeSession } from "./lib/analyze.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));

/** 解析目标会话目录：可以是具体会话，也可以是 perf-reports 根目录。 */
function resolveSessionDir(input) {
  const target = resolve(repoRoot, input ?? "perf-reports");
  if (!existsSync(target)) {
    throw new Error(`目录不存在：${target}`);
  }
  const entries = readdirSync(target)
    .map((name) => join(target, name))
    .filter((path) => statSync(path).isDirectory())
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  if (
    existsSync(join(target, "frontend.json")) ||
    existsSync(join(target, "backend.json")) ||
    existsSync(join(target, "os-samples.csv"))
  ) {
    return target;
  }
  if (entries.length === 0) {
    throw new Error(`没有可分析的会话：${target}`);
  }
  return entries[0];
}

function main() {
  const target = process.argv[2];
  const sessionDir = resolveSessionDir(target);
  const { summary, markdown } = analyzeSession(sessionDir);

  const reportPath = join(sessionDir, "report.md");
  const summaryPath = join(sessionDir, "summary.json");
  writeFileSync(reportPath, markdown, "utf8");
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log(`报告已生成：${reportPath}`);
  console.log(`汇总已生成：${summaryPath}`);
  if (summary.findings?.length) {
    console.log("");
    console.log("要点：");
    for (const finding of summary.findings) console.log(`  - ${finding.replace(/\*\*/g, "")}`);
  }
}

main();
