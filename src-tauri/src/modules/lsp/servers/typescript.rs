use std::path::Path;

use super::super::LspServerSpec;

pub fn spec(_cwd: &Path) -> Option<LspServerSpec> {
    which::which("typescript-language-server")
        .ok()
        .map(|path| LspServerSpec {
            id: "typescript-language-server".into(),
            language: "typescript".into(),
            command: path.to_string_lossy().into_owned(),
            args: vec!["--stdio".into()],
            cwd: None,
        })
}
