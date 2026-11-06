//! 后端命令耗时统计。
//!
//! 只在性能录制态打开（进程带 `NEXTERM_PERF_DIR` 环境变量或 `--perf-dir=`
//! 参数启动）。关闭时 `record` 只做一次原子读随即返回，生产构建几乎零成本。
//!
//! 埋点位置由各业务模块显式调用（git 域集中在 `git_command!` 宏里，
//! fs / pty / lsp 挑了慢路径命令），因此这里只负责聚合与快照。

use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;

/// 单个命令保留的耗时样本上限，超出后做 1/2 降采样。
const MAX_SAMPLES: usize = 1024;

/// 录制态开关。`false` 时所有埋点立即返回。
static ENABLED: AtomicBool = AtomicBool::new(false);

/// 打开/关闭后端计时。
pub fn set_enabled(enabled: bool) {
    ENABLED.store(enabled, AtomicOrdering::Relaxed);
}

/// 当前是否处于后端计时状态。
pub fn is_enabled() -> bool {
    ENABLED.load(AtomicOrdering::Relaxed)
}

/// 毫秒级 Unix 时间戳。
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or_default()
}

/// 单个命令的聚合数据。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandStat {
    pub cmd: String,
    pub count: u64,
    pub errors: u64,
    pub total_ms: f64,
    pub p50_ms: f64,
    pub p95_ms: f64,
    pub max_ms: f64,
}

#[derive(Debug, Clone, Default)]
struct CommandEntry {
    count: u64,
    errors: u64,
    total_ms: f64,
    max_ms: f64,
    samples: Vec<f64>,
}

impl CommandEntry {
    fn push(&mut self, duration_ms: f64, ok: bool) {
        self.count += 1;
        if !ok {
            self.errors += 1;
        }
        self.total_ms += duration_ms;
        if duration_ms > self.max_ms {
            self.max_ms = duration_ms;
        }
        self.samples.push(duration_ms);
        if self.samples.len() > MAX_SAMPLES {
            // 1/2 降采样：保留偶数位。内存恒定，代价是分位数变近似值。
            let mut kept = Vec::with_capacity(self.samples.len() / 2);
            let mut index = 0;
            while index < self.samples.len() {
                kept.push(self.samples[index]);
                index += 2;
            }
            self.samples = kept;
        }
    }

    fn percentile(&self, fraction: f64) -> f64 {
        if self.samples.is_empty() {
            return 0.0;
        }
        let mut sorted = self.samples.clone();
        sorted.sort_by(|left, right| left.partial_cmp(right).unwrap_or(Ordering::Equal));
        let index = ((sorted.len() as f64 * fraction).floor() as usize).min(sorted.len() - 1);
        sorted[index]
    }

    fn to_stat(&self, cmd: &str) -> CommandStat {
        CommandStat {
            cmd: cmd.to_string(),
            count: self.count,
            errors: self.errors,
            total_ms: round2(self.total_ms),
            p50_ms: round2(self.percentile(0.5)),
            p95_ms: round2(self.percentile(0.95)),
            max_ms: round2(self.max_ms),
        }
    }
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

#[derive(Default)]
struct Recorder {
    entries: Mutex<BTreeMap<String, CommandEntry>>,
}

static RECORDER: OnceLock<Recorder> = OnceLock::new();

fn global() -> &'static Recorder {
    RECORDER.get_or_init(Recorder::default)
}

/// 记录一次命令执行结果。
pub fn record(cmd: &str, duration: Duration, ok: bool) {
    if !is_enabled() {
        return;
    }
    let mut guard = match global().entries.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    guard
        .entry(cmd.to_string())
        .or_default()
        .push(duration.as_secs_f64() * 1000.0, ok);
}

/// 同步命令计时。
pub fn timed<T, E>(cmd: &str, action: impl FnOnce() -> Result<T, E>) -> Result<T, E> {
    if !is_enabled() {
        return action();
    }
    let started = Instant::now();
    let result = action();
    record(cmd, started.elapsed(), result.is_ok());
    result
}

/// 同步命令计时（无 Result 返回值）。
pub fn timed_value<T>(cmd: &str, action: impl FnOnce() -> T) -> T {
    if !is_enabled() {
        return action();
    }
    let started = Instant::now();
    let result = action();
    record(cmd, started.elapsed(), true);
    result
}

/// 异步命令计时。
pub async fn timed_async<T, E>(
    cmd: &str,
    future: impl Future<Output = Result<T, E>>,
) -> Result<T, E> {
    if !is_enabled() {
        return future.await;
    }
    let started = Instant::now();
    let result = future.await;
    record(cmd, started.elapsed(), result.is_ok());
    result
}

/// 异步命令计时（无 Result 返回值）。
pub async fn timed_value_async<T>(cmd: &str, future: impl Future<Output = T>) -> T {
    if !is_enabled() {
        return future.await;
    }
    let started = Instant::now();
    let result = future.await;
    record(cmd, started.elapsed(), true);
    result
}

/// 全部命令的聚合快照（按累计耗时降序）。
pub fn snapshot() -> Vec<CommandStat> {
    let guard = match global().entries.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let mut stats: Vec<CommandStat> = guard
        .iter()
        .map(|(cmd, entry)| entry.to_stat(cmd))
        .collect();
    stats.sort_by(|left, right| {
        right
            .total_ms
            .partial_cmp(&left.total_ms)
            .unwrap_or(Ordering::Equal)
    });
    stats
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_count_errors_and_extremes() {
        let mut entry = CommandEntry::default();
        entry.push(10.0, true);
        entry.push(20.0, true);
        entry.push(30.0, false);

        let stat = entry.to_stat("git_status");
        assert_eq!(stat.count, 3);
        assert_eq!(stat.errors, 1);
        assert_eq!(stat.total_ms, 60.0);
        assert_eq!(stat.max_ms, 30.0);
        assert!(stat.p50_ms >= 10.0 && stat.p50_ms <= 30.0);
    }

    #[test]
    fn decimation_keeps_memory_bounded() {
        let mut entry = CommandEntry::default();
        for index in 0..(MAX_SAMPLES as u64 * 3) {
            entry.push(index as f64, true);
        }
        assert!(entry.samples.len() <= MAX_SAMPLES);
        assert_eq!(entry.count, MAX_SAMPLES as u64 * 3);
        assert_eq!(entry.max_ms, (MAX_SAMPLES as u64 * 3 - 1) as f64);
    }

    #[test]
    fn timing_helpers_are_transparent_when_disabled() {
        let previous = is_enabled();
        set_enabled(false);
        assert_eq!(timed("x", || Ok::<_, String>(7)).unwrap(), 7);
        assert_eq!(timed_value("x", || 9), 9);
        set_enabled(previous);
    }
}
