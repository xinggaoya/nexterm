use std::io::Write;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use portable_pty::PtySize;

use super::{PtyState, PtyTranscriptRead};
use crate::modules::lock::{mutex_lock, rwlock_read};

impl PtyState {
    pub fn read_transcript(
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
