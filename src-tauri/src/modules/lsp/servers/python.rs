use std::path::Path;

use super::super::LspServerSpec;

pub fn spec(_cwd: &Path) -> Option<LspServerSpec> {
    let cmd = which::which("pyright-langserver")
        .ok()
        .or_else(|| which::which("pylsp").ok())?;
    Some(LspServerSpec {
        id: "pyright-langserver".into(),
        language: "python".into(),
        command: cmd.to_string_lossy().into_owned(),
        args: Vec::new(),
        cwd: None,
    })
}
