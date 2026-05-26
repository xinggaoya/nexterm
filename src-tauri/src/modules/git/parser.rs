use crate::modules::git::types::{
    GitBranchInfo, GitChangedFile, GitFetchResult, GitPullResult, GitStashEntry,
};

#[derive(Default)]
pub struct PorcelainV2 {
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub is_detached: bool,
    pub files: Vec<GitChangedFile>,
}

pub fn parse_porcelain_v2(stdout: &str) -> PorcelainV2 {
    let mut out = PorcelainV2 {
        branch: "HEAD".into(),
        ..Default::default()
    };
    let mut tokens = stdout.split('\0').filter(|t| !t.is_empty()).peekable();
    while let Some(tok) = tokens.next() {
        if let Some(rest) = tok.strip_prefix("# branch.head ") {
            out.branch = rest.to_string();
            out.is_detached = rest == "(detached)";
            continue;
        }
        if let Some(rest) = tok.strip_prefix("# branch.upstream ") {
            out.upstream = Some(rest.to_string());
            continue;
        }
        if let Some(rest) = tok.strip_prefix("# branch.ab ") {
            let mut parts = rest.split_ascii_whitespace();
            if let Some(a) = parts.next() {
                out.ahead = a.trim_start_matches('+').parse().unwrap_or(0);
            }
            if let Some(b) = parts.next() {
                out.behind = b.trim_start_matches('-').parse().unwrap_or(0);
            }
            continue;
        }
        if tok.starts_with("# ") {
            continue;
        }
        if let Some(rest) = tok.strip_prefix("1 ") {
            if let Some(file) = parse_ordinary(rest) {
                out.files.push(file);
            }
            continue;
        }
        if let Some(rest) = tok.strip_prefix("2 ") {
            let orig = tokens.next().unwrap_or("").to_string();
            if let Some(file) = parse_renamed(rest, orig) {
                out.files.push(file);
            }
            continue;
        }
        if let Some(rest) = tok.strip_prefix("u ") {
            if let Some(file) = parse_unmerged(rest) {
                out.files.push(file);
            }
            continue;
        }
        if let Some(rest) = tok.strip_prefix("? ") {
            out.files.push(make_file('?', '?', rest, None));
            continue;
        }
    }
    out
}

fn skip_fields(s: &str, n: usize) -> Option<&str> {
    let mut rest = s;
    for _ in 0..n {
        let idx = rest.find(' ')?;
        rest = &rest[idx + 1..];
    }
    Some(rest)
}

fn parse_ordinary(rest: &str) -> Option<GitChangedFile> {
    let xy = rest.get(..2)?;
    let path = skip_fields(rest, 7)?;
    let (i, w) = xy_chars(xy);
    Some(make_file(i, w, path, None))
}

fn parse_renamed(rest: &str, orig_path: String) -> Option<GitChangedFile> {
    let xy = rest.get(..2)?;
    let after = skip_fields(rest, 8)?;
    let (i, w) = xy_chars(xy);
    Some(make_file(i, w, after, Some(orig_path)))
}

fn parse_unmerged(rest: &str) -> Option<GitChangedFile> {
    let xy = rest.get(..2)?;
    let path = skip_fields(rest, 9)?;
    let (i, w) = xy_chars(xy);
    Some(make_file(i, w, path, None))
}

// porcelain v2 uses '.' to mean "unchanged"; downstream logic mirrors v1 spaces.
fn xy_chars(xy: &str) -> (char, char) {
    let mut it = xy.chars();
    let to_space = |c: char| if c == '.' { ' ' } else { c };
    (
        to_space(it.next().unwrap_or(' ')),
        to_space(it.next().unwrap_or(' ')),
    )
}

fn make_file(
    index_status: char,
    worktree_status: char,
    path: &str,
    original_path: Option<String>,
) -> GitChangedFile {
    GitChangedFile {
        path: path.to_string(),
        original_path,
        index_status: index_status.to_string(),
        worktree_status: worktree_status.to_string(),
        staged: is_staged(index_status, worktree_status),
        unstaged: is_unstaged(index_status, worktree_status),
        untracked: index_status == '?' && worktree_status == '?',
        status_label: status_label(index_status, worktree_status),
    }
}

fn is_staged(index_status: char, worktree_status: char) -> bool {
    index_status != ' ' && !(index_status == '?' && worktree_status == '?')
}

fn is_unstaged(index_status: char, worktree_status: char) -> bool {
    worktree_status != ' ' || (index_status == '?' && worktree_status == '?')
}

fn status_label(index_status: char, worktree_status: char) -> String {
    match (index_status, worktree_status) {
        ('?', '?') => "Untracked".into(),
        ('A', _) => "Added".into(),
        ('M', _) | (_, 'M') => "Modified".into(),
        ('D', _) | (_, 'D') => "Deleted".into(),
        ('R', _) | (_, 'R') => "Renamed".into(),
        ('C', _) | (_, 'C') => "Copied".into(),
        ('U', _) | (_, 'U') => "Unmerged".into(),
        _ => "Changed".into(),
    }
}

pub fn parse_pull_summary(output: &str) -> GitPullResult {
    let already_up_to_date = output.to_ascii_lowercase().contains("already up to date");
    let mut files_changed = 0;
    let mut insertions = 0;
    let mut deletions = 0;

    for line in output.lines() {
        if !line.contains("changed") {
            continue;
        }
        for part in line.split(',') {
            let trimmed = part.trim();
            if trimmed.contains("file changed") || trimmed.contains("files changed") {
                files_changed = first_number(trimmed);
            } else if trimmed.contains("insertion") {
                insertions = first_number(trimmed);
            } else if trimmed.contains("deletion") {
                deletions = first_number(trimmed);
            }
        }
    }

    let summary = if already_up_to_date {
        "Already up to date".to_string()
    } else if files_changed > 0 || insertions > 0 || deletions > 0 {
        format!(
            "{files_changed} {} changed, +{insertions} -{deletions}",
            plural(files_changed, "file", "files")
        )
    } else {
        "Pulled latest changes".to_string()
    };

    GitPullResult {
        files_changed,
        insertions,
        deletions,
        already_up_to_date,
        summary,
    }
}

pub fn parse_fetch_summary(output: &str) -> GitFetchResult {
    let mut updated_refs = 0;
    let mut pruned_refs = 0;

    for line in output.lines() {
        if !line.contains(" -> ") {
            continue;
        }
        if line.contains("[deleted]") {
            pruned_refs += 1;
        } else {
            updated_refs += 1;
        }
    }

    let summary = match (updated_refs, pruned_refs) {
        (0, 0) => "Fetched latest refs".to_string(),
        (_, 0) => format!(
            "{updated_refs} {} updated",
            plural(updated_refs, "ref", "refs")
        ),
        (0, _) => format!("{pruned_refs} pruned"),
        _ => format!(
            "{updated_refs} {} updated, {pruned_refs} pruned",
            plural(updated_refs, "ref", "refs")
        ),
    };

    GitFetchResult {
        updated_refs,
        pruned_refs,
        summary,
    }
}

pub fn parse_branch_lines(output: &str) -> Vec<GitBranchInfo> {
    output
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('\x1f');
            let name = fields.next()?.trim().to_string();
            let head = fields.next()?.trim();
            let upstream = fields.next()?.trim();
            let refname = fields.next()?.trim();
            if name.is_empty() || refname.ends_with("/HEAD") {
                return None;
            }
            Some(GitBranchInfo {
                name,
                upstream: if upstream.is_empty() {
                    None
                } else {
                    Some(upstream.to_string())
                },
                is_current: head == "*",
                is_remote: refname.starts_with("refs/remotes/"),
            })
        })
        .collect()
}

pub fn parse_stash_lines(output: &str) -> Vec<GitStashEntry> {
    output
        .lines()
        .filter_map(|line| {
            let mut fields = line.splitn(4, '\x1f');
            let selector = fields.next()?.trim();
            let short_sha = fields.next().unwrap_or("").trim();
            let relative_time = fields.next().unwrap_or("").trim();
            let message = fields.next().unwrap_or("").trim();
            if selector.is_empty() {
                return None;
            }
            Some(GitStashEntry {
                selector: selector.to_string(),
                short_sha: short_sha.to_string(),
                relative_time: relative_time.to_string(),
                message: message.to_string(),
            })
        })
        .collect()
}

fn first_number(input: &str) -> u32 {
    input
        .split_ascii_whitespace()
        .find_map(|part| part.parse().ok())
        .unwrap_or(0)
}

fn plural<'a>(count: u32, singular: &'a str, plural: &'a str) -> &'a str {
    if count == 1 {
        singular
    } else {
        plural
    }
}

#[cfg(test)]
mod tests {
    use super::{
        parse_branch_lines, parse_fetch_summary, parse_porcelain_v2, parse_pull_summary,
        parse_stash_lines,
    };

    #[test]
    fn porcelain_v2_parses_branch_and_files() {
        let stdout = concat!(
            "# branch.oid abc123\0",
            "# branch.head main\0",
            "# branch.upstream origin/main\0",
            "# branch.ab +2 -1\0",
            "1 .M N... 100644 100644 100644 abc def src/a.rs\0",
            "2 R. N... 100644 100644 100644 abc def R100 src/new.rs\0src/old.rs\0",
            "? src/untracked.rs\0",
        );
        let parsed = parse_porcelain_v2(stdout);
        assert_eq!(parsed.branch, "main");
        assert_eq!(parsed.upstream.as_deref(), Some("origin/main"));
        assert_eq!(parsed.ahead, 2);
        assert_eq!(parsed.behind, 1);
        assert!(!parsed.is_detached);
        assert_eq!(parsed.files.len(), 3);
        assert_eq!(parsed.files[0].path, "src/a.rs");
        assert!(parsed.files[0].unstaged);
        assert_eq!(parsed.files[1].path, "src/new.rs");
        assert_eq!(parsed.files[1].original_path.as_deref(), Some("src/old.rs"));
        assert!(parsed.files[1].staged);
        assert_eq!(parsed.files[2].path, "src/untracked.rs");
        assert!(parsed.files[2].untracked);
    }

    #[test]
    fn porcelain_v2_handles_detached_head() {
        let stdout = "# branch.oid abc\0# branch.head (detached)\0";
        let parsed = parse_porcelain_v2(stdout);
        assert!(parsed.is_detached);
        assert_eq!(parsed.branch, "(detached)");
        assert!(parsed.upstream.is_none());
    }

    #[test]
    fn pull_summary_parses_file_and_line_counts() {
        let summary = parse_pull_summary(
            "Updating 111..222\nFast-forward\n src/a.rs | 10 +++++-----\n 3 files changed, 24 insertions(+), 6 deletions(-)\n",
        );

        assert_eq!(summary.files_changed, 3);
        assert_eq!(summary.insertions, 24);
        assert_eq!(summary.deletions, 6);
        assert!(!summary.already_up_to_date);
        assert_eq!(summary.summary, "3 files changed, +24 -6");
    }

    #[test]
    fn pull_summary_marks_already_up_to_date() {
        let summary = parse_pull_summary("Already up to date.\n");

        assert_eq!(summary.files_changed, 0);
        assert_eq!(summary.insertions, 0);
        assert_eq!(summary.deletions, 0);
        assert!(summary.already_up_to_date);
        assert_eq!(summary.summary, "Already up to date");
    }

    #[test]
    fn fetch_summary_counts_updated_and_pruned_refs() {
        let summary = parse_fetch_summary(
            "From github.com:xinggaoya/nexterm\n   111..222  main       -> origin/main\n * [new branch] feature -> origin/feature\n - [deleted]   (none)  -> origin/old\n",
        );

        assert_eq!(summary.updated_refs, 2);
        assert_eq!(summary.pruned_refs, 1);
        assert_eq!(summary.summary, "2 refs updated, 1 pruned");
    }

    #[test]
    fn branch_lines_parse_local_and_remote_entries() {
        let branches = parse_branch_lines(
            "main\x1f*\x1forigin/main\x1frefs/heads/main\nfeature\x1f \x1f\x1frefs/heads/feature\norigin/release\x1f \x1f\x1frefs/remotes/origin/release\norigin/HEAD\x1f \x1f\x1frefs/remotes/origin/HEAD\n",
        );

        assert_eq!(branches.len(), 3);
        assert!(branches[0].is_current);
        assert!(!branches[0].is_remote);
        assert_eq!(branches[0].upstream.as_deref(), Some("origin/main"));
        assert!(branches[2].is_remote);
        assert_eq!(branches[2].name, "origin/release");
    }

    #[test]
    fn branch_lines_ignore_unexpanded_format_escape_output() {
        let branches = parse_branch_lines(
            "feat/task-console-v1%x1f %x1f%x1frefs/heads/feat/task-console-v1\n",
        );

        assert!(branches.is_empty());
    }

    #[test]
    fn stash_lines_parse_selector_sha_and_message() {
        let stashes = parse_stash_lines(
            "stash@{0}\x1fabcdef1\x1f2 hours ago\x1fWIP on main: change source control\nstash@{1}\x1f1234567\x1fyesterday\x1fOn feature: saved changes\n",
        );

        assert_eq!(stashes.len(), 2);
        assert_eq!(stashes[0].selector, "stash@{0}");
        assert_eq!(stashes[0].short_sha, "abcdef1");
        assert_eq!(stashes[0].message, "WIP on main: change source control");
    }
}
