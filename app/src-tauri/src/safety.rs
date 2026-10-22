//! Filesystem and Git inspection primitives for workspace/task ownership.
//!
//! Git is invoked with an argument vector (never through a shell), and all
//! inspection commands disable optional index writes. This module deliberately
//! contains no repository or worktree mutation commands.

use std::ffi::OsStr;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output};

#[derive(Debug)]
pub enum SafetyError {
    Io(io::Error),
    InvalidName(String),
    InvalidPath(String),
    Git(String),
    NotCataloged(String),
    IdentityMismatch(String),
}

impl std::fmt::Display for SafetyError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "filesystem safety error: {error}"),
            Self::InvalidName(message) => write!(formatter, "invalid name: {message}"),
            Self::InvalidPath(message) => write!(formatter, "unsafe path: {message}"),
            Self::Git(message) => write!(formatter, "Git inspection failed: {message}"),
            Self::NotCataloged(message) => {
                write!(formatter, "repository is not cataloged: {message}")
            }
            Self::IdentityMismatch(message) => {
                write!(formatter, "repository identity mismatch: {message}")
            }
        }
    }
}

impl std::error::Error for SafetyError {}

impl From<io::Error> for SafetyError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

pub type SafetyResult<T> = Result<T, SafetyError>;

/// The hidden ownership marker lets a retry recover a home created just before
/// a process interruption without adopting an unrelated pre-existing folder.
pub(crate) struct ManagedHomeGuard {
    created_directories: Vec<PathBuf>,
    marker: Option<PathBuf>,
    committed: bool,
}

impl ManagedHomeGuard {
    pub(crate) fn commit(mut self) {
        self.committed = true;
    }
}

impl Drop for ManagedHomeGuard {
    fn drop(&mut self) {
        if self.committed {
            return;
        }
        if let Some(marker) = self.marker.take() {
            // This marker was created by this invocation. Remove only that file;
            // remove_dir below succeeds only if no user content was added.
            let _ = fs::remove_file(marker);
        }
        for directory in self.created_directories.iter().rev() {
            let _ = fs::remove_dir(directory);
        }
    }
}

pub fn validate_name(name: &str) -> SafetyResult<()> {
    if name.trim().is_empty() {
        return Err(SafetyError::InvalidName("name must not be empty".into()));
    }
    if name.chars().any(char::is_control) {
        return Err(SafetyError::InvalidName(
            "control characters are not allowed".into(),
        ));
    }
    Ok(())
}

/// Produces a stable, ASCII-only slug. Collision suffixes are assigned by
/// `unique_slug` in the owning workspace/workspace-parent scope.
pub fn slugify_name(name: &str) -> SafetyResult<String> {
    validate_name(name)?;
    let mut slug = String::new();
    let mut pending_separator = false;
    for character in name.chars() {
        if character.is_ascii_alphanumeric() {
            if pending_separator && !slug.is_empty() {
                slug.push('-');
            }
            slug.push(character.to_ascii_lowercase());
            pending_separator = false;
        } else {
            pending_separator = true;
        }
    }
    if slug.is_empty() {
        slug.push_str("item");
    }
    if slug.len() > 96 {
        slug.truncate(96);
        while slug.ends_with('-') {
            slug.pop();
        }
    }
    Ok(slug)
}

pub fn unique_slug(base: &str, taken: impl Fn(&str) -> bool) -> SafetyResult<String> {
    validate_slug(base)?;
    if !taken(base) {
        return Ok(base.to_owned());
    }
    for suffix in 2_u64.. {
        let candidate = format!("{base}-{suffix}");
        if !taken(&candidate) {
            return Ok(candidate);
        }
    }
    unreachable!("the finite set of filesystem slugs cannot exhaust u64 suffixes")
}

pub fn validate_slug(slug: &str) -> SafetyResult<()> {
    if slug.is_empty()
        || slug.len() > 110
        || !slug
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        || slug.starts_with('-')
        || slug.ends_with('-')
        || slug.contains("--")
    {
        return Err(SafetyError::InvalidPath(format!(
            "slug {slug:?} is not a safe filesystem component"
        )));
    }
    Ok(())
}

fn reject_parent_components(path: &Path) -> SafetyResult<()> {
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(SafetyError::InvalidPath(format!(
            "parent traversal is not allowed in {}",
            path.display()
        )));
    }
    Ok(())
}

/// Canonicalizes existing paths and resolves a not-yet-existing suffix from its
/// nearest existing canonical ancestor. Parent traversal is always rejected.
pub fn canonicalize_or_resolve_missing(path: &Path) -> SafetyResult<PathBuf> {
    reject_parent_components(path)?;
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };
    let mut existing = absolute.as_path();
    let mut suffix = Vec::new();
    loop {
        match fs::symlink_metadata(existing) {
            Ok(_) => break,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                let name = existing.file_name().ok_or_else(|| {
                    SafetyError::InvalidPath(format!(
                        "cannot resolve a missing path ancestor for {}",
                        path.display()
                    ))
                })?;
                suffix.push(name.to_os_string());
                existing = existing.parent().ok_or_else(|| {
                    SafetyError::InvalidPath(format!(
                        "cannot resolve a missing path ancestor for {}",
                        path.display()
                    ))
                })?;
            }
            Err(error) => return Err(error.into()),
        }
    }
    let mut resolved = fs::canonicalize(existing)?;
    for component in suffix.into_iter().rev() {
        resolved.push(component);
    }
    Ok(resolved)
}

/// Resolves a persisted setting against the injected home, then verifies the
/// canonical target is the home or one of its descendants before any creation.
pub fn resolve_project_home_root(configured: &str, user_home: &Path) -> SafetyResult<PathBuf> {
    if configured.trim().is_empty() || configured.chars().any(char::is_control) {
        return Err(SafetyError::InvalidPath(
            "configured project home must be a non-empty path without control characters".into(),
        ));
    }
    let canonical_home = fs::canonicalize(user_home).map_err(|error| {
        SafetyError::InvalidPath(format!(
            "user home {} is unavailable: {error}",
            user_home.display()
        ))
    })?;
    let expanded = if let Some(relative) = configured.strip_prefix("~/") {
        canonical_home.join(relative)
    } else {
        let configured_path = PathBuf::from(configured);
        if configured_path.is_absolute() {
            configured_path
        } else {
            canonical_home.join(configured_path)
        }
    };
    reject_parent_components(&expanded)?;
    let canonical_root = canonicalize_or_resolve_missing(&expanded)?;
    if !canonical_root.starts_with(&canonical_home) {
        return Err(SafetyError::InvalidPath(format!(
            "configured project home {} is outside user home {}",
            canonical_root.display(),
            canonical_home.display()
        )));
    }
    Ok(canonical_root)
}

pub fn canonical_descendant(root: &Path, target: &Path) -> SafetyResult<PathBuf> {
    reject_parent_components(target)?;
    let canonical_root = canonicalize_or_resolve_missing(root)?;
    let canonical_target = canonicalize_or_resolve_missing(target)?;
    if canonical_target == canonical_root || canonical_target.starts_with(&canonical_root) {
        Ok(canonical_target)
    } else {
        Err(SafetyError::InvalidPath(format!(
            "{} is not inside {}",
            canonical_target.display(),
            canonical_root.display()
        )))
    }
}

fn ensure_directory(path: &Path, root: &Path, created: &mut Vec<PathBuf>) -> SafetyResult<PathBuf> {
    let path = canonical_descendant(root, path)?;
    match fs::create_dir(&path) {
        Ok(()) => created.push(path.clone()),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            let metadata = fs::symlink_metadata(&path)?;
            if !metadata.file_type().is_dir() {
                return Err(SafetyError::InvalidPath(format!(
                    "{} is not a regular directory",
                    path.display()
                )));
            }
        }
        Err(error) => return Err(error.into()),
    }
    let canonical = fs::canonicalize(&path)?;
    if !canonical.starts_with(root) {
        return Err(SafetyError::InvalidPath(format!(
            "directory {} escaped allowed root {}",
            canonical.display(),
            root.display()
        )));
    }
    Ok(canonical)
}

fn ensure_project_root(root: &Path, canonical_home: &Path) -> SafetyResult<()> {
    let target = canonical_descendant(canonical_home, root)?;
    let relative = target.strip_prefix(canonical_home).map_err(|_| {
        SafetyError::InvalidPath(format!("{} is outside user home", target.display()))
    })?;
    let mut current = canonical_home.to_path_buf();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err(SafetyError::InvalidPath(format!(
                "invalid project-home component in {}",
                target.display()
            )));
        };
        current.push(name);
        match fs::create_dir(&current) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                if !fs::symlink_metadata(&current)?.file_type().is_dir() {
                    return Err(SafetyError::InvalidPath(format!(
                        "{} is not a directory",
                        current.display()
                    )));
                }
            }
            Err(error) => return Err(error.into()),
        }
        let canonical = fs::canonicalize(&current)?;
        if !canonical.starts_with(canonical_home) {
            return Err(SafetyError::InvalidPath(format!(
                "project-home component {} escaped user home {}",
                canonical.display(),
                canonical_home.display()
            )));
        }
        current = canonical;
    }
    Ok(())
}

/// Creates one app-owned regular workspace/task home and its fixed subfolders.
/// Existing homes are accepted only when their ownership marker matches, which
/// makes process-crash retries safe without adopting or deleting user content.
pub(crate) fn ensure_managed_home(
    user_home: &Path,
    project_root: &Path,
    target: &Path,
    owner_kind: &str,
    owner_id: &str,
    children: &[&str],
) -> SafetyResult<(PathBuf, ManagedHomeGuard)> {
    if owner_id.trim().is_empty() || owner_id.chars().any(char::is_control) {
        return Err(SafetyError::InvalidName(
            "owner ID must be non-empty and contain no control characters".into(),
        ));
    }
    let canonical_home = fs::canonicalize(user_home)?;
    let canonical_root = canonical_descendant(&canonical_home, project_root)?;
    ensure_project_root(&canonical_root, &canonical_home)?;
    let canonical_root = fs::canonicalize(&canonical_root)?;
    let requested_target = target.to_path_buf();
    let target = canonical_descendant(&canonical_root, target)?;
    if target != requested_target {
        return Err(SafetyError::InvalidPath(format!(
            "managed home {} resolves through a symlink instead of its owning path",
            requested_target.display()
        )));
    }
    let mut created_directories = Vec::new();
    let target_was_missing = !target.exists();
    let canonical_target = ensure_directory(&target, &canonical_root, &mut created_directories)?;
    let mut guard = ManagedHomeGuard {
        created_directories,
        marker: None,
        committed: false,
    };
    let marker_path = canonical_target.join(".opencode-project-manager-owner");
    let marker_contents = format!("{owner_kind}\n{owner_id}\n");
    match fs::symlink_metadata(&marker_path) {
        Ok(metadata) => {
            if !metadata.file_type().is_file()
                || fs::read_to_string(&marker_path)? != marker_contents
            {
                return Err(SafetyError::InvalidPath(format!(
                    "{} is not owned by this {owner_kind} record",
                    canonical_target.display()
                )));
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound && target_was_missing => {
            let mut marker = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&marker_path)?;
            guard.marker = Some(marker_path.clone());
            marker.write_all(marker_contents.as_bytes())?;
            marker.sync_all()?;
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Err(SafetyError::InvalidPath(format!(
                "pre-existing home {} has no ownership marker",
                canonical_target.display()
            )));
        }
        Err(error) => return Err(error.into()),
    }

    for child in children {
        validate_slug(child)?;
        if let Err(error) = ensure_directory(
            &canonical_target.join(child),
            &canonical_target,
            &mut guard.created_directories,
        ) {
            return Err(error);
        }
    }
    Ok((canonical_target, guard))
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GitRepositoryInfo {
    pub canonical_root: PathBuf,
    pub canonical_common_dir: PathBuf,
    /// Stable for a local repository and all its linked worktrees. It changes
    /// when the common Git directory is moved, intentionally distinguishing
    /// different local clones of the same remote.
    pub identity: String,
    pub current_branch: Option<String>,
    /// Canonical default branch from `origin/HEAD`, or a bare repository's
    /// symbolic `HEAD`. Ordinary checked-out `HEAD` is not treated as a default.
    pub default_branch: Option<String>,
    pub branches: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GitWorktreeInfo {
    pub canonical_path: PathBuf,
    pub head: Option<String>,
    pub branch: Option<String>,
    pub bare: bool,
    pub detached: bool,
    pub locked: bool,
    pub prunable: bool,
    pub clean: Option<bool>,
    /// `git status --porcelain=v1 --untracked-files=all` entries.
    pub status_entries: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GitInspection {
    pub repository: GitRepositoryInfo,
    pub worktrees: Vec<GitWorktreeInfo>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GitBranchInfo {
    pub name: String,
    pub valid: bool,
    pub exists: bool,
    pub owning_worktrees: Vec<PathBuf>,
}

fn git_output(path: &Path, arguments: &[&OsStr]) -> SafetyResult<Output> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(arguments)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_CONFIG_COUNT", "2")
        .env("GIT_CONFIG_KEY_0", "core.fsmonitor")
        .env("GIT_CONFIG_VALUE_0", "false")
        .env("GIT_CONFIG_KEY_1", "core.untrackedCache")
        .env("GIT_CONFIG_VALUE_1", "false")
        .output()
        .map_err(|error| SafetyError::Git(format!("could not start git: {error}")))?;
    if !output.status.success() {
        return Err(SafetyError::Git(format!(
            "git -C {} {} exited with {}: {}",
            path.display(),
            arguments
                .iter()
                .map(|argument| argument.to_string_lossy())
                .collect::<Vec<_>>()
                .join(" "),
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(output)
}

fn git_text(path: &Path, arguments: &[&str]) -> SafetyResult<String> {
    let arguments = arguments.iter().map(OsStr::new).collect::<Vec<_>>();
    let output = git_output(path, &arguments)?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn git_optional_text(path: &Path, arguments: &[&str]) -> SafetyResult<Option<String>> {
    let arguments = arguments.iter().map(OsStr::new).collect::<Vec<_>>();
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(&arguments)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_CONFIG_COUNT", "2")
        .env("GIT_CONFIG_KEY_0", "core.fsmonitor")
        .env("GIT_CONFIG_VALUE_0", "false")
        .env("GIT_CONFIG_KEY_1", "core.untrackedCache")
        .env("GIT_CONFIG_VALUE_1", "false")
        .output()
        .map_err(|error| SafetyError::Git(format!("could not start git: {error}")))?;
    if output.status.success() {
        return Ok(Some(
            String::from_utf8_lossy(&output.stdout).trim().to_owned(),
        ));
    }
    if output.status.code() == Some(1) {
        return Ok(None);
    }
    Err(SafetyError::Git(format!(
        "git -C {} {} exited with {}: {}",
        path.display(),
        arguments
            .iter()
            .map(|argument| argument.to_string_lossy())
            .collect::<Vec<_>>()
            .join(" "),
        output.status,
        String::from_utf8_lossy(&output.stderr).trim()
    )))
}

fn branch_from_symbolic_ref(target: &str, prefix: &str, branches: &[String]) -> Option<String> {
    let branch = target.strip_prefix(prefix)?;
    if branch.is_empty() || !branches.iter().any(|candidate| candidate == branch) {
        return None;
    }
    Some(branch.to_owned())
}

fn inspect_default_branch(path: &Path, branches: &[String]) -> SafetyResult<Option<String>> {
    if let Some(target) = git_optional_text(
        path,
        &["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
    )? {
        return Ok(branch_from_symbolic_ref(
            &target,
            "refs/remotes/origin/",
            branches,
        ));
    }

    if git_text(path, &["rev-parse", "--is-bare-repository"])? != "true" {
        // Match Change Review's established fallback order when origin/HEAD is
        // absent. Require both the local branch and its origin tracking ref so
        // workspace cloning has a verified branch to use.
        for branch in ["main", "master"] {
            let remote_ref = format!("refs/remotes/origin/{branch}");
            let remote_branch_exists = git_quiet(
                path,
                &[
                    OsStr::new("show-ref"),
                    OsStr::new("--verify"),
                    OsStr::new("--quiet"),
                    OsStr::new(&remote_ref),
                ],
            )?;
            if branches.iter().any(|candidate| candidate == branch) && remote_branch_exists {
                return Ok(Some(branch.to_owned()));
            }
        }
        return Ok(None);
    }
    let Some(target) = git_optional_text(path, &["symbolic-ref", "--quiet", "HEAD"])? else {
        return Ok(None);
    };
    Ok(branch_from_symbolic_ref(&target, "refs/heads/", branches))
}

fn git_quiet(path: &Path, arguments: &[&OsStr]) -> SafetyResult<bool> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(arguments)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_CONFIG_COUNT", "2")
        .env("GIT_CONFIG_KEY_0", "core.fsmonitor")
        .env("GIT_CONFIG_VALUE_0", "false")
        .env("GIT_CONFIG_KEY_1", "core.untrackedCache")
        .env("GIT_CONFIG_VALUE_1", "false")
        .output()
        .map_err(|error| SafetyError::Git(format!("could not start git: {error}")))?;
    Ok(output.status.success())
}

fn worktree_status(path: &Path) -> SafetyResult<Vec<String>> {
    let output = git_output(
        path,
        &[
            OsStr::new("status"),
            OsStr::new("--porcelain=v1"),
            OsStr::new("--untracked-files=all"),
            OsStr::new("--ignored=matching"),
            OsStr::new("--ignore-submodules=none"),
        ],
    )?;
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::to_owned)
        .collect())
}

fn parse_worktrees(repo_root: &Path) -> SafetyResult<Vec<GitWorktreeInfo>> {
    let output = git_output(
        repo_root,
        &[
            OsStr::new("worktree"),
            OsStr::new("list"),
            OsStr::new("--porcelain"),
            OsStr::new("-z"),
        ],
    )?;
    let fields = output.stdout.split(|byte| *byte == 0).collect::<Vec<_>>();
    let mut records: Vec<Vec<String>> = Vec::new();
    let mut current = Vec::new();
    for field in fields {
        if field.is_empty() {
            if !current.is_empty() {
                records.push(std::mem::take(&mut current));
            }
            continue;
        }
        current.push(String::from_utf8_lossy(field).into_owned());
    }
    if !current.is_empty() {
        records.push(current);
    }

    let mut worktrees = Vec::new();
    for record in records {
        let raw_path = record
            .iter()
            .find_map(|field| field.strip_prefix("worktree "))
            .ok_or_else(|| SafetyError::Git("worktree record omitted its path".into()))?;
        let path = PathBuf::from(raw_path);
        let canonical_path = match fs::canonicalize(&path) {
            Ok(path) => path,
            Err(error) if error.kind() == io::ErrorKind::NotFound => path,
            Err(error) => return Err(error.into()),
        };
        let branch = record
            .iter()
            .find_map(|field| field.strip_prefix("branch refs/heads/"))
            .map(str::to_owned);
        let head = record
            .iter()
            .find_map(|field| field.strip_prefix("HEAD "))
            .map(str::to_owned);
        let bare = record.iter().any(|field| field == "bare");
        let detached = record.iter().any(|field| field == "detached");
        let locked = record
            .iter()
            .any(|field| field == "locked" || field.starts_with("locked "));
        let prunable = record
            .iter()
            .any(|field| field == "prunable" || field.starts_with("prunable "));
        let (clean, status_entries) = if canonical_path.is_dir() && !bare {
            match worktree_status(&canonical_path) {
                Ok(entries) => (Some(entries.is_empty()), entries),
                Err(_) => (None, Vec::new()),
            }
        } else {
            (None, Vec::new())
        };
        worktrees.push(GitWorktreeInfo {
            canonical_path,
            head,
            branch,
            bare,
            detached,
            locked,
            prunable,
            clean,
            status_entries,
        });
    }
    Ok(worktrees)
}

pub fn inspect_repository(path: &Path) -> SafetyResult<GitInspection> {
    reject_parent_components(path)?;
    let root_text = git_text(path, &["rev-parse", "--show-toplevel"])?;
    let canonical_root = fs::canonicalize(root_text)?;
    // Query from the canonical top-level path so any relative common-dir
    // result is resolved against a stable base. Avoid newer rev-parse flags to
    // retain compatibility with the Git versions commonly shipped on macOS.
    let common_text = git_text(&canonical_root, &["rev-parse", "--git-common-dir"])?;
    let common_path = PathBuf::from(common_text);
    let common_path = if common_path.is_absolute() {
        common_path
    } else {
        canonical_root.join(common_path)
    };
    let canonical_common_dir = fs::canonicalize(common_path)?;
    let current_branch = match git_text(path, &["symbolic-ref", "--quiet", "--short", "HEAD"]) {
        Ok(branch) if !branch.is_empty() => Some(branch),
        _ => None,
    };
    let branch_text = git_text(
        path,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    )?;
    let branches: Vec<String> = branch_text
        .lines()
        .filter(|branch| !branch.is_empty())
        .map(str::to_owned)
        .collect();
    let default_branch = inspect_default_branch(path, &branches)?;
    let repository = GitRepositoryInfo {
        canonical_root: canonical_root.clone(),
        canonical_common_dir: canonical_common_dir.clone(),
        identity: format!("git-common-dir:{}", canonical_common_dir.display()),
        current_branch,
        default_branch,
        branches,
    };
    let worktrees = parse_worktrees(&canonical_root)?;
    Ok(GitInspection {
        repository,
        worktrees,
    })
}

pub fn inspect_branch(repository_path: &Path, branch: &str) -> SafetyResult<GitBranchInfo> {
    reject_parent_components(repository_path)?;
    if branch.is_empty() || branch.starts_with('-') {
        return Ok(GitBranchInfo {
            name: branch.to_owned(),
            valid: false,
            exists: false,
            owning_worktrees: Vec::new(),
        });
    }
    let valid = git_quiet(
        repository_path,
        &[
            OsStr::new("check-ref-format"),
            OsStr::new("--branch"),
            OsStr::new(branch),
        ],
    )?;
    if !valid {
        return Ok(GitBranchInfo {
            name: branch.to_owned(),
            valid: false,
            exists: false,
            owning_worktrees: Vec::new(),
        });
    }
    let reference = format!("refs/heads/{branch}");
    let exists = git_quiet(
        repository_path,
        &[
            OsStr::new("show-ref"),
            OsStr::new("--verify"),
            OsStr::new("--quiet"),
            OsStr::new(&reference),
        ],
    )?;
    let inspection = inspect_repository(repository_path)?;
    let owning_worktrees = inspection
        .worktrees
        .iter()
        .filter(|worktree| worktree.branch.as_deref() == Some(branch))
        .map(|worktree| worktree.canonical_path.clone())
        .collect();
    Ok(GitBranchInfo {
        name: branch.to_owned(),
        valid,
        exists,
        owning_worktrees,
    })
}

/// Remove one already-verified, clean worktree.  This is intentionally the
/// only Git mutation used by cleanup: it never passes `--force`, and never
/// touches the branch reference.
pub fn remove_clean_worktree(
    repository_path: &Path,
    worktree_path: &Path,
    branch: &str,
) -> SafetyResult<()> {
    let inspection = inspect_repository(worktree_path)?;
    let Some(worktree) = inspection.worktrees.iter().find(|item| {
        item.canonical_path
            == fs::canonicalize(worktree_path).unwrap_or_else(|_| worktree_path.to_path_buf())
    }) else {
        return Err(SafetyError::Git("worktree is not registered by Git".into()));
    };
    if worktree.branch.as_deref() != Some(branch)
        || worktree.clean != Some(true)
        || worktree.prunable
        || worktree.locked
    {
        return Err(SafetyError::Git(
            "worktree changed or is not clean/removable".into(),
        ));
    }
    let branch_info = inspect_branch(repository_path, branch)?;
    if !branch_info.valid
        || !branch_info.exists
        || branch_info.owning_worktrees != [worktree.canonical_path.clone()]
    {
        return Err(SafetyError::Git(
            "branch ownership changed while cleaning".into(),
        ));
    }
    let path = worktree_path.as_os_str();
    let output = git_output(
        repository_path,
        &[
            OsStr::new("worktree"),
            OsStr::new("remove"),
            OsStr::new("--"),
            path,
        ],
    )?;
    if !output.status.success() {
        return Err(SafetyError::Git(
            "Git refused clean worktree removal".into(),
        ));
    }
    Ok(())
}

pub(crate) fn ensure_regular_workspace_home(
    user_home: &Path,
    project_root: &Path,
    slug: &str,
    id: &str,
) -> SafetyResult<(PathBuf, ManagedHomeGuard)> {
    validate_slug(slug)?;
    let target = project_root.join(slug);
    ensure_managed_home(
        user_home,
        project_root,
        &target,
        "workspace",
        id,
        &["notes", "repos", "tasks"],
    )
}

pub(crate) fn ensure_regular_task_home(
    user_home: &Path,
    project_root: &Path,
    workspace_slug: &str,
    task_slug: &str,
    id: &str,
) -> SafetyResult<(PathBuf, ManagedHomeGuard)> {
    validate_slug(workspace_slug)?;
    validate_slug(task_slug)?;
    let target = project_root
        .join(workspace_slug)
        .join("tasks")
        .join(task_slug);
    ensure_managed_home(
        user_home,
        project_root,
        &target,
        "task",
        id,
        &["notes", "worktrees"],
    )
}

/// Remove a regular home created by a failed operation, but only when it still
/// has the exact shape Rust created.  In particular, never remove user files
/// that may have been added after the operation started.
pub(crate) fn remove_empty_managed_home(
    project_root: &Path,
    target: &Path,
    owner_kind: &str,
    owner_id: &str,
    children: &[&str],
) -> SafetyResult<()> {
    let root = fs::canonicalize(project_root)?;
    let canonical_target = fs::canonicalize(target)?;
    if !canonical_target.starts_with(&root) || canonical_target != target {
        return Err(SafetyError::InvalidPath(
            "managed home changed or escaped its root".into(),
        ));
    }
    let marker = canonical_target.join(".opencode-project-manager-owner");
    let expected = format!("{owner_kind}\n{owner_id}\n");
    if fs::read_to_string(&marker)? != expected {
        return Err(SafetyError::InvalidPath(
            "managed home ownership marker mismatch".into(),
        ));
    }
    for child in children {
        let path = canonical_target.join(child);
        if !fs::canonicalize(&path)?.starts_with(&canonical_target)
            || fs::read_dir(&path)?.next().is_some()
        {
            return Err(SafetyError::InvalidPath(
                "managed home contains user content".into(),
            ));
        }
    }
    for child in children {
        fs::remove_dir(canonical_target.join(child))?;
    }
    fs::remove_file(marker)?;
    fs::remove_dir(canonical_target)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn slugs_are_stable_safe_and_receive_deterministic_collision_suffixes() {
        let first = slugify_name("  API cleanup & review  ").unwrap();
        assert_eq!(first, "api-cleanup-review");
        assert_eq!(slugify_name("  API cleanup & review  ").unwrap(), first);
        assert_eq!(
            unique_slug(&first, |candidate| candidate == first
                || candidate == "api-cleanup-review-2")
            .unwrap(),
            "api-cleanup-review-3"
        );
        assert!(validate_slug("../escape").is_err());
        assert!(validate_name("\n\t").is_err());
    }

    #[test]
    fn project_root_rejects_parent_and_symlink_escapes_before_creation() {
        let fixture = tempdir().unwrap();
        let home = fixture.path().join("home");
        fs::create_dir(&home).unwrap();
        let outside = fixture.path().join("outside");
        fs::create_dir(&outside).unwrap();
        assert!(resolve_project_home_root(outside.to_str().unwrap(), &home).is_err());
        assert!(resolve_project_home_root("~/../outside", &home).is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside, home.join("escape")).unwrap();
            assert!(resolve_project_home_root("~/escape/new", &home).is_err());
        }
        assert!(!home.join("OpenCode Projects").exists());
    }

    #[test]
    fn managed_home_markers_record_the_exact_owner_kind_and_id() {
        let fixture = tempdir().unwrap();
        let home = fixture.path().join("home");
        fs::create_dir(&home).unwrap();
        let project_root = home.join("Projects");

        let (workspace_home, workspace_guard) =
            ensure_regular_workspace_home(&home, &project_root, "workspace", "workspace-marker-id")
                .unwrap();
        assert_eq!(
            fs::read_to_string(workspace_home.join(".opencode-project-manager-owner")).unwrap(),
            "workspace\nworkspace-marker-id\n"
        );
        for child in ["notes", "repos", "tasks"] {
            assert!(workspace_home.join(child).is_dir());
        }
        workspace_guard.commit();

        let (task_home, task_guard) =
            ensure_regular_task_home(&home, &project_root, "workspace", "task", "task-marker-id")
                .unwrap();
        assert_eq!(
            fs::read_to_string(task_home.join(".opencode-project-manager-owner")).unwrap(),
            "task\ntask-marker-id\n"
        );
        for child in ["notes", "worktrees"] {
            assert!(task_home.join(child).is_dir());
        }
        task_guard.commit();
    }

    #[test]
    fn preexisting_unowned_or_mismatched_homes_are_not_adopted_or_modified() {
        let fixture = tempdir().unwrap();
        let home = fixture.path().join("home");
        let project_root = home.join("Projects");
        fs::create_dir_all(&project_root).unwrap();

        let unrelated_home = project_root.join("unrelated");
        fs::create_dir(&unrelated_home).unwrap();
        fs::write(unrelated_home.join("sentinel.txt"), "keep unrelated data\n").unwrap();
        assert!(ensure_regular_workspace_home(
            &home,
            &project_root,
            "unrelated",
            "workspace-unrelated",
        )
        .is_err());
        assert_eq!(
            fs::read_to_string(unrelated_home.join("sentinel.txt")).unwrap(),
            "keep unrelated data\n"
        );
        assert!(!unrelated_home
            .join(".opencode-project-manager-owner")
            .exists());
        assert!(!unrelated_home.join("notes").exists());

        let mismatched_home = project_root.join("mismatched");
        fs::create_dir(&mismatched_home).unwrap();
        let marker = mismatched_home.join(".opencode-project-manager-owner");
        fs::write(&marker, "workspace\nsome-other-record\n").unwrap();
        fs::write(
            mismatched_home.join("sentinel.txt"),
            "keep mismatched data\n",
        )
        .unwrap();
        assert!(ensure_regular_workspace_home(
            &home,
            &project_root,
            "mismatched",
            "workspace-expected-record",
        )
        .is_err());
        assert_eq!(
            fs::read_to_string(&marker).unwrap(),
            "workspace\nsome-other-record\n"
        );
        assert_eq!(
            fs::read_to_string(mismatched_home.join("sentinel.txt")).unwrap(),
            "keep mismatched data\n"
        );
        assert!(!mismatched_home.join("notes").exists());
    }
}
