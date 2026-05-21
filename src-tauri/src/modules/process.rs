#[cfg(windows)]
pub(crate) fn suppress_command_window(command: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub(crate) fn suppress_command_window(_command: &mut std::process::Command) {}
