use std::io::Write;

use portable_pty::PtySize;

use super::PtyState;
use crate::modules::lock::{mutex_lock, rwlock_read};

impl PtyState {
    pub fn write_session(&self, id: u32, data: &str) -> Result<(), String> {
        let session = rwlock_read(&self.sessions, "pty sessions")?
            .get(&id)
            .cloned()
            .ok_or_else(|| format!("unknown pty session: {id}"))?;
        let result = mutex_lock(&session.writer, "pty writer")?
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string());
        result
    }

    pub fn resize_session(&self, id: u32, cols: u16, rows: u16) -> Result<(), String> {
        let session = rwlock_read(&self.sessions, "pty sessions")?
            .get(&id)
            .cloned()
            .ok_or_else(|| format!("unknown pty session: {id}"))?;
        let result = mutex_lock(&session.master, "pty master")?
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string());
        result
    }
}
