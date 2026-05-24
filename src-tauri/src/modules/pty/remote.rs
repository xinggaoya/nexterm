use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use portable_pty::PtySize;
use serde::Serialize;

use super::{PtyState, PtyTranscriptRead};
use crate::modules::lock::{mutex_lock, rwlock_read, rwlock_write};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyRemoteSession {
    pub id: u32,
    pub title: Option<String>,
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
    pub created_at_ms: u64,
    pub total_offset: u64,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl PtyState {
    pub fn register_remote_session(
        &self,
        id: u32,
        cwd: Option<String>,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        rwlock_write(&self.remote_sessions, "pty remote sessions")?.insert(
            id,
            PtyRemoteSession {
                id,
                title: Some("shell".into()),
                cwd,
                cols,
                rows,
                created_at_ms: now_ms(),
                total_offset: 0,
            },
        );
        Ok(())
    }

    pub fn unregister_remote_session(&self, id: u32) -> Result<(), String> {
        rwlock_write(&self.remote_sessions, "pty remote sessions")?.remove(&id);
        Ok(())
    }

    pub fn update_remote_session_metadata(
        &self,
        id: u32,
        title: Option<String>,
        cwd: Option<String>,
    ) -> Result<(), String> {
        let mut sessions = rwlock_write(&self.remote_sessions, "pty remote sessions")?;
        let session = sessions
            .get_mut(&id)
            .ok_or_else(|| format!("unknown pty session: {id}"))?;
        if let Some(title) = title {
            let title = title.trim();
            session.title = if title.is_empty() {
                Some("shell".into())
            } else {
                Some(title.to_string())
            };
        }
        if let Some(cwd) = cwd {
            session.cwd = Some(cwd);
        }
        Ok(())
    }

    pub fn remote_sessions(&self) -> Result<Vec<PtyRemoteSession>, String> {
        let sessions = rwlock_read(&self.sessions, "pty sessions")?;
        let mut items: Vec<PtyRemoteSession> =
            rwlock_read(&self.remote_sessions, "pty remote sessions")?
                .values()
                .map(|meta| {
                    let mut item = meta.clone();
                    if let Some(session) = sessions.get(&meta.id) {
                        item.total_offset = session.transcript.total_offset();
                    }
                    item
                })
                .collect();
        items.sort_by_key(|item| item.id);
        Ok(items)
    }

    pub fn read_remote_transcript(
        &self,
        id: u32,
        since_offset: u64,
        max_bytes: usize,
    ) -> Result<PtyTranscriptRead, String> {
        let session = rwlock_read(&self.sessions, "pty sessions")?
            .get(&id)
            .cloned()
            .ok_or_else(|| format!("unknown pty session: {id}"))?;
        let read = session.transcript.read_from(since_offset, max_bytes)?;
        Ok(PtyTranscriptRead {
            start_offset: read.start_offset,
            next_offset: read.next_offset,
            total_offset: read.total_offset,
            data_base64: BASE64.encode(read.data),
        })
    }

    pub fn write_remote_session(&self, id: u32, data: &str) -> Result<(), String> {
        let session = rwlock_read(&self.sessions, "pty sessions")?
            .get(&id)
            .cloned()
            .ok_or_else(|| format!("unknown pty session: {id}"))?;
        let result = mutex_lock(&session.writer, "pty writer")?
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string());
        result
    }

    pub fn resize_remote_session(&self, id: u32, cols: u16, rows: u16) -> Result<(), String> {
        let session = rwlock_read(&self.sessions, "pty sessions")?
            .get(&id)
            .cloned()
            .ok_or_else(|| format!("unknown pty session: {id}"))?;
        mutex_lock(&session.master, "pty master")?
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
        if let Some(meta) = rwlock_write(&self.remote_sessions, "pty remote sessions")?.get_mut(&id)
        {
            meta.cols = cols;
            meta.rows = rows;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_session_metadata_can_be_listed_and_updated() {
        let state = PtyState::default();

        state
            .register_remote_session(7, Some("/tmp/work".into()), 80, 24)
            .expect("remote register should work");
        state
            .update_remote_session_metadata(
                7,
                Some("cargo test".into()),
                Some("/tmp/work/src".into()),
            )
            .unwrap();

        let sessions = state.remote_sessions();
        let sessions = sessions.expect("remote sessions should list");
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, 7);
        assert_eq!(sessions[0].title.as_deref(), Some("cargo test"));
        assert_eq!(sessions[0].cwd.as_deref(), Some("/tmp/work/src"));
        assert_eq!(sessions[0].cols, 80);
        assert_eq!(sessions[0].rows, 24);

        state
            .unregister_remote_session(7)
            .expect("remote unregister should work");
        assert!(state.remote_sessions().expect("remote sessions").is_empty());
    }
}
