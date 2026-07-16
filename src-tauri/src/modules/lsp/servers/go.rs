use std::path::Path;

use super::super::LspServerSpec;

pub fn spec(_cwd: &Path) -> Option<LspServerSpec> {
    which::which("gopls")
        .ok()
        .map(|path| LspServerSpec {
            id: "gopls".into(),
            language: "go".into(),
            command: path.to_string_lossy().into_owned(),
            args: Vec::new(),
            cwd: None,
        })
}
