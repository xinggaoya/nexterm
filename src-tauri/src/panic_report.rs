use std::any::Any;
use std::sync::Once;

static INSTALL_PANIC_HOOK: Once = Once::new();

pub(crate) fn install_panic_hook() {
    INSTALL_PANIC_HOOK.call_once(|| {
        std::panic::set_hook(Box::new(|info| {
            let thread = std::thread::current();
            let thread_name = thread.name().unwrap_or("<unnamed>");
            let message = panic_payload_message(info.payload());
            let location = info
                .location()
                .map(|location| {
                    format!(
                        "{}:{}:{}",
                        location.file(),
                        location.line(),
                        location.column()
                    )
                })
                .unwrap_or_else(|| "<unknown location>".to_string());
            log::error!("panic in thread {thread_name}: {message} at {location}");
            eprintln!("[nexterm] panic in thread {thread_name}: {message} at {location}");
        }));
    });
}

fn panic_payload_message(payload: &(dyn Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        return (*message).to_string();
    }
    if let Some(message) = payload.downcast_ref::<String>() {
        return message.clone();
    }
    "<non-string panic payload>".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panic_payload_string_preserves_string_messages() {
        assert_eq!(
            panic_payload_message(&"workspace watcher failed"),
            "workspace watcher failed"
        );
        assert_eq!(
            panic_payload_message(&String::from("pty flusher failed")),
            "pty flusher failed"
        );
    }

    #[test]
    fn panic_payload_string_marks_unknown_payloads() {
        assert_eq!(panic_payload_message(&42_u32), "<non-string panic payload>");
    }
}
