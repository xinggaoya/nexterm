use std::sync::{
    Condvar, Mutex, MutexGuard, RwLock, RwLockReadGuard, RwLockWriteGuard, WaitTimeoutResult,
};
use std::time::Duration;

pub(crate) fn mutex_lock<'a, T>(
    lock: &'a Mutex<T>,
    context: &str,
) -> Result<MutexGuard<'a, T>, String> {
    lock.lock().map_err(|_| format!("{context} lock poisoned"))
}

pub(crate) fn rwlock_read<'a, T>(
    lock: &'a RwLock<T>,
    context: &str,
) -> Result<RwLockReadGuard<'a, T>, String> {
    lock.read().map_err(|_| format!("{context} lock poisoned"))
}

pub(crate) fn rwlock_write<'a, T>(
    lock: &'a RwLock<T>,
    context: &str,
) -> Result<RwLockWriteGuard<'a, T>, String> {
    lock.write().map_err(|_| format!("{context} lock poisoned"))
}

pub(crate) fn condvar_wait_timeout<'a, T>(
    condvar: &Condvar,
    guard: MutexGuard<'a, T>,
    timeout: Duration,
    context: &str,
) -> Result<(MutexGuard<'a, T>, WaitTimeoutResult), String> {
    condvar
        .wait_timeout(guard, timeout)
        .map_err(|_| format!("{context} condvar wait poisoned"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, RwLock};

    #[test]
    fn mutex_lock_reports_context_when_poisoned() {
        let mutex = Mutex::new(0);
        let _ = std::panic::catch_unwind(|| {
            let _guard = mutex.lock().expect("test lock should be available");
            panic!("poison mutex");
        });

        let error =
            mutex_lock(&mutex, "pty sessions").expect_err("poisoned mutex should become an error");

        assert!(error.contains("pty sessions"));
        assert!(error.contains("poisoned"));
    }

    #[test]
    fn rwlock_read_reports_context_when_poisoned() {
        let lock = RwLock::new(0);
        let _ = std::panic::catch_unwind(|| {
            let _guard = lock.write().expect("test lock should be available");
            panic!("poison rwlock");
        });

        let error = rwlock_read(&lock, "remote sessions")
            .expect_err("poisoned rwlock should become an error");

        assert!(error.contains("remote sessions"));
        assert!(error.contains("poisoned"));
    }
}
