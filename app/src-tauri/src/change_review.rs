use crate::management::{ManagementStore, VerificationStatus};
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewFile {
    pub path: String,
    pub status: String,
    pub diff: Option<String>,
    pub diff_error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRepository {
    pub repository_id: String,
    pub name: String,
    pub path: String,
    pub comparison_target: Option<String>,
    pub comparison_error: Option<String>,
    pub files: Vec<ReviewFile>,
}

fn git(path: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .output()
        .map_err(|error| format!("could not run Git: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }
    Ok(output.stdout)
}

fn status_for(path: &Path, file: &str) -> String {
    let Ok(bytes) = git(path, &["status", "--porcelain=v1", "-z", "--", file]) else {
        return "changed".into();
    };
    let Some(entry) = bytes.split(|byte| *byte == 0).next() else {
        return "changed".into();
    };
    if entry.len() >= 3 {
        classify_status(&String::from_utf8_lossy(&entry[..2]))
    } else {
        "changed".into()
    }
}

fn classify_status(raw: &str) -> String {
    let status = raw.trim();
    if status == "??" {
        "untracked".into()
    } else if matches!(status, "UU" | "AA" | "DD" | "AU" | "UA" | "DU" | "UD") {
        "conflicted".into()
    } else if status.is_empty() {
        "changed".into()
    } else {
        status.to_owned()
    }
}

fn diff_for(path: &Path, file: &str, target: Option<&str>) -> (Option<String>, Option<String>) {
    if status_for(path, file) == "untracked" {
        let file_path = path.join(file);
        match fs::read(&file_path) {
            Ok(bytes) if bytes.len() > 1024 * 1024 => (
                None,
                Some("File is larger than 1 MiB; text diff unavailable.".into()),
            ),
            Ok(bytes) if bytes.contains(&0) => {
                (None, Some("Binary file; text diff unavailable.".into()))
            }
            Ok(bytes) => match String::from_utf8(bytes) {
                Ok(text) => {
                    let diff = text
                        .lines()
                        .map(|line| format!("+{line}\n"))
                        .collect::<String>();
                    (
                        Some(format!(
                            "--- /dev/null\n+++ b/{file}\n@@ -0,0 +1,{} @@\n{diff}",
                            text.lines().count()
                        )),
                        None,
                    )
                }
                Err(_) => (
                    None,
                    Some("File is not UTF-8 text; text diff unavailable.".into()),
                ),
            },
            Err(error) => (None, Some(format!("Could not read file: {error}"))),
        }
    } else if let Some(target) = target {
        match git(
            path,
            &[
                "--no-pager",
                "diff",
                "--no-ext-diff",
                "--no-color",
                "--unified=3",
                target,
                "--",
                file,
            ],
        ) {
            Ok(bytes) => match String::from_utf8(bytes) {
                Ok(text) if text.contains("Binary files ") || text.contains("GIT binary patch") => {
                    (None, Some("Binary file; text diff unavailable.".into()))
                }
                Ok(text) if text.is_empty() && status_for(path, file) == "conflicted" => (
                    None,
                    Some(format!("Conflict has no text diff against {target}.")),
                ),
                Ok(text) => (Some(text), None),
                Err(_) => (
                    None,
                    Some("Binary or non-text file; text diff unavailable.".into()),
                ),
            },
            Err(error) => (None, Some(error)),
        }
    } else {
        (
            None,
            Some(
                "Diff unavailable because no origin or local main/master branch could be resolved."
                    .into(),
            ),
        )
    }
}

pub fn review_repository(repository_id: &str, name: &str, path: &Path) -> ReviewRepository {
    let canonical = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let mut result = ReviewRepository {
        repository_id: repository_id.to_owned(),
        name: name.to_owned(),
        path: canonical.display().to_string(),
        comparison_target: None,
        comparison_error: None,
        files: Vec::new(),
    };
    if validate_repo_root(path).is_err() {
        result.comparison_error =
            Some("Recorded repository directory is unavailable or is not a Git repository.".into());
        return result;
    }
    let comparison_target = resolve_comparison_target(path);
    let target_ref = match comparison_target {
        Ok((git_ref, label)) => {
            result.comparison_target = Some(label);
            Some(git_ref)
        }
        Err(error) => {
            result.comparison_error = Some(error);
            None
        }
    };
    let mut files = BTreeMap::<String, String>::new();
    if let Some(target) = &target_ref {
        if let Ok(names) = git(path, &["diff", "--name-only", "-z", target, "--"]) {
            for name in names
                .split(|byte| *byte == 0)
                .filter(|item| !item.is_empty())
            {
                files.insert(String::from_utf8_lossy(name).into_owned(), "changed".into());
            }
        }
    }
    if let Ok(status) = git(
        path,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    ) {
        let mut entries = status
            .split(|byte| *byte == 0)
            .filter(|item| item.len() >= 4);
        while let Some(entry) = entries.next() {
            let state = String::from_utf8_lossy(&entry[..2]).trim().to_owned();
            let file = String::from_utf8_lossy(&entry[3..]).into_owned();
            files.insert(file, classify_status(&state));
            if state.contains('R') || state.contains('C') {
                // In porcelain -z output, rename/copy entries carry the second
                // path as a separate NUL-delimited record.
                let _ = entries.next();
            }
        }
    }
    result.files = files
        .into_iter()
        .map(|(file, status)| {
            let (diff, diff_error) = diff_for(path, &file, target_ref.as_deref());
            ReviewFile {
                path: file,
                status,
                diff,
                diff_error,
            }
        })
        .collect();
    result
}

fn resolve_comparison_target(path: &Path) -> Result<(String, String), String> {
    let advertised = git(
        path,
        &[
            "symbolic-ref",
            "--quiet",
            "--short",
            "refs/remotes/origin/HEAD",
        ],
    )
    .ok()
    .and_then(|bytes| String::from_utf8(bytes).ok())
    .map(|target| target.trim().to_owned());
    if let Some(target) =
        advertised.filter(|target| matches!(target.as_str(), "origin/main" | "origin/master"))
    {
        if git(
            path,
            &["rev-parse", "--verify", &format!("{target}^{{commit}}")],
        )
        .is_ok()
        {
            return Ok((target.clone(), target));
        }
    }
    for target in ["origin/main", "origin/master", "main", "master"] {
        if git(
            path,
            &["rev-parse", "--verify", &format!("{target}^{{commit}}")],
        )
        .is_ok()
        {
            let label = if target.starts_with("origin/") {
                target.to_owned()
            } else {
                format!("local {target}")
            };
            return Ok((target.to_owned(), label));
        }
    }
    Err("Cannot resolve origin/main, origin/master, local main, or local master".into())
}

pub fn validate_repo_root(path: &Path) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path).map_err(|error| error.to_string())?;
    let root = git(&canonical, &["rev-parse", "--show-toplevel"])?;
    let root = PathBuf::from(String::from_utf8_lossy(&root).trim());
    let root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    if root != canonical {
        return Err("Recorded path is not the repository root.".into());
    }
    Ok(canonical)
}

/// Resolves only repository paths already associated with the requested owner,
/// then gathers each repository independently so one bad checkout cannot hide
/// valid reviews for the others.
pub fn load_for_owner(
    store: &ManagementStore,
    owner_type: &str,
    owner_id: &str,
) -> Result<Vec<ReviewRepository>, String> {
    let repositories = match owner_type {
        "workspace" => {
            let workspace = store
                .get_workspace(owner_id)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| "Workspace was not found.".to_owned())?;
            store
                .list_workspace_repository_bindings(&workspace.id)
                .map_err(|error| error.to_string())?
                .into_iter()
                .filter(|binding| binding.verification_status == VerificationStatus::Verified)
                .map(|binding| (binding.repository_id, binding.checkout_path))
                .collect::<Vec<_>>()
        }
        _ => return Err("Change Review owner type must be workspace.".into()),
    };
    let mut reviews = Vec::with_capacity(repositories.len());
    for (repository_id, path) in repositories {
        let name = store
            .get_repository(&repository_id)
            .map_err(|error| error.to_string())?
            .map(|repository| repository.name)
            .unwrap_or_else(|| repository_id.clone());
        reviews.push(review_repository(&repository_id, &name, Path::new(&path)));
    }
    Ok(reviews)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::management::{NewWorkspace, WorkspaceKind};
    use tempfile::TempDir;

    fn run(path: &Path, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(path)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn repository() -> TempDir {
        let dir = tempfile::tempdir().unwrap();
        run(dir.path(), &["init", "-q", "-b", "main"]);
        run(dir.path(), &["config", "user.email", "test@example.com"]);
        run(dir.path(), &["config", "user.name", "Review Test"]);
        fs::write(dir.path().join("tracked.txt"), "base\n").unwrap();
        run(dir.path(), &["add", "."]);
        run(dir.path(), &["commit", "-qm", "base"]);
        run(
            dir.path(),
            &["update-ref", "refs/remotes/origin/main", "HEAD"],
        );
        dir
    }

    #[test]
    fn review_includes_tracked_and_untracked_text_files_against_origin_main() {
        let dir = repository();
        fs::write(dir.path().join("tracked.txt"), "updated\n").unwrap();
        fs::write(dir.path().join("new file.txt"), "added\n").unwrap();
        let review = review_repository("repo", "Example", dir.path());
        assert_eq!(review.files.len(), 2);
        let tracked = review
            .files
            .iter()
            .find(|file| file.path == "tracked.txt")
            .unwrap();
        assert!(tracked.diff.as_deref().unwrap().contains("+updated"));
        let untracked = review
            .files
            .iter()
            .find(|file| file.path == "new file.txt")
            .unwrap();
        assert_eq!(untracked.status, "untracked");
        assert!(untracked.diff.as_deref().unwrap().contains("+added"));
    }

    #[test]
    fn missing_origin_and_local_refs_keeps_working_tree_status_visible() {
        let dir = repository();
        run(
            dir.path(),
            &["update-ref", "-d", "refs/remotes/origin/main"],
        );
        run(dir.path(), &["update-ref", "-d", "refs/heads/main"]);
        fs::write(dir.path().join("tracked.txt"), "edited\n").unwrap();
        fs::write(dir.path().join("new.txt"), "new\n").unwrap();
        let review = review_repository("repo", "Example", dir.path());
        assert!(review
            .comparison_error
            .as_deref()
            .unwrap()
            .contains("local main, or local master"));
        assert!(review.comparison_target.is_none());
        assert_eq!(review.files.len(), 2);
        assert!(review
            .files
            .iter()
            .any(|file| file.path == "tracked.txt" && file.diff.is_none()));
        assert!(review
            .files
            .iter()
            .any(|file| file.path == "new.txt" && file.diff.is_some()));
    }

    #[test]
    fn local_main_and_master_are_supported_fallbacks() {
        for branch in ["main", "master"] {
            let dir = repository();
            run(
                dir.path(),
                &["update-ref", "-d", "refs/remotes/origin/main"],
            );
            if branch == "master" {
                run(dir.path(), &["update-ref", "refs/heads/master", "HEAD"]);
                run(dir.path(), &["update-ref", "-d", "refs/heads/main"]);
                run(dir.path(), &["symbolic-ref", "HEAD", "refs/heads/master"]);
            }
            fs::write(dir.path().join("tracked.txt"), "edited\n").unwrap();
            let review = review_repository("repo", "Example", dir.path());
            let expected_target = format!("local {branch}");
            assert_eq!(
                review.comparison_target.as_deref(),
                Some(expected_target.as_str())
            );
            assert!(review.files[0].diff.as_deref().unwrap().contains("+edited"));
        }
    }

    #[test]
    fn origin_master_is_used_when_it_is_the_only_supported_default_ref() {
        let dir = repository();
        run(
            dir.path(),
            &["update-ref", "-d", "refs/remotes/origin/main"],
        );
        run(
            dir.path(),
            &["update-ref", "refs/remotes/origin/master", "HEAD"],
        );
        fs::write(dir.path().join("tracked.txt"), "updated\n").unwrap();
        let review = review_repository("repo", "Example", dir.path());
        assert_eq!(review.comparison_target.as_deref(), Some("origin/master"));
        assert!(review.files[0]
            .diff
            .as_deref()
            .unwrap()
            .contains("+updated"));
    }

    #[test]
    fn configured_origin_head_selects_master_when_both_names_exist() {
        let dir = repository();
        run(
            dir.path(),
            &["update-ref", "refs/remotes/origin/master", "HEAD"],
        );
        run(
            dir.path(),
            &[
                "symbolic-ref",
                "refs/remotes/origin/HEAD",
                "refs/remotes/origin/master",
            ],
        );
        let review = review_repository("repo", "Example", dir.path());
        assert_eq!(review.comparison_target.as_deref(), Some("origin/master"));
    }

    #[test]
    fn origin_main_is_preferred_when_both_refs_exist_without_default_symref() {
        let dir = repository();
        run(
            dir.path(),
            &["update-ref", "refs/remotes/origin/master", "HEAD"],
        );
        let review = review_repository("repo", "Example", dir.path());
        assert_eq!(review.comparison_target.as_deref(), Some("origin/main"));
    }

    #[test]
    fn untracked_binary_remains_listed_without_text_diff() {
        let dir = repository();
        fs::write(dir.path().join("image.bin"), [0, 1, 2]).unwrap();
        let review = review_repository("repo", "Example", dir.path());
        let file = review
            .files
            .iter()
            .find(|file| file.path == "image.bin")
            .unwrap();
        assert!(file.diff.is_none());
        assert!(file.diff_error.as_deref().unwrap().contains("Binary"));
    }

    #[test]
    fn tracked_binary_remains_listed_without_rendering_git_binary_patch() {
        let dir = repository();
        fs::write(dir.path().join("image.bin"), [0, 1, 2]).unwrap();
        run(dir.path(), &["add", "image.bin"]);
        run(dir.path(), &["commit", "-qm", "add binary"]);
        run(
            dir.path(),
            &["update-ref", "refs/remotes/origin/main", "HEAD~1"],
        );
        let review = review_repository("repo", "Example", dir.path());
        let file = review
            .files
            .iter()
            .find(|file| file.path == "image.bin")
            .unwrap();
        assert!(file.diff.is_none());
        assert!(file.diff_error.as_deref().unwrap().contains("Binary"));
    }

    #[test]
    fn merge_conflicts_are_listed_with_conflicted_status() {
        let dir = repository();
        run(dir.path(), &["checkout", "-qb", "other"]);
        fs::write(dir.path().join("tracked.txt"), "other\n").unwrap();
        run(dir.path(), &["commit", "-qam", "other edit"]);
        run(dir.path(), &["checkout", "-q", "main"]);
        fs::write(dir.path().join("tracked.txt"), "local\n").unwrap();
        run(dir.path(), &["commit", "-qam", "local edit"]);
        let merge = Command::new("git")
            .arg("-C")
            .arg(dir.path())
            .args(["merge", "other"])
            .output()
            .unwrap();
        assert!(!merge.status.success());
        let review = review_repository("repo", "Example", dir.path());
        let file = review
            .files
            .iter()
            .find(|file| file.path == "tracked.txt")
            .unwrap();
        assert_eq!(file.status, "conflicted");
    }

    #[test]
    fn rename_status_does_not_create_a_spurious_file_entry() {
        let dir = repository();
        run(dir.path(), &["mv", "tracked.txt", "renamed.txt"]);
        let review = review_repository("repo", "Example", dir.path());
        assert_eq!(review.files.len(), 1);
        assert_eq!(review.files[0].path, "renamed.txt");
        assert!(review.files[0].status.contains('R'));
    }

    #[test]
    fn command_response_uses_the_frontend_contract_field_names() {
        let repository = ReviewRepository {
            repository_id: "repo".into(),
            name: "Example".into(),
            path: "/repo".into(),
            comparison_target: Some("origin/master".into()),
            comparison_error: None,
            files: vec![ReviewFile {
                path: "file.txt".into(),
                status: "M".into(),
                diff: Some("+line".into()),
                diff_error: None,
            }],
        };
        let value = serde_json::to_value(repository).unwrap();
        assert_eq!(value["repositoryId"], "repo");
        assert_eq!(value["comparisonError"], serde_json::Value::Null);
        assert_eq!(value["comparisonTarget"], "origin/master");
        assert_eq!(value["files"][0]["diffError"], serde_json::Value::Null);
    }

    #[test]
    fn owner_lookup_uses_management_store_and_rejects_legacy_task_owners() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("home")).unwrap();
        fs::create_dir_all(root.path().join("tmp")).unwrap();
        let store = ManagementStore::open_with_paths(
            root.path().join("management.sqlite"),
            root.path().join("home"),
            root.path().join("tmp"),
        )
        .unwrap();
        store
            .create_workspace(&NewWorkspace {
                id: "workspace-review".into(),
                name: "Review".into(),
                slug: "review".into(),
                description: None,
                kind: WorkspaceKind::Regular,
                created_at: 1,
            })
            .unwrap();
        assert!(load_for_owner(&store, "workspace", "workspace-review")
            .unwrap()
            .is_empty());
        assert!(load_for_owner(&store, "quick_request", "workspace-review").is_err());
        assert!(load_for_owner(&store, "task", "legacy-task").is_err());
        assert!(load_for_owner(&store, "workspace", "not-found").is_err());
    }
}
