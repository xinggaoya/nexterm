// 远端通道输出的限流累加器。
//
// 本地 git 路径有 `drain_limited`（2 MiB 上限），SSH / WSL agent 侧却是裸的
// `Vec::extend_from_slice`。一个行为异常的远端 agent 只要在 `once` 模式里
// 吐几百 MB JSON，主进程就直接 OOM —— 而且这条路径的输入来自网络。
/// SSH 通道单次请求的输出上限，与本地命令执行保持同一量级。
pub(crate) const MAX_CHANNEL_OUTPUT_BYTES: usize = 2 * 1024 * 1024;

/// 增量累加器：超过上限后继续读但丢弃，并标记 `truncated`。
#[derive(Default)]
pub(crate) struct BoundedBuffer {
    bytes: Vec<u8>,
    truncated: bool,
}

impl BoundedBuffer {
    pub(crate) fn with_prealloc(prealloc: usize) -> Self {
        Self {
            bytes: Vec::with_capacity(prealloc.min(MAX_CHANNEL_OUTPUT_BYTES)),
            truncated: false,
        }
    }

    pub(crate) fn push(&mut self, chunk: &[u8]) {
        if self.bytes.len() >= MAX_CHANNEL_OUTPUT_BYTES {
            self.truncated = true;
            return;
        }
        let take = (MAX_CHANNEL_OUTPUT_BYTES - self.bytes.len()).min(chunk.len());
        self.bytes.extend_from_slice(&chunk[..take]);
        if take < chunk.len() {
            self.truncated = true;
        }
    }

    pub(crate) fn into_bytes(self) -> Vec<u8> {
        self.bytes
    }

    pub(crate) fn as_bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub(crate) fn truncated(&self) -> bool {
        self.truncated
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accumulates_until_the_cap() {
        let mut buffer = BoundedBuffer::default();
        buffer.push(b"hello ");
        buffer.push(b"world");
        assert_eq!(buffer.as_bytes(), b"hello world");
        assert!(!buffer.truncated());
    }

    #[test]
    fn drops_everything_past_the_cap_and_flags_truncation() {
        let mut buffer = BoundedBuffer::default();
        buffer.push(&vec![7u8; MAX_CHANNEL_OUTPUT_BYTES]);
        assert!(!buffer.truncated(), "exactly at the cap is not truncation");
        buffer.push(b"one more byte");
        assert!(buffer.truncated());
        assert_eq!(buffer.as_bytes().len(), MAX_CHANNEL_OUTPUT_BYTES);
    }

    #[test]
    fn into_bytes_hands_over_the_accumulated_output() {
        let mut buffer = BoundedBuffer::with_prealloc(8);
        buffer.push(b"ok");
        assert_eq!(buffer.into_bytes(), b"ok".to_vec());
    }
}
