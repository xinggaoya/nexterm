//! nexterm-agent 端到端冒烟:走真实客户端路径(安装 → wsl.exe spawn →
//! ping → fs 读写 → search/grep → exec git),验证 musl 资产、安装管道、
//! 协议与 Phase 0b 写/搜索下沉的全链路。
//!
//! 用法(src-tauri 目录下):
//! ```bash
//! cargo run --example agent_smoke -- Ubuntu /tmp
//! ```
//! 退出码 0 表示全链路通畅;任何一步失败都会以非零码退出。

use std::time::Duration;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (distro, path) = match args.as_slice() {
        [distro] => (distro.clone(), "/tmp".to_string()),
        [distro, path] => (distro.clone(), path.clone()),
        _ => {
            eprintln!("usage: cargo run --example agent_smoke -- <distro> [wslPath]");
            std::process::exit(2);
        }
    };
    let work = format!("{path}/nexterm-smoke-{}", std::process::id());

    println!("[1/9] exec: mkdir 工作目录 {work}");
    let outcome = exec(
        &distro,
        vec!["sh".into(), "-c".into(), format!("rm -rf {work} && mkdir -p {work}")],
        None,
    );
    assert_exit(&outcome, "mkdir");

    println!("[2/9] fs.createFile + fs.writeFile + fs.readFile 回读");
    nexterm_lib::modules::agent::create_file(&distro, &format!("{work}/empty.txt"))
        .unwrap_or_else(|error| die("createFile", &error));
    let content = BASE64_STANDARD.encode("hello nexterm phase-0b");
    nexterm_lib::modules::agent::write_file(&distro, &format!("{work}/note.txt"), &content)
        .unwrap_or_else(|error| die("writeFile", &error));
    let bytes = nexterm_lib::modules::agent::read_file(&distro, &format!("{work}/note.txt"))
        .unwrap_or_else(|error| die("readFile", &error));
    assert_eq!(String::from_utf8_lossy(&bytes), "hello nexterm phase-0b", "roundtrip content");

    println!("[3/9] fs.stat");
    let stat = nexterm_lib::modules::agent::stat(&distro, &format!("{work}/note.txt"))
        .unwrap_or_else(|error| die("fs.stat", &error));
    assert_eq!(stat.size, "hello nexterm phase-0b".len() as u64, "stat size");

    println!("[4/9] fs.readDir");
    let entries = nexterm_lib::modules::agent::read_dir(&distro, &work)
        .unwrap_or_else(|error| die("fs.readDir", &error));
    assert!(entries.iter().any(|entry| entry.name == "empty.txt"));

    println!("[5/9] fs.rename + fs.copy");
    nexterm_lib::modules::agent::rename(&distro, &format!("{work}/empty.txt"), &format!("{work}/renamed.txt"))
        .unwrap_or_else(|error| die("rename", &error));
    nexterm_lib::modules::agent::copy(&distro, &format!("{work}/note.txt"), &format!("{work}/note-copy.txt"))
        .unwrap_or_else(|error| die("copy", &error));

    println!("[6/9] fs.search / fs.listFiles");
    let hits = nexterm_lib::modules::agent::search(&distro, &work, "note", Some(10), true, &work)
        .unwrap_or_else(|error| die("fs.search", &error));
    assert_eq!(hits.hits.len(), 2, "expect note.txt + note-copy.txt");
    let (files, _) = nexterm_lib::modules::agent::list_files(&distro, &work, Some(100), Some(4), true)
        .unwrap_or_else(|error| die("fs.listFiles", &error));
    assert!(files.contains(&"note.txt".to_string()));

    println!("[7/9] fs.grep / fs.glob");
    let grep = nexterm_lib::modules::agent::grep(
        &distro,
        "phase-0b",
        &work,
        Some(&["*.txt".to_string()]),
        false,
        Some(50),
        &work,
    )
    .unwrap_or_else(|error| die("fs.grep", &error));
    assert_eq!(grep.hits.len(), 2, "both txt copies contain the marker");
    let (glob_hits, _) = nexterm_lib::modules::agent::glob(&distro, "**/*.txt", &work, Some(50), &work)
        .unwrap_or_else(|error| die("fs.glob", &error));
    // renamed.txt 也是 .txt(内容为空,glob 不看内容)→ 共 3 个
    assert_eq!(glob_hits.len(), 3);

    println!("[8/9] exec git init + status(经 agent 通道)");
    let outcome = exec(
        &distro,
        vec![
            "sh".into(),
            "-c".into(),
            format!("cd {work} && git init -q && git add note.txt"),
        ],
        None,
    );
    assert_exit(&outcome, "git init");
    let outcome = exec(
        &distro,
        vec!["git".into(), "-C".into(), work.clone(), "status".into(), "--short".into()],
        Some(&[("GIT_TERMINAL_PROMPT", "0"), ("LC_ALL", "C")]),
    );
    assert_exit(&outcome, "git status");
    let status = String::from_utf8_lossy(&outcome.stdout);
    assert!(status.contains("A  note.txt"), "staged note expected, got: {status}");

    println!("[9/9] fs.delete 清理");
    nexterm_lib::modules::agent::delete(&distro, &work)
        .unwrap_or_else(|error| die("fs.delete", &error));

    println!("agent smoke OK (Phase 0b 全能力通过)");
}

fn exec(distro: &str, argv: Vec<String>, env: Option<&[(&str, &str)]>) -> nexterm_lib::modules::agent::ExecOutcome {
    nexterm_lib::modules::agent::exec_simple(
        distro,
        argv,
        None,
        env.unwrap_or(&[("LC_ALL", "C")]),
        None,
        Duration::from_secs(60),
        4 * 1024 * 1024,
    )
    .unwrap_or_else(|error| die("exec", &error))
}

fn assert_exit(outcome: &nexterm_lib::modules::agent::ExecOutcome, step: &str) {
    assert_eq!(outcome.exit_code, Some(0), "{step} exit code");
}

fn die(step: &str, error: &str) -> ! {
    eprintln!("agent smoke FAILED at {step}: {error}");
    std::process::exit(1);
}
