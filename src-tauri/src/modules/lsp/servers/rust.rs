use std::path::Path;

use super::super::LspServerSpec;

pub fn spec(_cwd: &Path) -> Option<LspServerSpec> {
    which::which("rust-analyzer")
        .ok()
        .map(|path| LspServerSpec {
            id: "rust-analyzer".into(),
            language: "rust".into(),
            command: path.to_string_lossy().into_owned(),
            args: Vec::new(),
            cwd: None,
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_spec_or_none() {
        // 不强制 binary 存在；CI 上可能没有安装。
        let _ = spec(Path::new("/tmp"));
    }
}
