use serde::Deserialize;

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum WorkspaceEnv {
    #[default]
    Local,
    Wsl {
        distro: String,
    },
    Ssh {
        #[serde(rename = "profileId")]
        profile_id: String,
    },
}

impl WorkspaceEnv {
    pub fn from_option(workspace: Option<Self>) -> Self {
        workspace.unwrap_or_default()
    }

    pub fn is_wsl(&self) -> bool {
        matches!(self, Self::Wsl { .. })
    }

    pub fn is_ssh(&self) -> bool {
        matches!(self, Self::Ssh { .. })
    }
}

/// SSH 工作区能力边界:终端、文件读写与 git 已支持(经 nexterm-agent);
/// 仅 watcher 与 shell 后台进程暂不支持。相关命令入口统一调用此守卫,
/// 给出可预期的错误而不是误走本地路径。
pub fn reject_ssh_unsupported(workspace: &WorkspaceEnv, op: &str) -> Result<(), String> {
    if workspace.is_ssh() {
        return Err(format!(
            "SSH workspaces do not support '{op}' yet: filesystem watching and background shell processes are not available over SSH"
        ));
    }
    Ok(())
}
