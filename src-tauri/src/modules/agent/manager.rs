//! 每 distro 一个 agent 连接的管理器:懒 spawn、失败熔断、请求转发。
//!
//! 熔断的意义:发行版里 agent 反复起不来(资产损坏、WSL 残废)时,不能
//! 让每次 fs/git 调用都付出"安装 + spawn + ping"的代价 —— 连续失败达到
//! 阈值后静默关闭一段时间,期间调用方全部走 legacy 路径。

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::Value;

use super::connection::AgentConnection;

/// 连续失败多少次后熔断。
const FAILURE_LIMIT: u32 = 3;
/// 熔断窗口;窗口过后下一次调用会再试一次 spawn(自愈)。
const DISABLE_WINDOW: Duration = Duration::from_secs(60);

/// 资产缺失时的快速失败信息(不触碰 wsl.exe)。
pub(crate) const ASSET_MISSING: &str =
    "nexterm-agent is not bundled; using legacy wsl.exe path";

/// 每 distro 一格:格内是懒初始化的连接(cell 锁串行化首次 spawn)。
type SharedCell = Arc<Mutex<Option<Arc<AgentConnection>>>>;

struct AgentManager {
    cells: Mutex<HashMap<String, SharedCell>>,
    failures: Mutex<HashMap<String, u32>>,
    disabled_until: Mutex<HashMap<String, Instant>>,
}

fn manager() -> &'static AgentManager {
    static MANAGER: OnceLock<AgentManager> = OnceLock::new();
    MANAGER.get_or_init(|| AgentManager {
        cells: Mutex::new(HashMap::new()),
        failures: Mutex::new(HashMap::new()),
        disabled_until: Mutex::new(HashMap::new()),
    })
}

/// 发送一条请求;失败时记录并驱逐连接,供调用方回退 legacy 路径。
pub(crate) fn request(
    distro: &str,
    method: &str,
    params: Value,
    timeout: Duration,
) -> Result<Value, String> {
    if !super::install::asset_available() {
        return Err(ASSET_MISSING.into());
    }
    if let Some(until) = manager().disabled_until.lock().ok().and_then(|guard| guard.get(distro).copied()) {
        if Instant::now() < until {
            return Err(format!(
                "nexterm-agent is circuit-opened for {distro}; using legacy path"
            ));
        }
    }

    let connection = match get_or_spawn(distro) {
        Ok(connection) => connection,
        Err(error) => {
            record_failure(distro);
            return Err(error);
        }
    };

    match connection.request(method, params, timeout) {
        Ok(result) => {
            reset_failures(distro);
            Ok(result)
        }
        Err(error) => {
            record_failure(distro);
            evict(distro, &connection);
            Err(error)
        }
    }
}

fn get_or_spawn(distro: &str) -> Result<Arc<AgentConnection>, String> {
    let cell = match manager().cells.lock() {
        Ok(mut cells) => cells
            .entry(distro.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(None)))
            .clone(),
        Err(error) => return Err(format!("agent cells lock poisoned: {error}")),
    };
    let mut current = match cell.lock() {
        Ok(guard) => guard,
        Err(error) => return Err(format!("agent cell lock poisoned: {error}")),
    };
    if let Some(connection) = current.as_ref() {
        if connection.is_alive() {
            return Ok(Arc::clone(connection));
        }
    }
    let connection = AgentConnection::spawn(distro)?;
    *current = Some(Arc::clone(&connection));
    Ok(connection)
}

fn evict(distro: &str, connection: &Arc<AgentConnection>) {
    if let Ok(cells) = manager().cells.lock() {
        if let Some(cell) = cells.get(distro) {
            if let Ok(mut current) = cell.lock() {
                if let Some(existing) = current.as_ref() {
                    if Arc::ptr_eq(existing, connection) {
                        *current = None;
                    }
                }
            }
        }
    }
    connection.shutdown();
}

fn record_failure(distro: &str) {
    let Ok(mut failures) = manager().failures.lock() else {
        return;
    };
    let count = failures.entry(distro.to_string()).or_insert(0);
    *count = count.saturating_add(1);
    if *count >= FAILURE_LIMIT {
        if let Ok(mut disabled) = manager().disabled_until.lock() {
            disabled.insert(distro.to_string(), Instant::now() + DISABLE_WINDOW);
        }
        log::warn!(
            "nexterm-agent failed {count} times for {distro}; circuit opened for {DISABLE_WINDOW:?}"
        );
    }
}

fn reset_failures(distro: &str) {
    if let Ok(mut failures) = manager().failures.lock() {
        failures.remove(distro);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_fails_fast_when_asset_missing() {
        // cfg(test) 下 asset_available() 恒为 false,不得触碰 wsl.exe。
        let error = request("Ubuntu", "ping", Value::Null, Duration::from_secs(1)).unwrap_err();
        assert_eq!(error, ASSET_MISSING);
    }

    #[test]
    fn failure_tracking_opens_circuit() {
        // 直接操纵内部状态验证熔断语义,不真正 spawn。
        for _ in 0..FAILURE_LIMIT {
            record_failure("CircuitDistro");
        }
        let until = manager()
            .disabled_until
            .lock()
            .unwrap()
            .get("CircuitDistro")
            .copied();
        assert!(until.is_some(), "circuit should open after limit");
        reset_failures("CircuitDistro");
        manager().disabled_until.lock().unwrap().remove("CircuitDistro");
    }
}
