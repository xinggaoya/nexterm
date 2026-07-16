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
            let refname = fields.next()?.trim().to_string();
            let short_sha = fields.next().unwrap_or("").trim().to_string();
            let subject = fields.next().unwrap_or("").trim().to_string();
            let timestamp_raw = fields.next().unwrap_or("").trim();
            let track = fields.next().unwrap_or("").trim();
            if name.is_empty() || refname.ends_with("/HEAD") {
                return None;
            }
            let last_commit_timestamp_secs = timestamp_raw.parse::<i64>().unwrap_or(0);
            let (ahead, behind) = parse_upstream_track(track);
            Some(GitBranchInfo {
                name,
                full_ref: refname.clone(),
                upstream: if upstream.is_empty() {
                    None
                } else {
                    Some(upstream.to_string())
                },
                is_current: head == "*",
                is_remote: refname.starts_with("refs/remotes/"),
                last_commit_short_sha: short_sha,
                last_commit_subject: subject,
                last_commit_timestamp_secs,
                ahead,
                behind,
            })
        })
        .collect()
}

fn parse_upstream_track(track: &str) -> (Option<u32>, Option<u32>) {
    // `%(upstream:track,nobracket)` emits strings like:
    //   "ahead 2, behind 1", "ahead 3", "behind 4", "gone" or "" when in sync.
    if track.is_empty() {
        return (None, None);
    }
    let mut ahead: Option<u32> = None;
    let mut behind: Option<u32> = None;
    for part in track.split(',') {
        let part = part.trim();
        let mut tokens = part.split_ascii_whitespace();
        match (tokens.next(), tokens.next()) {
            (Some("ahead"), Some(n)) => {
                if let Ok(value) = n.parse::<u32>() {
                    ahead = Some(value);
                }
            }
            (Some("behind"), Some(n)) => {
                if let Ok(value) = n.parse::<u32>() {
                    behind = Some(value);
                }
            }
            _ => {}
        }
    }
    (ahead, behind)
}

pub fn parse_stash_lines(output: &str) -> Vec<GitStashEntry> {
    output
        .lines()
        .filter_map(|line| {
            let mut fields = line.splitn(5, '\x1f');
            let selector = fields.next()?.trim();
            let full_sha = fields.next().unwrap_or("").trim();
            let short_sha = fields.next().unwrap_or("").trim();
            let relative_time = fields.next().unwrap_or("").trim();
            let message = fields.next().unwrap_or("").trim();
            if selector.is_empty() {
                return None;
            }
            Some(GitStashEntry {
                selector: selector.to_string(),
                full_sha: full_sha.to_string(),
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

/// Decoration suffix produced by `--format=...%d`. The trailing parenthesis
/// list is emitted without leading/trailing `()` when no refs point at the
/// commit, so the parser must accept an empty string as well as one or more
/// comma-separated tokens like `HEAD -> main`, `HEAD`, `tag: v1.0`, or
/// `origin/main`.
///
/// The contract surfaced to the UI maps each git decoration into one or
/// more `GitLogRef` records. The `kind` is one of the four values the
/// brief enumerates:
///
///   - `head` — the working tree's HEAD pointer (detached or named via
///     `HEAD -> main`). `is_head` is `true` for these entries.
///   - `local-branch` — a branch under `refs/heads/`.
///   - `remote-branch` — a branch under `refs/remotes/<remote>/`.
///   - `tag` — a tag under `refs/tags/`.
///
/// `ref_kind_map` resolves ambiguous short names like `feature/x` (a local
/// branch with a slash) from `origin/feature` (a remote-tracking branch)
/// without trusting a name-only heuristic.
pub fn parse_log_refs(
    decorate: &str,
    ref_kind_map: &std::collections::HashMap<String, &'static str>,
) -> Vec<crate::modules::git::types::GitLogRef> {
    let mut refs: Vec<crate::modules::git::types::GitLogRef> = Vec::new();
    let trimmed = decorate.trim();
    if trimmed.is_empty() {
        return refs;
    }
    let inner = trimmed
        .strip_prefix('(')
        .and_then(|s| s.strip_suffix(')'))
        .unwrap_or(trimmed);
    for token in inner.split(',') {
        let token = token.trim();
        if token.is_empty() {
            continue;
        }
        // Tags arrive as `tag: refs/tags/<name>` or `tag: <name>`; handle
        // them first so the `/` detection later doesn't mis-classify the
        // path-like tag reference.
        if let Some(rest) = token.strip_prefix("tag: ") {
            let raw = rest.trim();
            let name = raw
                .strip_prefix("refs/tags/")
                .unwrap_or(raw)
                .to_string();
            refs.push(crate::modules::git::types::GitLogRef {
                name,
                kind: "tag".to_string(),
                is_head: false,
            });
            continue;
        }
        // `HEAD` (alone) is detached HEAD — surface as the literal HEAD
        // ref, not as a branch. The branch list under `--decorate=short`
        // never emits `HEAD` by itself when HEAD is attached, so this case
        // only fires for the detached HEAD scenario.
        if token == "HEAD" {
            refs.push(crate::modules::git::types::GitLogRef {
                name: "HEAD".to_string(),
                kind: "head".to_string(),
                is_head: true,
            });
            continue;
        }
        // `HEAD -> main` — emit two entries so the UI can show both the
        // HEAD marker and the branch it points at. The branch keeps its
        // own kind (`local-branch` / `remote-branch`); HEAD itself is its
        // own entry with kind `head` and `is_head=true`.
        if let Some(rest) = token.strip_prefix("HEAD -> ") {
            let raw = rest.trim();
            refs.push(crate::modules::git::types::GitLogRef {
                name: "HEAD".to_string(),
                kind: "head".to_string(),
                is_head: true,
            });
            let (kind, name) = classify_unqualified_ref(raw, ref_kind_map);
            refs.push(crate::modules::git::types::GitLogRef {
                name,
                kind: kind.to_string(),
                is_head: false,
            });
            continue;
        }
        // Bare unqualified ref name. `--decorate=short` emits
        // `origin/main`, `feature/x`, `main`, etc.
        let (kind, name) = classify_unqualified_ref(token, ref_kind_map);
        refs.push(crate::modules::git::types::GitLogRef {
            name,
            kind: kind.to_string(),
            is_head: false,
        });
    }
    refs
}

fn classify_unqualified_ref(
    raw: &str,
    ref_kind_map: &std::collections::HashMap<String, &'static str>,
) -> (&'static str, String) {
    // Strip a fully-qualified ref path if present so the UI sees the
    // short name (`main`, `origin/main`, `v1.0`).
    let short = raw
        .strip_prefix("refs/heads/")
        .or_else(|| raw.strip_prefix("refs/remotes/"))
        .or_else(|| raw.strip_prefix("refs/tags/"))
        .unwrap_or(raw);
    // Prefer the authoritative classification gathered from
    // `for-each-ref`; it correctly disambiguates `feature/x` (local) from
    // `origin/feature` (remote) when both happen to contain a slash.
    if let Some(kind) = ref_kind_map.get(short) {
        return (*kind, short.to_string());
    }
    if short.contains('/') {
        // No authoritative answer — best-effort heuristic for refs the
        // caller has never asked git about.
        ("remote-branch", short.to_string())
    } else {
        ("local-branch", short.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        parse_branch_lines, parse_fetch_summary, parse_log_refs, parse_porcelain_v2,
        parse_pull_summary, parse_stash_lines,
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
            "main\x1f*\x1forigin/main\x1frefs/heads/main\x1fabc1234\x1fAdd new line\x1f1700000000\x1fahead 1\n\
             feature\x1f \x1f\x1frefs/heads/feature\x1fdef5678\x1fWIP feature\x1f1699999999\x1f\n\
             origin/release\x1f \x1f\x1frefs/remotes/origin/release\x1f9abc123\x1frelease prep\x1f1700001000\x1f\n\
             origin/HEAD\x1f \x1f\x1frefs/remotes/origin/HEAD\x1f0123456\x1fHEAD\x1f1700000500\x1f\n",
        );

        assert_eq!(branches.len(), 3);
        assert!(branches[0].is_current);
        assert!(!branches[0].is_remote);
        assert_eq!(branches[0].upstream.as_deref(), Some("origin/main"));
        assert_eq!(branches[0].full_ref, "refs/heads/main");
        assert_eq!(branches[0].ahead, Some(1));
        assert_eq!(branches[0].behind, None);
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
            "stash@{0}\x1f0123456789abcdef0123456789abcdef01234567\x1fabcdef1\x1f2 hours ago\x1fWIP on main: change source control\n\
             stash@{1}\x1fff00ff00ff00ff00ff00ff00ff00ff00ff00ff00\x1f1234567\x1fyesterday\x1fOn feature: saved changes\n",
        );

        assert_eq!(stashes.len(), 2);
        assert_eq!(stashes[0].selector, "stash@{0}");
        assert_eq!(stashes[0].full_sha, "0123456789abcdef0123456789abcdef01234567");
        assert_eq!(stashes[0].short_sha, "abcdef1");
        assert_eq!(stashes[0].message, "WIP on main: change source control");
    }

    #[test]
    fn branch_lines_parse_full_metadata_with_tracking() {
        let branches = parse_branch_lines(
            "main\x1f*\x1forigin/main\x1frefs/heads/main\x1fabc1234\x1fAdd new line\x1f1700000000\x1fahead 2, behind 1\n\
             feature\x1f \x1f\x1frefs/heads/feature\x1fdeadbe\x1fWIP feature\x1f1699999999\x1f\n\
             origin/main\x1f \x1f\x1frefs/remotes/origin/main\x1fabc1234\x1fAdd new line\x1f1700000000\x1f\n",
        );

        assert_eq!(branches.len(), 3);

        let main = &branches[0];
        assert_eq!(main.name, "main");
        assert!(main.is_current);
        assert!(!main.is_remote);
        assert_eq!(main.full_ref, "refs/heads/main");
        assert_eq!(main.upstream.as_deref(), Some("origin/main"));
        assert_eq!(main.last_commit_short_sha, "abc1234");
        assert_eq!(main.last_commit_subject, "Add new line");
        assert_eq!(main.last_commit_timestamp_secs, 1_700_000_000);
        assert_eq!(main.ahead, Some(2));
        assert_eq!(main.behind, Some(1));

        let feature = &branches[1];
        assert_eq!(feature.name, "feature");
        assert!(!feature.is_current);
        assert!(feature.upstream.is_none());
        assert_eq!(feature.full_ref, "refs/heads/feature");
        assert_eq!(feature.last_commit_short_sha, "deadbe");
        assert_eq!(feature.last_commit_subject, "WIP feature");
        assert_eq!(feature.last_commit_timestamp_secs, 1_699_999_999);
        assert_eq!(feature.ahead, None);
        assert_eq!(feature.behind, None);

        let origin_main = &branches[2];
        assert!(origin_main.is_remote);
        assert_eq!(origin_main.full_ref, "refs/remotes/origin/main");
        assert_eq!(origin_main.upstream, None);
        assert_eq!(origin_main.last_commit_short_sha, "abc1234");
        assert_eq!(origin_main.ahead, None);
        assert_eq!(origin_main.behind, None);
    }

    #[test]
    fn branch_lines_parse_branch_names_with_slashes() {
        let branches = parse_branch_lines(
            "feat/task-console-v1\x1f \x1f\x1frefs/heads/feat/task-console-v1\x1f1f2e3d4\x1fadd task console\x1f1700000123\x1f\n",
        );

        assert_eq!(branches.len(), 1);
        assert_eq!(branches[0].name, "feat/task-console-v1");
        assert_eq!(branches[0].full_ref, "refs/heads/feat/task-console-v1");
        assert_eq!(branches[0].last_commit_short_sha, "1f2e3d4");
        assert_eq!(branches[0].last_commit_timestamp_secs, 1_700_000_123);
    }

    #[test]
    fn branch_lines_parse_upstream_track_partial_directions() {
        // ahead only
        let ahead_only = parse_branch_lines(
            "ahead\x1f \x1forigin/ahead\x1frefs/heads/ahead\x1fabc\x1fmsg\x1f100\x1fahead 3\n",
        );
        assert_eq!(ahead_only[0].ahead, Some(3));
        assert_eq!(ahead_only[0].behind, None);

        // behind only
        let behind_only = parse_branch_lines(
            "behind\x1f \x1forigin/behind\x1frefs/heads/behind\x1fdef\x1fmsg\x1f100\x1fbehind 4\n",
        );
        assert_eq!(behind_only[0].ahead, None);
        assert_eq!(behind_only[0].behind, Some(4));
    }

    #[test]
    fn stash_lines_parse_full_and_short_sha() {
        let stashes = parse_stash_lines(
            "stash@{0}\x1f0123456789abcdef0123456789abcdef01234567\x1fabcdef1\x1f2 hours ago\x1fWIP on main: change source control\n\
             stash@{1}\x1fff00ff00ff00ff00ff00ff00ff00ff00ff00ff00\x1fff00ff0\x1fyesterday\x1fOn feature: saved changes\n",
        );

        assert_eq!(stashes.len(), 2);

        assert_eq!(stashes[0].selector, "stash@{0}");
        assert_eq!(
            stashes[0].full_sha,
            "0123456789abcdef0123456789abcdef01234567"
        );
        assert_eq!(stashes[0].short_sha, "abcdef1");
        assert_eq!(stashes[0].relative_time, "2 hours ago");
        assert_eq!(
            stashes[0].message,
            "WIP on main: change source control"
        );

        assert_eq!(stashes[1].full_sha, "ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00");
        assert_eq!(stashes[1].short_sha, "ff00ff0");
    }

    #[test]
    fn log_refs_returns_empty_for_empty_decoration() {
        let empty: std::collections::HashMap<String, &'static str> =
            std::collections::HashMap::new();
        let refs = parse_log_refs("", &empty);
        assert!(refs.is_empty());

        let refs = parse_log_refs("()", &empty);
        assert!(refs.is_empty());
    }

    #[test]
    fn log_refs_classifies_local_remote_tag_and_head() {
        // What `git log --format=%d` actually emits for a checked-out branch
        // pointing at a commit that is also a tag and the tip of an upstream
        // tracking branch. We expect four entries: HEAD (its own ref),
        // local-branch main, tag v1.0, and remote-branch origin/main.
        let mut map: std::collections::HashMap<String, &'static str> =
            std::collections::HashMap::new();
        map.insert("main".to_string(), "local-branch");
        map.insert("origin/main".to_string(), "remote-branch");
        let refs = parse_log_refs(
            "(HEAD -> refs/heads/main, tag: refs/tags/v1.0, refs/remotes/origin/main)",
            &map,
        );

        assert_eq!(refs.len(), 4);
        assert_eq!(refs[0].name, "HEAD");
        assert_eq!(refs[0].kind, "head");
        assert!(refs[0].is_head);
        assert_eq!(refs[1].name, "main");
        assert_eq!(refs[1].kind, "local-branch");
        assert!(!refs[1].is_head);
        assert_eq!(refs[2].name, "v1.0");
        assert_eq!(refs[2].kind, "tag");
        assert!(!refs[2].is_head);
        assert_eq!(refs[3].name, "origin/main");
        assert_eq!(refs[3].kind, "remote-branch");
        assert!(!refs[3].is_head);
    }

    #[test]
    fn log_refs_handles_short_ref_names_without_refs_prefix() {
        // No map entry → falls back to the heuristic. `feature/x` contains
        // a slash, so without authoritative info the parser guesses
        // remote-branch. The `log_classifies_refs` integration test verifies
        // that the map-backed path picks the right kind for a real repo.
        let empty: std::collections::HashMap<String, &'static str> =
            std::collections::HashMap::new();
        let refs = parse_log_refs("(feature/x)", &empty);

        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].name, "feature/x");
        assert_eq!(refs[0].kind, "remote-branch");
        assert!(!refs[0].is_head);
    }

    #[test]
    fn log_refs_prefers_map_over_heuristic() {
        // The lookup table beats the slash heuristic — `feature/x` is a
        // local branch in this fixture, even though the name contains `/`.
        let mut map: std::collections::HashMap<String, &'static str> =
            std::collections::HashMap::new();
        map.insert("feature/x".to_string(), "local-branch");
        let refs = parse_log_refs("(HEAD -> feature/x)", &map);

        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].name, "HEAD");
        assert_eq!(refs[0].kind, "head");
        assert!(refs[0].is_head);
        assert_eq!(refs[1].name, "feature/x");
        assert_eq!(refs[1].kind, "local-branch");
        assert!(!refs[1].is_head);
    }

    #[test]
    fn log_refs_handles_detached_head() {
        let empty: std::collections::HashMap<String, &'static str> =
            std::collections::HashMap::new();
        let refs = parse_log_refs("(HEAD)", &empty);

        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].name, "HEAD");
        assert_eq!(refs[0].kind, "head");
        assert!(refs[0].is_head);
    }
}
