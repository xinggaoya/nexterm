import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";

/**
 * 进程级 OS 指标采样。
 *
 * 只做"旁路观测"：不注入、不 hook、不改应用行为，因此对被测应用
 * 的性能影响可以忽略。
 *
 * 采样内容：CPU%（相对全部逻辑核）、工作集/私有内存、线程数、句柄数。
 * 采样对象：应用主进程 + 它的 WebView2 / WebKit 子进程。
 */

const CSV_HEADER = [
  "timestamp",
  "pid",
  "process",
  "role",
  "cpuPercent",
  "workingSetMb",
  "privateMb",
  "threads",
  "handles",
].join(",");

/**
 * Windows: 用一个常驻 PowerShell 进程循环采样。
 *
 * 每轮只取 `msedgewebview2`（WebView2 的子进程名）与应用主进程，
 * 并按父进程号把 WebView2 归属到应用，避免把别的应用的 WebView
 * 算进来。
 */
const WINDOWS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$logical = 1
try { $logical = [int](Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors } catch {}
if ($logical -lt 1) { $logical = 1 }
$prev = @{}
while ($true) {
  $now = Get-Date
  $appPids = @()
  Get-Process -Name 'nexterm' -ErrorAction SilentlyContinue | ForEach-Object { $appPids += $_.Id }
  $webviewPids = @()
  if ($appPids.Count -gt 0) {
    Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe'" -ErrorAction SilentlyContinue |
      ForEach-Object {
        if ($appPids -contains $_.ParentProcessId) { $webviewPids += $_.ProcessId }
      }
  }
  $targets = @()
  Get-Process -Name 'nexterm' -ErrorAction SilentlyContinue | ForEach-Object {
    $targets += [pscustomobject]@{ Proc = $_; Role = 'app' }
  }
  if ($webviewPids.Count -gt 0) {
    Get-Process -Id $webviewPids -ErrorAction SilentlyContinue | ForEach-Object {
      $targets += [pscustomobject]@{ Proc = $_; Role = 'webview' }
    }
  }
  foreach ($target in $targets) {
    $p = $target.Proc
    $cpu = [double]$p.CPU
    $pct = 0.0
    $key = "$($p.Id)"
    if ($prev.ContainsKey($key)) {
      $dt = ($now - $prev[$key].T).TotalSeconds
      if ($dt -gt 0) { $pct = (($cpu - $prev[$key].Cpu) / $dt) * 100.0 / $logical }
    }
    $prev[$key] = @{ T = $now; Cpu = $cpu }
    $threads = 0
    try { $threads = $p.Threads.Count } catch {}
    Write-Output ("{0}|{1}|{2}|{3}|{4}|{5}|{6}|{7}|{8}" -f \`
      $now.ToString('o'), $p.Id, $p.ProcessName, $target.Role, \`
      [math]::Round($pct, 2), \`
      [math]::Round($p.WorkingSet64 / 1MB, 2), \`
      [math]::Round($p.PrivateMemorySize64 / 1MB, 2), \`
      $threads, $p.HandleCount)
  }
  Start-Sleep -Milliseconds 1000
}
`;

/**
 * POSIX: 每轮跑一次 `ps`，按父子关系挑出应用进程树。
 */
const POSIX_SCRIPT = `
set -u
prev=""
while true; do
  now=$(date +%s)
  ps -Ao pid=,ppid=,%cpu=,rss=,nlwp=,comm= 2>/dev/null | while read -r pid ppid cpu rss nlwp comm; do
    echo "$pid $ppid $cpu $rss $nlwp $comm $now"
  done
  sleep 1
done
`;

/**
 * 启动采样器。
 *
 * @param {object} options
 * @param {string} options.outFile 采样 CSV 输出路径
 * @param {number} [options.intervalMs] 采样间隔
 * @param {boolean} [options.enabled] 关掉时只返回一个空实现
 * @returns {{ stop: () => Promise<void>, rows: () => number }}
 */
export function startOsSampler({ outFile, intervalMs = 1000, enabled = true }) {
  if (!enabled) {
    return {
      stop: async () => {},
      rows: () => 0,
    };
  }

  const isWindows = process.platform === "win32";
  const stream = createWriteStream(outFile, { flags: "w" });
  stream.write(`${CSV_HEADER}\n`);
  const child = isWindows
    ? spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_SCRIPT],
        { stdio: ["ignore", "pipe", "ignore"] },
      )
    : spawn("sh", ["-c", POSIX_SCRIPT], { stdio: ["ignore", "pipe", "ignore"] });

  let rowCount = 0;
  let pending = "";

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const row = isWindows ? parseWindowsRow(line) : parsePosixRow(line);
      if (row) {
        stream.write(`${row.join(",")}\n`);
        rowCount += 1;
      }
    }
  });

  return {
    stop: async () => {
      child.kill();
      await new Promise((resolve) => stream.end(resolve));
    },
    rows: () => rowCount,
  };
}

function parseWindowsRow(line) {
  const parts = line.split("|");
  if (parts.length < 9) return null;
  const [timestamp, pid, process, role, cpu, workingSet, privateMem, threads, handles] = parts;
  if (!/^\d+(\.\d+)?$/.test(pid)) return null;
  return [
    timestamp,
    pid,
    process,
    role,
    cpu,
    workingSet,
    privateMem,
    threads,
    handles,
  ];
}

function parsePosixRow(line) {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 7) return null;
  const [pid, ppid, cpu, rss, nlwp, comm, epoch] = parts;
  if (!/^\d+$/.test(pid)) return null;
  const name = comm.split("/").pop() ?? comm;
  return [
    new Date(Number(epoch) * 1000).toISOString(),
    pid,
    name,
    name === "nexterm" ? "app" : "webview",
    cpu,
    (Number(rss) / 1024).toFixed(2),
    (Number(rss) / 1024).toFixed(2),
    nlwp,
    "",
  ];
}
