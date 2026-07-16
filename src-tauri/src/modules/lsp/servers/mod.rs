use std::path::Path;

use super::LspServerSpec;

pub mod go;
pub mod python;
pub mod rust;
pub mod typescript;

pub fn resolve_for_language(language: &str, cwd: &Path) -> Option<LspServerSpec> {
    match language {
        "rust" | "rust-analyzer" => rust::spec(cwd),
        "python" | "py" | "pyright" | "pylsp" => python::spec(cwd),
        "go" | "gopls" => go::spec(cwd),
        "typescript" | "javascript" => typescript::spec(cwd),
        _ => None,
    }
}
