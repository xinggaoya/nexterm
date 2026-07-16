use std::string::FromUtf8Error;

#[derive(Debug)]
pub enum LspError {
    Io(std::io::Error),
    Utf8(FromUtf8Error),
    Spawned(String),
    UnknownSession(u32),
    MissingChannel,
    Poisoned,
}

impl std::fmt::Display for LspError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LspError::Io(e) => write!(f, "lsp io: {e}"),
            LspError::Utf8(e) => write!(f, "lsp utf8: {e}"),
            LspError::Spawned(e) => write!(f, "lsp spawn: {e}"),
            LspError::UnknownSession(id) => write!(f, "lsp session {id} not found"),
            LspError::MissingChannel => write!(f, "lsp channel not provided"),
            LspError::Poisoned => write!(f, "lsp mutex poisoned"),
        }
    }
}

impl std::error::Error for LspError {}

impl From<std::io::Error> for LspError {
    fn from(value: std::io::Error) -> Self {
        LspError::Io(value)
    }
}

impl From<LspError> for String {
    fn from(value: LspError) -> Self {
        value.to_string()
    }
}
