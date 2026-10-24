//! Deterministic, side-effect-free planning for workspace repository setup.

use serde::{Deserialize, Serialize};
use std::{
    ffi::OsString,
    fs,
    path::{Component, Path, PathBuf},
    process::Command,
};

use crate::{management, safety};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleFact {
    pub path: String,
    pub url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryPreflight {
    pub repository_id: String,
    pub name: String,
    pub source_path: PathBuf,
    pub source_identity: String,
    pub head: String,
    pub default_branch: Option<String>,
    pub default_branch_head: Option<String>,
    pub clean: bool,
    pub upstream_fetch_url: Option<String>,
    pub submodules: Vec<SubmoduleFact>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositorySetupPlan {
    pub repository_id: String,
    pub source_path: PathBuf,
    pub source_identity: String,
    pub source_head: String,
    pub default_branch: String,
    pub default_branch_head: String,
    pub destination_path: PathBuf,
    pub upstream_fetch_url: Option<String>,
    pub submodules: Vec<SubmoduleFact>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSetupPlan {
    pub workspace_home: PathBuf,
    pub repositories: Vec<RepositorySetupPlan>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskWorktree {
    pub repository_id: String,
    pub branch: String,
    pub path: PathBuf,
    pub checkout_identity: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RepositoryLibraryPaths {
    pub base_checkout: PathBuf,
    pub workspace_worktree: PathBuf,
    pub workspace_link: PathBuf,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RepositoryLibrarySetupPlan {
    pub repository_id: String,
    pub source_path: PathBuf,
    pub source_identity: String,
    pub source_head: String,
    pub default_branch: String,
    pub default_branch_head: String,
    pub upstream_fetch_url: Option<String>,
    pub library_relative_path: PathBuf,
    pub base_checkout_path: PathBuf,
    pub worktree_path: PathBuf,
    pub workspace_link: PathBuf,
    pub base_staging_path: PathBuf,
    pub workspace_branch: String,
    pub submodules: Vec<SubmoduleFact>,
}

pub fn plan_repository_library_setup(
    library_root: &Path,
    workspace_home: &Path,
    workspace_id: &str,
    repository: &RepositoryPreflight,
) -> Result<RepositoryLibrarySetupPlan, String> {
    if !library_root.is_absolute()
        || !workspace_home.is_absolute()
        || workspace_id.is_empty()
        || !workspace_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        || repository.repository_id.is_empty()
        || repository.source_identity.is_empty()
        || !repository.source_path.is_absolute()
    {
        return Err("repository library setup identity or source is invalid".into());
    }
    if library_root.starts_with(&repository.source_path)
        || repository.source_path.starts_with(library_root)
        || library_root.starts_with(workspace_home)
        || workspace_home.starts_with(library_root)
    {
        return Err(
            "repository library, source checkout, and Workspace home must be separate paths".into(),
        );
    }
    let default_branch = repository
        .default_branch
        .clone()
        .filter(|branch| !branch.trim().is_empty())
        .ok_or_else(|| {
            format!(
                "Repository {} has no resolvable default branch",
                repository.name
            )
        })?;
    let default_branch_head = repository
        .default_branch_head
        .clone()
        .filter(|head| !head.trim().is_empty())
        .ok_or_else(|| {
            format!(
                "Repository {} has no default-branch commit",
                repository.name
            )
        })?;
    let library_relative_path = repository_library_relative_path(
        repository.upstream_fetch_url.as_deref(),
        &repository.source_identity,
        &repository.name,
    )?;
    let paths = repository_library_paths(
        library_root,
        workspace_home,
        &library_relative_path,
        workspace_id,
    )?;
    let repository_name = paths
        .base_checkout
        .file_name()
        .ok_or_else(|| "Repository library checkout path has no name".to_owned())?
        .to_string_lossy();
    let base_staging_path = paths
        .base_checkout
        .parent()
        .unwrap()
        .join(format!(".{repository_name}.staging-{workspace_id}"));
    Ok(RepositoryLibrarySetupPlan {
        repository_id: repository.repository_id.clone(),
        source_path: repository.source_path.clone(),
        source_identity: repository.source_identity.clone(),
        source_head: repository.head.clone(),
        default_branch,
        default_branch_head,
        upstream_fetch_url: repository.upstream_fetch_url.clone(),
        library_relative_path,
        base_checkout_path: paths.base_checkout,
        worktree_path: paths.workspace_worktree,
        workspace_link: paths.workspace_link,
        base_staging_path,
        workspace_branch: format!("work/{workspace_id}"),
        submodules: repository.submodules.clone(),
    })
}

/// Keeps a failed Workspace retry bound to the exact paths already recorded,
/// even if the user changes the repository-library setting after setup began.
pub fn use_recorded_workspace_repository_paths(
    plan: &mut RepositoryLibrarySetupPlan,
    record: &management::WorkspaceRepositoryWorktree,
) -> Result<(), String> {
    if record.base_checkout_path.is_empty() || record.workspace_link.is_empty() {
        return Err(
            "This older Workspace worktree record has incomplete repository paths; review repository setup before retrying."
                .into(),
        );
    }
    if record.repository_id != plan.repository_id
        || record.source_identity != plan.source_identity
        || !Path::new(&record.base_checkout_path).is_absolute()
        || !Path::new(&record.worktree_path).is_absolute()
        || !Path::new(&record.workspace_link).is_absolute()
        || record.branch.is_empty()
    {
        return Err(
            "Recorded Workspace repository paths do not match the reviewed repository.".into(),
        );
    }
    for path in [
        Path::new(&record.base_checkout_path),
        Path::new(&record.worktree_path),
        Path::new(&record.workspace_link),
    ] {
        if path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
        {
            return Err("Recorded Workspace repository path is not normalized.".into());
        }
    }
    let base_checkout_path = PathBuf::from(&record.base_checkout_path);
    let base_parent = base_checkout_path
        .parent()
        .ok_or_else(|| "Recorded repository base has no parent.".to_owned())?
        .to_path_buf();
    let base_name = base_checkout_path
        .file_name()
        .ok_or_else(|| "Recorded repository base has no name.".to_owned())?
        .to_string_lossy()
        .into_owned();
    plan.base_checkout_path = base_checkout_path;
    plan.base_staging_path =
        base_parent.join(format!(".{base_name}.staging-{}", record.workspace_id));
    plan.worktree_path = PathBuf::from(&record.worktree_path);
    plan.workspace_link = PathBuf::from(&record.workspace_link);
    plan.workspace_branch = record.branch.clone();
    Ok(())
}

/// Verifies a previously provisioned Workspace repo without moving or
/// recreating it. Dirty worktrees remain valid because they contain user work.
pub fn verify_recorded_workspace_repository(
    plan: &RepositoryLibrarySetupPlan,
    expected_checkout_identity: &str,
) -> Result<WorkspaceRepositoryProvisionResult, String> {
    let base = verify_library_base(plan)?;
    if base.checkout_identity != expected_checkout_identity {
        return Err("Recorded repository base identity no longer matches.".into());
    }
    let worktree_path = fs::canonicalize(&plan.worktree_path)
        .map_err(|error| format!("Recorded Workspace worktree is unavailable: {error}"))?;
    if worktree_path != plan.worktree_path {
        return Err("Recorded Workspace worktree resolves through a symlink.".into());
    }
    let worktree = safety::inspect_repository(&worktree_path)
        .map_err(|error| format!("Recorded Workspace worktree is invalid: {error}"))?;
    if worktree.repository.identity != expected_checkout_identity
        || worktree.repository.current_branch.as_deref() != Some(plan.workspace_branch.as_str())
    {
        return Err("Recorded Workspace worktree identity or branch changed.".into());
    }
    verify_submodules(&worktree_path)?;
    if !fs::symlink_metadata(&plan.workspace_link)
        .map_err(|error| format!("Workspace repository alias is unavailable: {error}"))?
        .file_type()
        .is_symlink()
    {
        return Err("Workspace repository alias is not a symbolic link.".into());
    }
    let canonical_link = fs::canonicalize(&plan.workspace_link)
        .map_err(|error| format!("Workspace repository alias is unavailable: {error}"))?;
    if canonical_link != worktree_path {
        return Err("Workspace repository alias no longer points to its recorded worktree.".into());
    }
    let worktree = TaskWorktree {
        repository_id: plan.repository_id.clone(),
        branch: plan.workspace_branch.clone(),
        path: worktree_path,
        checkout_identity: worktree.repository.identity,
    };
    Ok(WorkspaceRepositoryProvisionResult {
        base_checkout: base,
        worktree,
    })
}

/// Provisions the shared managed base checkout exactly once. Existing checkout
/// content is verified and never overwritten. A staging checkout is retained
/// on failure so an explicit retry can validate and continue it.
pub fn provision_repository_library_base(
    plan: &RepositoryLibrarySetupPlan,
) -> Result<CloneProvisionResult, String> {
    if !plan.base_checkout_path.is_absolute()
        || plan.base_staging_path.parent() != plan.base_checkout_path.parent()
        || plan.base_staging_path == plan.base_checkout_path
    {
        return Err("Managed repository base and staging paths are invalid".into());
    }
    verify_library_source(plan)?;
    let parent = plan
        .base_checkout_path
        .parent()
        .ok_or_else(|| "Managed repository base has no parent".to_owned())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create managed repository parent: {error}"))?;
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|error| format!("Could not resolve managed repository parent: {error}"))?;
    if canonical_parent != parent {
        return Err("Managed repository parent resolves through a symlink.".into());
    }
    if plan.base_checkout_path.exists() {
        if fs::symlink_metadata(&plan.base_checkout_path)
            .map_err(|error| error.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("Managed repository base path must not be a symbolic link.".into());
        }
        return verify_library_base(plan);
    }
    if !plan.base_staging_path.exists() {
        let output = Command::new("git")
            .args(["clone", "--no-hardlinks", "--branch"])
            .arg(&plan.default_branch)
            .arg("--")
            .arg(&plan.source_path)
            .arg(&plan.base_staging_path)
            .env("GIT_LFS_SKIP_SMUDGE", "1")
            .output()
            .map_err(|error| format!("Could not start managed repository clone: {error}"))?;
        if !output.status.success() {
            return Err(format!(
                "Could not clone managed repository base: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
    } else if fs::symlink_metadata(&plan.base_staging_path)
        .map_err(|error| error.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("Managed repository staging path must not be a symbolic link.".into());
    }
    configure_library_base_remote(&plan.base_staging_path, plan)?;
    run_git(
        &plan.base_staging_path,
        &["submodule", "update", "--init", "--recursive"],
    )?;
    verify_submodules(&plan.base_staging_path)?;
    verify_no_object_alternates(&plan.base_staging_path)?;
    verify_library_checkout(plan, &plan.base_staging_path)?;
    match fs::rename(&plan.base_staging_path, &plan.base_checkout_path) {
        Ok(()) => verify_library_base(plan),
        Err(error) if plan.base_checkout_path.exists() => verify_library_base(plan).map_err(|verify| {
            format!("Could not finalize shared repository checkout ({error}); existing checkout is invalid: {verify}")
        }),
        Err(error) => Err(format!("Could not finalize managed repository checkout: {error}")),
    }
}

fn verify_library_source(plan: &RepositoryLibrarySetupPlan) -> Result<(), String> {
    let inspection = safety::inspect_repository(&plan.source_path)
        .map_err(|error| format!("Could not revalidate repository source: {error}"))?;
    if inspection.repository.canonical_root != plan.source_path
        || inspection.repository.identity != plan.source_identity
    {
        return Err("Repository source identity changed after review.".into());
    }
    let source_worktree = inspection
        .worktrees
        .iter()
        .find(|worktree| worktree.canonical_path == plan.source_path)
        .ok_or_else(|| "Could not find the reviewed repository source worktree.".to_owned())?;
    if source_worktree.head.as_deref() != Some(plan.source_head.as_str()) {
        return Err("Repository source commit changed after review.".into());
    }
    let default_head = git_text(
        &plan.source_path,
        &["rev-parse", &format!("refs/heads/{}", plan.default_branch)],
    )?;
    if default_head != plan.default_branch_head {
        return Err("Repository default branch moved after review.".into());
    }
    if read_submodule_facts(&plan.source_path)? != plan.submodules {
        return Err("Repository submodule configuration changed after review.".into());
    }
    let remote = git_optional_text(&plan.source_path, &["remote", "get-url", "origin"])?;
    if remote != plan.upstream_fetch_url {
        return Err("Repository upstream URL changed after review.".into());
    }
    Ok(())
}

fn configure_library_base_remote(
    checkout: &Path,
    plan: &RepositoryLibrarySetupPlan,
) -> Result<(), String> {
    match plan.upstream_fetch_url.as_deref() {
        Some(url) => {
            let output = Command::new("git")
                .arg("-C")
                .arg(checkout)
                .args(["remote", "set-url", "origin", url])
                .output()
                .map_err(|error| {
                    format!("Could not configure managed repository remote: {error}")
                })?;
            if !output.status.success() {
                run_git(checkout, &["remote", "add", "origin", url])?;
            }
        }
        None => {
            let result = Command::new("git")
                .arg("-C")
                .arg(checkout)
                .args(["remote", "remove", "origin"])
                .output()
                .map_err(|error| format!("Could not remove local source remote: {error}"))?;
            if !result.status.success() {
                // A repository without an origin is already in the desired state.
                let remotes = git_optional_text(checkout, &["remote"])?;
                if remotes.as_deref().is_some_and(|value| !value.is_empty()) {
                    return Err("Could not remove unexpected managed repository remote.".into());
                }
            }
        }
    }
    Ok(())
}

fn verify_library_checkout(
    plan: &RepositoryLibrarySetupPlan,
    path: &Path,
) -> Result<CloneProvisionResult, String> {
    let inspection = safety::inspect_repository(path).map_err(|error| error.to_string())?;
    if inspection.repository.canonical_root != path
        || inspection.repository.identity == plan.source_identity
        || inspection.repository.current_branch.as_deref() != Some(plan.default_branch.as_str())
    {
        return Err("Managed repository checkout has unexpected Git identity or branch.".into());
    }
    let worktree = inspection
        .worktrees
        .iter()
        .find(|item| item.canonical_path == inspection.repository.canonical_root)
        .ok_or_else(|| "Managed repository checkout has no root worktree.".to_owned())?;
    let head = worktree
        .head
        .clone()
        .ok_or_else(|| "Managed repository checkout has no HEAD.".to_owned())?;
    if head != plan.default_branch_head {
        return Err("Managed repository checkout differs from the reviewed default branch.".into());
    }
    if worktree.clean != Some(true) {
        return Err("Managed repository base contains changes; it will not be overwritten.".into());
    }
    Ok(CloneProvisionResult {
        checkout_path: inspection.repository.canonical_root,
        checkout_identity: inspection.repository.identity,
        branch: plan.default_branch.clone(),
        head,
    })
}

fn verify_library_base(plan: &RepositoryLibrarySetupPlan) -> Result<CloneProvisionResult, String> {
    let result = verify_library_checkout(plan, &plan.base_checkout_path)?;
    let remote = git_optional_text(&plan.base_checkout_path, &["remote", "get-url", "origin"])?;
    match (plan.upstream_fetch_url.as_deref(), remote.as_deref()) {
        (Some(expected), Some(actual)) if expected == actual => Ok(result),
        (None, None) => Ok(result),
        _ => Err("Managed repository base remote differs from the reviewed repository.".into()),
    }
}

/// Maps a verified Git remote to a safe, stable host/owner/repository path.
/// Credentials are deliberately ignored. Repositories without a supported
/// remote receive a namespace derived from their verified Git identity.
pub fn repository_library_relative_path(
    remote: Option<&str>,
    repository_identity: &str,
    repository_name: &str,
) -> Result<PathBuf, String> {
    if repository_identity.is_empty() {
        return Err("repository identity is required for library placement".into());
    }
    if let Some(remote) = remote {
        let (host, owners, repository) = parse_remote_location(remote).ok_or_else(|| {
            "Repository remote cannot be mapped to a safe library path".to_owned()
        })?;
        let mut relative = PathBuf::new();
        relative.push(library_segment(&host));
        for owner in owners {
            relative.push(library_segment(&owner));
        }
        relative.push(library_segment(&repository));
        return Ok(relative);
    }
    let name = library_segment(repository_name);
    Ok(PathBuf::from("local").join(format!("{name}-{:016x}", stable_hash(repository_identity))))
}

/// Produces the managed base checkout, its Workspace-specific sibling
/// worktree, and the convenience alias inside the Workspace home. The alias
/// must never be used as the session cwd; callers use `workspace_worktree`.
pub fn repository_library_paths(
    library_root: &Path,
    workspace_home: &Path,
    relative_repository_path: &Path,
    workspace_id: &str,
) -> Result<RepositoryLibraryPaths, String> {
    if !library_root.is_absolute()
        || !workspace_home.is_absolute()
        || relative_repository_path.as_os_str().is_empty()
        || relative_repository_path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
        || workspace_id.is_empty()
        || !workspace_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err("repository library path identity is invalid".into());
    }
    let base_checkout = library_root.join(relative_repository_path);
    let repository_name = relative_repository_path
        .file_name()
        .ok_or_else(|| "repository library path has no repository name".to_owned())?;
    let worktree_area = base_checkout
        .parent()
        .ok_or_else(|| "repository library path has no parent".to_owned())?
        .join(format!("{}.worktrees", repository_name.to_string_lossy()));
    let workspace_worktree = worktree_area.join(workspace_id);
    let workspace_link = workspace_home.join("repos").join(relative_repository_path);
    Ok(RepositoryLibraryPaths {
        base_checkout,
        workspace_worktree,
        workspace_link,
    })
}

fn parse_remote_location(remote: &str) -> Option<(String, Vec<String>, String)> {
    if remote.contains(['?', '#']) {
        return None;
    }
    let (host, path) = if let Some(rest) = remote.strip_prefix("https://") {
        split_remote_authority(rest)?
    } else if let Some(rest) = remote.strip_prefix("http://") {
        split_remote_authority(rest)?
    } else if let Some(rest) = remote.strip_prefix("ssh://") {
        split_remote_authority(rest)?
    } else if let Some((user_host, path)) = remote.split_once(':') {
        let host = user_host.rsplit('@').next()?;
        (host, path)
    } else {
        return None;
    };
    let mut parts = path
        .trim_matches('/')
        .split('/')
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let mut repository = parts.pop()?;
    if repository.ends_with(".git") {
        repository.truncate(repository.len() - 4);
    }
    if parts.is_empty()
        || parts
            .iter()
            .chain(std::iter::once(&repository))
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return None;
    }
    Some((host.to_owned(), parts, repository))
}

fn split_remote_authority(value: &str) -> Option<(&str, &str)> {
    let (authority, path) = value.split_once('/')?;
    let host = authority.rsplit('@').next()?;
    if host.is_empty() {
        return None;
    }
    Some((host, path))
}

fn library_segment(value: &str) -> String {
    let mut segment = String::new();
    let mut separator = false;
    for character in value.chars() {
        if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
            if separator && !segment.is_empty() {
                segment.push('-');
            }
            segment.push(character.to_ascii_lowercase());
            separator = false;
        } else {
            separator = true;
        }
    }
    if separator && !segment.is_empty() {
        segment.push('-');
    }
    if segment.is_empty() || segment == "." || segment == ".." {
        "repository".into()
    } else {
        segment
    }
}

fn stable_hash(value: &str) -> u64 {
    value.bytes().fold(0xcbf29ce484222325_u64, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
    })
}

/// Creates or verifies the one deterministic task worktree for a workspace checkout.
pub fn provision_task_worktree(
    workspace_checkout: &Path,
    task_home: &Path,
    task_id: &str,
    repository_id: &str,
    default_branch: &str,
    expected_identity: &str,
) -> Result<TaskWorktree, String> {
    if !workspace_checkout.is_absolute()
        || !task_home.is_absolute()
        || task_id.is_empty()
        || repository_id.is_empty()
        || !task_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err("Task worktree identity or path is invalid.".into());
    }
    let token = repository_id
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let path = task_home.join("worktrees").join(token);
    let branch = format!("work/{task_id}");
    let workspace =
        safety::inspect_repository(workspace_checkout).map_err(|error| error.to_string())?;
    if workspace.repository.identity != expected_identity {
        return Err("Workspace checkout identity changed before Task worktree setup.".into());
    }
    if let Some(existing) = workspace
        .worktrees
        .iter()
        .find(|worktree| worktree.canonical_path == path)
    {
        if existing.branch.as_deref() != Some(branch.as_str()) || existing.head.is_none() {
            return Err(format!(
                "Task worktree path {} is occupied by conflicting Git state.",
                path.display()
            ));
        }
    } else {
        let branch_state = safety::inspect_branch(workspace_checkout, &branch)
            .map_err(|error| error.to_string())?;
        if branch_state.exists {
            return Err(format!(
                "Task branch {branch} already exists outside its expected worktree."
            ));
        }
        let output = Command::new("git")
            .arg("-C")
            .arg(workspace_checkout)
            .args(["worktree", "add", "-b", &branch])
            .arg(&path)
            .arg(default_branch)
            .env("GIT_LFS_SKIP_SMUDGE", "1")
            .output()
            .map_err(|error| format!("Could not start task worktree creation: {error}"))?;
        if !output.status.success() {
            return Err(format!(
                "Could not create Task worktree: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
    }
    let canonical = fs::canonicalize(&path)
        .map_err(|error| format!("Task worktree is unavailable: {error}"))?;
    let canonical_home = fs::canonicalize(task_home).map_err(|error| error.to_string())?;
    if !canonical.starts_with(canonical_home.join("worktrees")) {
        return Err("Task worktree escaped its managed directory.".into());
    }
    let inspection = safety::inspect_repository(&canonical).map_err(|error| error.to_string())?;
    if inspection.repository.identity != expected_identity
        || inspection.repository.current_branch.as_deref() != Some(branch.as_str())
    {
        return Err("Task worktree repository identity or branch does not match the plan.".into());
    }
    run_git(
        &canonical,
        &["submodule", "update", "--init", "--recursive"],
    )?;
    verify_submodules(&canonical)?;
    Ok(TaskWorktree {
        repository_id: repository_id.into(),
        branch,
        path: canonical,
        checkout_identity: expected_identity.into(),
    })
}

/// Creates or safely reuses a Workspace-specific worktree from a managed base
/// checkout, then installs the Workspace-local convenience symlink. The caller
/// must have independently populated and verified the managed base checkout.
pub fn provision_repository_library_worktree(
    plan: &RepositoryLibrarySetupPlan,
    expected_base_identity: &str,
) -> Result<TaskWorktree, String> {
    if expected_base_identity.is_empty()
        || !plan.base_checkout_path.is_absolute()
        || !plan.worktree_path.is_absolute()
        || !plan.workspace_link.is_absolute()
        || !plan.workspace_branch.starts_with("work/")
    {
        return Err("Workspace worktree plan is incomplete".into());
    }
    let base = safety::inspect_repository(&plan.base_checkout_path)
        .map_err(|error| format!("Managed repository checkout is unavailable: {error}"))?;
    if base.repository.identity != expected_base_identity
        || base.repository.current_branch.as_deref() != Some(plan.default_branch.as_str())
    {
        return Err(
            "Managed base checkout identity or branch changed before worktree setup.".into(),
        );
    }
    let base_head = git_text(&plan.base_checkout_path, &["rev-parse", "HEAD"])?;
    if base_head != plan.default_branch_head {
        return Err("Managed base checkout moved from the reviewed default-branch commit.".into());
    }

    let worktree_parent = plan
        .worktree_path
        .parent()
        .ok_or_else(|| "Workspace worktree has no parent directory.".to_owned())?;
    fs::create_dir_all(worktree_parent)
        .map_err(|error| format!("Could not create repository worktree area: {error}"))?;
    let canonical_parent = fs::canonicalize(worktree_parent)
        .map_err(|error| format!("Could not resolve repository worktree area: {error}"))?;
    if canonical_parent != worktree_parent {
        return Err("Repository worktree area resolves through an unexpected symlink.".into());
    }
    if plan.worktree_path.exists() {
        if fs::symlink_metadata(&plan.worktree_path)
            .map_err(|error| error.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("Workspace worktree path must not be a symbolic link.".into());
        }
        let existing = safety::inspect_repository(&plan.worktree_path)
            .map_err(|_| "Workspace worktree path is occupied by unrecognized data.".to_owned())?;
        if existing.repository.identity != expected_base_identity
            || existing.repository.current_branch.as_deref() != Some(plan.workspace_branch.as_str())
        {
            return Err(
                "Existing Workspace worktree has conflicting Git identity or branch.".into(),
            );
        }
    } else {
        let branch = safety::inspect_branch(&plan.base_checkout_path, &plan.workspace_branch)
            .map_err(|error| error.to_string())?;
        if branch.exists {
            return Err(format!(
                "Workspace branch {} already exists outside its expected worktree.",
                plan.workspace_branch
            ));
        }
        let output = Command::new("git")
            .arg("-C")
            .arg(&plan.base_checkout_path)
            .args(["worktree", "add", "-b", plan.workspace_branch.as_str()])
            .arg(&plan.worktree_path)
            .arg(&plan.default_branch)
            .env("GIT_LFS_SKIP_SMUDGE", "1")
            .output()
            .map_err(|error| format!("Could not start Git worktree creation: {error}"))?;
        if !output.status.success() {
            return Err(format!(
                "Could not create Workspace worktree: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
    }
    let canonical_worktree = fs::canonicalize(&plan.worktree_path)
        .map_err(|error| format!("Workspace worktree is unavailable: {error}"))?;
    if canonical_worktree != plan.worktree_path {
        return Err("Workspace worktree path resolves through an unexpected symlink.".into());
    }
    let worktree =
        safety::inspect_repository(&canonical_worktree).map_err(|error| error.to_string())?;
    if worktree.repository.identity != expected_base_identity
        || worktree.repository.current_branch.as_deref() != Some(plan.workspace_branch.as_str())
    {
        return Err("Created Workspace worktree failed identity or branch verification.".into());
    }
    run_git(
        &canonical_worktree,
        &["submodule", "update", "--init", "--recursive"],
    )?;
    verify_submodules(&canonical_worktree)?;
    ensure_workspace_repository_symlink(&plan.workspace_link, &canonical_worktree)?;
    Ok(TaskWorktree {
        repository_id: plan.repository_id.clone(),
        branch: plan.workspace_branch.clone(),
        path: canonical_worktree,
        checkout_identity: worktree.repository.identity,
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkspaceRepositoryProvisionResult {
    pub base_checkout: CloneProvisionResult,
    pub worktree: TaskWorktree,
}

/// Production orchestration boundary for one repository selected into a
/// Workspace. A verified base checkout is reusable if worktree setup fails;
/// retries verify and reuse both resources rather than cloning or branching a
/// second time.
pub fn provision_workspace_repository(
    plan: &RepositoryLibrarySetupPlan,
) -> Result<WorkspaceRepositoryProvisionResult, String> {
    let base_checkout = provision_repository_library_base(plan)?;
    let worktree = provision_repository_library_worktree(plan, &base_checkout.checkout_identity)?;
    Ok(WorkspaceRepositoryProvisionResult {
        base_checkout,
        worktree,
    })
}

fn ensure_workspace_repository_symlink(link: &Path, target: &Path) -> Result<(), String> {
    let canonical_target = fs::canonicalize(target)
        .map_err(|error| format!("Could not resolve Workspace worktree for alias: {error}"))?;
    if let Some(parent) = link.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!("Could not create Workspace repository alias parent: {error}")
        })?;
        if fs::canonicalize(parent).map_err(|error| error.to_string())? != parent {
            return Err("Workspace repository alias parent resolves through a symlink.".into());
        }
    }
    match fs::symlink_metadata(link) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            let existing = fs::canonicalize(link).map_err(|error| {
                format!("Existing Workspace repository alias is broken: {error}")
            })?;
            if existing != canonical_target {
                return Err("Workspace repository alias points to a different worktree.".into());
            }
            Ok(())
        }
        Ok(_) => Err("Workspace repository alias path is occupied by non-symlink data.".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            #[cfg(unix)]
            std::os::unix::fs::symlink(&canonical_target, link)
                .map_err(|error| format!("Could not create Workspace repository alias: {error}"))?;
            #[cfg(windows)]
            std::os::windows::fs::symlink_dir(&canonical_target, link)
                .map_err(|error| format!("Could not create Workspace repository alias: {error}"))?;
            Ok(())
        }
        Err(error) => Err(format!(
            "Could not inspect Workspace repository alias: {error}"
        )),
    }
}

/// Reads repository facts without mutating the source. Every Git argument is a
/// fixed argument or a separate value; no shell is involved.
pub fn inspect_repository_preflight(
    repository: &management::Repository,
) -> Result<RepositoryPreflight, String> {
    let source_path = std::fs::canonicalize(&repository.repository_path)
        .map_err(|error| format!("Could not resolve repository source: {error}"))?;
    let inspection = safety::inspect_repository(&source_path).map_err(|error| error.to_string())?;
    if inspection.repository.canonical_root != source_path {
        return Err("Catalog source path is not a repository root.".into());
    }
    let worktree = inspection
        .worktrees
        .iter()
        .find(|worktree| worktree.canonical_path == source_path)
        .ok_or_else(|| "Could not find the catalog source worktree.".to_owned())?;
    let head = worktree
        .head
        .clone()
        .ok_or_else(|| "Source repository has no HEAD commit.".to_owned())?;
    let default_branch = inspection.repository.default_branch.clone();
    let default_branch_head = match default_branch.as_deref() {
        Some(branch) => Some(git_text(
            &source_path,
            &["rev-parse", &format!("refs/heads/{branch}")],
        )?),
        None => None,
    };
    let upstream_fetch_url = git_optional_text(&source_path, &["remote", "get-url", "origin"])?;
    let submodules = read_submodule_facts(&source_path)?;
    Ok(RepositoryPreflight {
        repository_id: repository.id.clone(),
        name: repository.name.clone(),
        source_path,
        source_identity: inspection.repository.identity,
        head,
        default_branch,
        default_branch_head,
        // Retain this diagnostic fact for reporting/tests. Workspace setup
        // clones the reviewed Git commit and does not require a clean source
        // working tree; cleanup uses separate cleanliness checks.
        clean: worktree
            .clean
            .map(|clean| {
                clean
                    || (!worktree.status_entries.is_empty()
                        && worktree
                            .status_entries
                            .iter()
                            .all(|entry| entry.starts_with("!!")))
            })
            .unwrap_or(false),
        upstream_fetch_url,
        submodules,
    })
}

fn git_output(path: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_LFS_SKIP_SMUDGE", "1")
        .output()
        .map_err(|error| format!("Could not start Git: {error}"))
}

fn git_text(path: &Path, args: &[&str]) -> Result<String, String> {
    let output = git_output(path, args)?;
    if !output.status.success() {
        return Err(format!(
            "Git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn git_optional_text(path: &Path, args: &[&str]) -> Result<Option<String>, String> {
    let output = git_output(path, args)?;
    if output.status.success() {
        let value = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        return Ok((!value.is_empty()).then_some(value));
    }
    if output.status.code() == Some(2) || output.status.code() == Some(128) {
        return Ok(None);
    }
    Err(format!(
        "Git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr).trim()
    ))
}

fn read_submodule_facts(root: &Path) -> Result<Vec<SubmoduleFact>, String> {
    let tracked_file = git_text(root, &["ls-tree", "-z", "HEAD", "--", ".gitmodules"])?;
    if tracked_file.is_empty() {
        return Ok(Vec::new());
    }
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["config", "--blob=HEAD:.gitmodules"])
        .arg("--get-regexp")
        .arg("^submodule\\..*\\.(path|url)$")
        .output()
        .map_err(|error| format!("Could not inspect .gitmodules: {error}"))?;
    if !output.status.success() && output.status.code() != Some(1) {
        return Err(format!(
            "Could not parse .gitmodules: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let mut modules = std::collections::BTreeMap::<String, (Option<String>, Option<String>)>::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Some((key, value)) = line.split_once(' ') else {
            continue;
        };
        let Some(rest) = key.strip_prefix("submodule.") else {
            continue;
        };
        let Some((name, field)) = rest.rsplit_once('.') else {
            continue;
        };
        let entry = modules.entry(name.to_owned()).or_default();
        match field {
            "path" => entry.0 = Some(value.to_owned()),
            "url" => entry.1 = Some(value.to_owned()),
            _ => {}
        }
    }
    Ok(modules
        .into_values()
        .filter_map(|(path, url)| path.map(|path| SubmoduleFact { path, url }))
        .collect())
}

pub fn plan_workspace_setup(
    workspace_home: &Path,
    mut repositories: Vec<RepositoryPreflight>,
) -> Result<WorkspaceSetupPlan, String> {
    if !workspace_home.is_absolute() {
        return Err("Workspace home must be an absolute path.".into());
    }
    repositories.sort_by(|left, right| left.repository_id.cmp(&right.repository_id));
    let mut plans = Vec::with_capacity(repositories.len());
    let mut previous_id: Option<String> = None;
    for repository in repositories {
        if repository.repository_id.is_empty()
            || previous_id.as_deref() == Some(&repository.repository_id)
        {
            return Err(format!(
                "Repository ID {:?} is empty or duplicated.",
                repository.repository_id
            ));
        }
        previous_id = Some(repository.repository_id.clone());
        if !repository.source_path.is_absolute() || repository.source_identity.is_empty() {
            return Err(format!(
                "Repository {} has incomplete source identity.",
                repository.repository_id
            ));
        }
        let branch = repository
            .default_branch
            .filter(|branch| !branch.trim().is_empty())
            .ok_or_else(|| {
                format!(
                    "Could not determine a default branch for repository `{}`. Configure `origin/HEAD`, or create a local `main`, `master`, or other checked-out branch.",
                    repository.name
                )
            })?;
        let default_branch_head = repository
            .default_branch_head
            .filter(|head| !head.trim().is_empty())
            .ok_or_else(|| {
                format!(
                    "Repository {} has no commit on its default branch.",
                    repository.repository_id
                )
            })?;
        for submodule in &repository.submodules {
            let path = Path::new(&submodule.path);
            if submodule.path.is_empty()
                || path
                    .components()
                    .any(|component| !matches!(component, Component::Normal(_)))
            {
                return Err(format!(
                    "Repository {} has an unsafe submodule path {:?}.",
                    repository.repository_id, submodule.path
                ));
            }
        }
        // Encode the full stable ID so same-name repositories cannot collide.
        let suffix = repository
            .repository_id
            .as_bytes()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let name = safe_directory_name(&repository.name);
        let destination_path = workspace_home
            .join("repos")
            .join(format!("{name}-{suffix}"));
        plans.push(RepositorySetupPlan {
            repository_id: repository.repository_id,
            source_path: repository.source_path,
            source_identity: repository.source_identity,
            source_head: repository.head,
            default_branch: branch,
            default_branch_head,
            destination_path,
            upstream_fetch_url: repository.upstream_fetch_url,
            submodules: repository.submodules,
        });
    }
    Ok(WorkspaceSetupPlan {
        workspace_home: workspace_home.to_path_buf(),
        repositories: plans,
    })
}

pub fn reviewed_plan_is_current(
    reviewed: &WorkspaceSetupPlan,
    current: &WorkspaceSetupPlan,
) -> bool {
    reviewed == current
}

const INSTRUCTIONS_START: &str = "<!-- app-managed-workspace-repositories:start -->";
const INSTRUCTIONS_END: &str = "<!-- app-managed-workspace-repositories:end -->";

/// Replaces only the app-owned instruction block, preserving surrounding user text.
pub fn update_workspace_instructions(
    existing: Option<&str>,
    repositories: &[RepositorySetupPlan],
) -> String {
    let paths = repositories
        .iter()
        .map(|repository| {
            (
                repository.repository_id.clone(),
                repository.destination_path.clone(),
            )
        })
        .collect::<Vec<_>>();
    update_workspace_instructions_for_paths(existing, &paths)
}

pub fn update_workspace_instructions_for_paths(
    existing: Option<&str>,
    repositories: &[(String, PathBuf)],
) -> String {
    let mut content = existing.unwrap_or_default().to_owned();
    if let (Some(start), Some(end)) = (
        content.find(INSTRUCTIONS_START),
        content.find(INSTRUCTIONS_END),
    ) {
        if end >= start {
            let end = end + INSTRUCTIONS_END.len();
            content.replace_range(start..end, "");
        }
    }
    let content = content.trim().to_owned();
    if repositories.len() <= 1 {
        return if content.is_empty() {
            String::new()
        } else {
            format!("{content}\n")
        };
    }
    let mut block = String::from(INSTRUCTIONS_START);
    block.push_str("\n## Workspace repositories\n\n");
    block.push_str("Each repository below is an independent Git repository with its own Workspace worktree. Use its worker session for repository changes; the orchestrator session stays outside all repositories and coordinates work across workers.\n\n");
    for (repository_id, path) in repositories {
        block.push_str(&format!("- `{}`: `{}`\n", repository_id, path.display()));
    }
    block.push_str(INSTRUCTIONS_END);
    if content.is_empty() {
        format!("{block}\n")
    } else {
        format!("{content}\n\n{block}\n")
    }
}

pub fn write_workspace_library_instructions(
    workspace_home: &Path,
    repositories: &[(String, PathBuf)],
) -> Result<(), String> {
    let path = workspace_home.join("AGENTS.md");
    if path.exists()
        && fs::symlink_metadata(&path)
            .map_err(|error| error.to_string())?
            .file_type()
            .is_symlink()
    {
        return Err("Workspace AGENTS.md must not be a symbolic link.".into());
    }
    let existing = if path.exists() {
        Some(
            fs::read_to_string(&path)
                .map_err(|error| format!("Could not read workspace AGENTS.md: {error}"))?,
        )
    } else {
        None
    };
    let updated = update_workspace_instructions_for_paths(existing.as_deref(), repositories);
    if updated.is_empty() {
        return Ok(());
    }
    let temporary = workspace_home.join(format!(".AGENTS.md-{}.tmp", std::process::id()));
    fs::write(&temporary, updated)
        .map_err(|error| format!("Could not stage workspace instructions: {error}"))?;
    fs::rename(&temporary, &path).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!("Could not update workspace instructions: {error}")
    })
}

pub fn write_workspace_instructions(
    workspace_home: &Path,
    repositories: &[RepositorySetupPlan],
) -> Result<(), String> {
    let path = workspace_home.join("AGENTS.md");
    if path.exists()
        && fs::symlink_metadata(&path)
            .map_err(|error| error.to_string())?
            .file_type()
            .is_symlink()
    {
        return Err("Workspace AGENTS.md must not be a symbolic link.".into());
    }
    let existing = if path.exists() {
        Some(
            fs::read_to_string(&path)
                .map_err(|error| format!("Could not read workspace AGENTS.md: {error}"))?,
        )
    } else {
        None
    };
    let updated = update_workspace_instructions(existing.as_deref(), repositories);
    if updated.is_empty() {
        return Ok(());
    }
    let temporary = workspace_home.join(format!(".AGENTS.md-{}.tmp", std::process::id()));
    fs::write(&temporary, updated)
        .map_err(|error| format!("Could not stage workspace instructions: {error}"))?;
    fs::rename(&temporary, &path).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!("Could not update workspace instructions: {error}")
    })
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneProvisionResult {
    pub checkout_path: PathBuf,
    pub checkout_identity: String,
    pub branch: String,
    pub head: String,
}

pub fn clone_arguments(plan: &RepositorySetupPlan, staging_path: &Path) -> Vec<OsString> {
    [
        OsString::from("clone"),
        OsString::from("--no-hardlinks"),
        OsString::from("--recurse-submodules"),
        OsString::from("--branch"),
        OsString::from(&plan.default_branch),
        OsString::from("--"),
        plan.source_path.as_os_str().to_owned(),
        staging_path.as_os_str().to_owned(),
    ]
    .into()
}

/// Revalidates a reviewed source and creates an independent clone by staging
/// beneath `repos/` then atomically renaming it to the planned destination.
pub fn provision_independent_clone(
    repository: &management::Repository,
    plan: &RepositorySetupPlan,
    staging_path: &Path,
) -> Result<CloneProvisionResult, String> {
    let current = inspect_repository_preflight(repository)?;
    let current_plan =
        plan_workspace_setup(
            &plan.destination_path.ancestors().nth(2).ok_or_else(|| {
                "Planned repository destination has no workspace root.".to_owned()
            })?,
            vec![current],
        )?;
    if current_plan.repositories.first() != Some(plan) {
        return Err("Repository facts changed after review; prepare a fresh setup plan.".into());
    }
    let repos_root = plan
        .destination_path
        .parent()
        .ok_or_else(|| "Planned repository destination has no parent.".to_owned())?;
    let workspace_home = repos_root
        .parent()
        .ok_or_else(|| "Planned repos/ directory has no workspace home.".to_owned())?;
    if plan.destination_path.parent() != Some(repos_root)
        || staging_path.parent() != Some(repos_root)
        || staging_path == plan.destination_path
    {
        return Err("Clone staging and destination must be distinct children of repos/.".into());
    }
    if staging_path.exists()
        && fs::symlink_metadata(staging_path)
            .map_err(|error| error.to_string())?
            .file_type()
            .is_symlink()
    {
        return Err("Clone staging path must not be a symbolic link.".into());
    }
    fs::create_dir_all(repos_root).map_err(|error| format!("Could not create repos/: {error}"))?;
    let canonical_home = fs::canonicalize(workspace_home)
        .map_err(|error| format!("Could not resolve workspace home: {error}"))?;
    let canonical_repos = fs::canonicalize(repos_root)
        .map_err(|error| format!("Could not resolve workspace repos/: {error}"))?;
    if canonical_home != workspace_home
        || canonical_repos != repos_root
        || !canonical_repos.starts_with(&canonical_home)
    {
        return Err(
            "Workspace repos/ resolves through a symlink or escapes its managed home.".into(),
        );
    }
    if plan.destination_path.exists() {
        if fs::symlink_metadata(&plan.destination_path)
            .map_err(|error| error.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("Planned clone destination must not be a symbolic link.".into());
        }
        return verify_existing_clone(plan);
    }
    if staging_path.exists() {
        let staged = safety::inspect_repository(staging_path).map_err(|_| {
            format!(
                "Clone staging path is occupied by unrecognized data: {}",
                staging_path.display()
            )
        })?;
        if staged.repository.identity == plan.source_identity
            || staged.repository.current_branch.as_deref() != Some(&plan.default_branch)
        {
            return Err("Existing clone staging data does not match this reviewed setup.".into());
        }
        let head = staged
            .worktrees
            .iter()
            .find(|worktree| worktree.canonical_path == staged.repository.canonical_root)
            .and_then(|worktree| worktree.head.as_deref());
        if head != Some(plan.default_branch_head.as_str()) {
            return Err(
                "Existing clone staging data is not at the reviewed default-branch commit.".into(),
            );
        }
        run_git(
            staging_path,
            &["submodule", "update", "--init", "--recursive"],
        )?;
    } else {
        let args = clone_arguments(plan, staging_path);
        let output = Command::new("git")
            .args(&args)
            .env("GIT_LFS_SKIP_SMUDGE", "1")
            .output()
            .map_err(|error| format!("Could not start Git clone: {error}"))?;
        if !output.status.success() {
            return Err(format!(
                "Git clone failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
    }
    configure_clone_remote(staging_path, plan)?;
    verify_submodules(staging_path)?;
    verify_no_object_alternates(staging_path)?;
    let inspection = safety::inspect_repository(staging_path).map_err(|error| error.to_string())?;
    if inspection.repository.identity == plan.source_identity {
        return Err("Clone unexpectedly shares Git identity with its source.".into());
    }
    if inspection.repository.current_branch.as_deref() != Some(&plan.default_branch) {
        return Err("Clone did not check out the reviewed default branch.".into());
    }
    let head = inspection
        .worktrees
        .iter()
        .find(|worktree| worktree.canonical_path == inspection.repository.canonical_root)
        .and_then(|worktree| worktree.head.clone())
        .ok_or_else(|| "Could not verify clone HEAD.".to_owned())?;
    if head != plan.default_branch_head {
        return Err("Default branch HEAD changed or clone is at an unexpected commit.".into());
    }
    fs::rename(staging_path, &plan.destination_path)
        .map_err(|error| format!("Could not finalize the verified clone: {error}"))?;
    let final_inspection =
        safety::inspect_repository(&plan.destination_path).map_err(|error| error.to_string())?;
    Ok(CloneProvisionResult {
        checkout_path: final_inspection.repository.canonical_root,
        checkout_identity: final_inspection.repository.identity,
        branch: plan.default_branch.clone(),
        head,
    })
}

fn verify_existing_clone(plan: &RepositorySetupPlan) -> Result<CloneProvisionResult, String> {
    let inspection =
        safety::inspect_repository(&plan.destination_path).map_err(|error| error.to_string())?;
    if inspection.repository.identity == plan.source_identity
        || inspection.repository.current_branch.as_deref() != Some(&plan.default_branch)
    {
        return Err("Existing destination is not the expected independent workspace clone.".into());
    }
    let head = inspection
        .worktrees
        .iter()
        .find(|worktree| worktree.canonical_path == inspection.repository.canonical_root)
        .and_then(|worktree| worktree.head.clone())
        .ok_or_else(|| "Could not verify existing clone HEAD.".to_owned())?;
    if head != plan.default_branch_head {
        return Err("Existing clone differs from the reviewed default-branch commit.".into());
    }
    verify_no_object_alternates(&inspection.repository.canonical_root)?;
    verify_submodules(&inspection.repository.canonical_root)?;
    match (
        &plan.upstream_fetch_url,
        git_optional_text(
            &inspection.repository.canonical_root,
            &["remote", "get-url", "origin"],
        )?,
    ) {
        (Some(expected), Some(actual)) if expected == &actual => {}
        (None, None) => {}
        _ => {
            return Err(
                "Existing clone remote differs from the reviewed upstream configuration.".into(),
            )
        }
    }
    Ok(CloneProvisionResult {
        checkout_path: inspection.repository.canonical_root,
        checkout_identity: inspection.repository.identity,
        branch: plan.default_branch.clone(),
        head,
    })
}

fn configure_clone_remote(staging: &Path, plan: &RepositorySetupPlan) -> Result<(), String> {
    match &plan.upstream_fetch_url {
        Some(url) => {
            run_git(staging, &["remote", "set-url", "origin", url])?;
            run_git(staging, &["remote", "set-url", "--push", "origin", url])?;
        }
        None => {
            let output = git_output(staging, &["remote", "remove", "origin"])?;
            if !output.status.success() {
                return Err(format!(
                    "Could not remove clone's local source remote: {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                ));
            }
        }
    }
    Ok(())
}

fn verify_submodules(root: &Path) -> Result<(), String> {
    let canonical_root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    verify_submodules_recursive(&canonical_root, &canonical_root, 0)
}

fn verify_submodules_recursive(
    repository_root: &Path,
    workspace_root: &Path,
    depth: usize,
) -> Result<(), String> {
    if depth > 32 {
        return Err("Submodule nesting exceeds the verification limit.".into());
    }
    for module in read_submodule_facts(repository_root)? {
        let relative = Path::new(&module.path);
        if module.path.is_empty()
            || relative
                .components()
                .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err(format!(
                "Submodule path escapes its repository: {}",
                module.path
            ));
        }
        let gitlink = git_output(
            repository_root,
            &[
                "--literal-pathspecs",
                "ls-tree",
                "-z",
                "HEAD",
                "--",
                &module.path,
            ],
        )?;
        if !gitlink.status.success() {
            return Err(format!(
                "Could not inspect pinned submodule {}.",
                module.path
            ));
        }
        let record = gitlink
            .stdout
            .split(|byte| *byte == 0)
            .find(|record| !record.is_empty())
            .ok_or_else(|| {
                format!(
                    "Submodule {} is not present in the committed tree.",
                    module.path
                )
            })?;
        let metadata = record
            .split(|byte| *byte == b'\t')
            .next()
            .unwrap_or_default();
        let fields = metadata
            .split(|byte| byte.is_ascii_whitespace())
            .filter(|field| !field.is_empty())
            .collect::<Vec<_>>();
        if fields.len() != 3 || fields[0] != b"160000" || fields[1] != b"commit" {
            return Err(format!(
                "Path {} is not a committed submodule gitlink.",
                module.path
            ));
        }
        let expected_head = std::str::from_utf8(fields[2])
            .map_err(|_| format!("Submodule {} has a malformed gitlink commit.", module.path))?;
        let submodule_path = repository_root.join(relative);
        let canonical = fs::canonicalize(&submodule_path)
            .map_err(|error| format!("Submodule path {} is unavailable: {error}", module.path))?;
        if !canonical.starts_with(repository_root) || !canonical.starts_with(workspace_root) {
            return Err(format!(
                "Submodule path escapes its repository: {}",
                module.path
            ));
        }
        let actual_head = git_text(&canonical, &["rev-parse", "HEAD"])?;
        if actual_head != expected_head {
            return Err(format!(
                "Submodule {} is not at its pinned commit.",
                module.path
            ));
        }
        verify_submodules_recursive(&canonical, workspace_root, depth + 1)?;
    }
    Ok(())
}

fn verify_no_object_alternates(root: &Path) -> Result<(), String> {
    let git_dir_text = git_text(root, &["rev-parse", "--absolute-git-dir"])?;
    let alternates = Path::new(&git_dir_text).join("objects/info/alternates");
    if alternates.exists() {
        return Err("Clone depends on an external Git object alternate.".into());
    }
    Ok(())
}

fn run_git(root: &Path, args: &[&str]) -> Result<(), String> {
    let output = git_output(root, args)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "Git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

fn safe_directory_name(name: &str) -> String {
    let mut result = String::new();
    let mut separator = false;
    for character in name.chars() {
        if character.is_ascii_alphanumeric() {
            if separator && !result.is_empty() {
                result.push('-');
            }
            result.push(character.to_ascii_lowercase());
            separator = false;
        } else {
            separator = true;
        }
    }
    if result.is_empty() {
        "repository".into()
    } else {
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn repository(id: &str, name: &str) -> RepositoryPreflight {
        RepositoryPreflight {
            repository_id: id.into(),
            name: name.into(),
            source_path: PathBuf::from(format!("/sources/{id}")),
            source_identity: format!("git-common-dir:/sources/{id}/.git"),
            head: format!("head-{id}"),
            default_branch: Some("main".into()),
            default_branch_head: Some(format!("default-head-{id}")),
            clean: true,
            upstream_fetch_url: Some(format!("https://example.invalid/org/{id}.git")),
            submodules: vec![SubmoduleFact {
                path: "vendor/lib".into(),
                url: Some("../lib.git".into()),
            }],
        }
    }

    #[test]
    fn repository_library_paths_are_remote_grouped_workspace_specific_and_safe() {
        let relative = repository_library_relative_path(
            Some("https://token:secret@GitHub.com/Acme/tools.git"),
            "verified-identity",
            "Tools",
        )
        .unwrap();
        assert_eq!(relative, PathBuf::from("github-com/acme/tools"));
        assert!(!relative.to_string_lossy().contains("secret"));

        let scp = repository_library_relative_path(
            Some("git@gitlab.example:group/subgroup/repo.git"),
            "another-identity",
            "repo",
        )
        .unwrap();
        assert_eq!(scp, PathBuf::from("gitlab-example/group/subgroup/repo"));
        let local_a = repository_library_relative_path(None, "local:/repo/.git", "Repo").unwrap();
        let local_b = repository_library_relative_path(None, "local:/repo/.git", "Repo").unwrap();
        assert_eq!(local_a, local_b);
        assert!(local_a.starts_with("local"));
        assert!(repository_library_relative_path(
            Some("https://host-without-owner.example/repo.git"),
            "identity",
            "repo"
        )
        .is_err());

        let paths = repository_library_paths(
            Path::new("/library"),
            Path::new("/workspaces/example"),
            &relative,
            "ws-123",
        )
        .unwrap();
        assert_eq!(
            paths.base_checkout,
            PathBuf::from("/library/github-com/acme/tools")
        );
        assert_eq!(
            paths.workspace_worktree,
            PathBuf::from("/library/github-com/acme/tools.worktrees/ws-123")
        );
        assert_eq!(
            paths.workspace_link,
            PathBuf::from("/workspaces/example/repos/github-com/acme/tools")
        );
        assert!(repository_library_paths(
            Path::new("/library"),
            Path::new("/workspaces/example"),
            Path::new("../escape"),
            "ws-123"
        )
        .is_err());

        let setup = plan_repository_library_setup(
            Path::new("/library"),
            Path::new("/workspaces/ws-123"),
            "ws-123",
            &repository("repo-1", "repo-1"),
        )
        .unwrap();
        assert_eq!(setup.repository_id, "repo-1");
        assert_eq!(setup.workspace_branch, "work/ws-123");
        assert_eq!(
            setup.base_checkout_path,
            PathBuf::from("/library/example-invalid/org/repo-1")
        );
        assert_eq!(
            setup.worktree_path.parent().unwrap(),
            setup.base_checkout_path.parent().unwrap().join(format!(
                "{}.worktrees",
                setup
                    .base_checkout_path
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
            ))
        );
        assert_eq!(setup.worktree_path.file_name().unwrap(), "ws-123");
        let mut new_root_plan = plan_repository_library_setup(
            Path::new("/new-library"),
            Path::new("/workspaces/ws-123"),
            "ws-123",
            &repository("repo-1", "repo-1"),
        )
        .unwrap();
        let recorded = management::WorkspaceRepositoryWorktree {
            workspace_id: "ws-123".into(),
            repository_id: "repo-1".into(),
            source_identity: setup.source_identity.clone(),
            checkout_identity: None,
            branch: setup.workspace_branch.clone(),
            base_checkout_path: setup.base_checkout_path.to_string_lossy().into_owned(),
            worktree_path: setup.worktree_path.to_string_lossy().into_owned(),
            workspace_link: setup.workspace_link.to_string_lossy().into_owned(),
            setup_status: management::WorkspaceWorktreeStatus::Failed,
            error_code: Some("provision_failed".into()),
            error_detail: Some("retry fixture".into()),
            created_at: 1,
            updated_at: 1,
        };
        use_recorded_workspace_repository_paths(&mut new_root_plan, &recorded).unwrap();
        assert_eq!(new_root_plan.base_checkout_path, setup.base_checkout_path);
        assert_eq!(new_root_plan.worktree_path, setup.worktree_path);
        assert_eq!(new_root_plan.workspace_link, setup.workspace_link);
        assert!(plan_repository_library_setup(
            Path::new("/sources"),
            Path::new("/workspaces/ws-123"),
            "ws-123",
            &repository("repo-1", "repo-1"),
        )
        .unwrap_err()
        .contains("must be separate"));
        assert!(plan_repository_library_setup(
            Path::new("/library"),
            Path::new("/library/workspaces/ws-123"),
            "ws-123",
            &repository("repo-1", "repo-1"),
        )
        .unwrap_err()
        .contains("must be separate"));
    }

    #[test]
    fn repository_library_worktree_is_real_repo_root_and_workspace_alias_is_recoverable() {
        let temp = tempfile::tempdir().unwrap();
        let store = management::ManagementStore::in_memory_with_paths(
            temp.path().join("home"),
            temp.path().join("system-temp"),
        )
        .unwrap();
        let workspace = store
            .create_workspace(&management::NewWorkspace {
                id: "ws-library".into(),
                name: "Library Workspace".into(),
                slug: "ws-library".into(),
                description: None,
                kind: management::WorkspaceKind::Regular,
                created_at: 1,
            })
            .unwrap();
        let source = temp.path().join("source");
        std::fs::create_dir_all(&source).unwrap();
        let run = |directory: &Path, args: &[&str]| {
            let output = Command::new("git")
                .arg("-C")
                .arg(directory)
                .args(args)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        let init = Command::new("git")
            .args(["init", "--quiet", "--initial-branch=main"])
            .arg(&source)
            .output()
            .unwrap();
        assert!(init.status.success());
        run(&source, &["config", "user.name", "fixture"]);
        run(
            &source,
            &["config", "user.email", "fixture@example.invalid"],
        );
        std::fs::write(source.join("AGENTS.md"), "repo instructions\n").unwrap();
        run(&source, &["add", "AGENTS.md"]);
        run(&source, &["commit", "--quiet", "-m", "initial"]);

        let source_facts = safety::inspect_repository(&source).unwrap();
        let record = management::Repository {
            id: "repo-library-test".into(),
            name: "Repo Library Test".into(),
            repository_path: source.to_string_lossy().into_owned(),
            repository_identity: source_facts.repository.identity,
            purpose: None,
            purpose_status: management::PurposeStatus::Unavailable,
            created_at: 1,
            updated_at: 1,
        };
        store
            .catalog_selected_repository(&record.id, &record.name, &source, None, 1)
            .unwrap();
        let facts = inspect_repository_preflight(&record).unwrap();
        assert!(facts.clean);
        let workspace_home = PathBuf::from(&workspace.home_path);
        let library_root = temp.path().join("library");
        let plan =
            plan_repository_library_setup(&library_root, &workspace_home, "ws-library", &facts)
                .unwrap();
        // A user edit after review must not block setup or be copied into the
        // managed base/worktree.
        std::fs::write(source.join("AGENTS.md"), "uncommitted user changes\n").unwrap();
        std::fs::write(source.join("local-note.txt"), "untracked user data\n").unwrap();
        let provisioned = provision_workspace_repository(&plan).unwrap();
        let base = provisioned.base_checkout;
        let worktree = provisioned.worktree;
        assert_eq!(base.checkout_path, plan.base_checkout_path);
        assert_eq!(worktree.path, plan.worktree_path);
        assert_eq!(
            std::fs::canonicalize(&plan.workspace_link).unwrap(),
            worktree.path
        );
        assert!(worktree.path.join("AGENTS.md").is_file());
        assert_eq!(
            std::fs::read_to_string(worktree.path.join("AGENTS.md")).unwrap(),
            "repo instructions\n",
            "the Workspace worktree must use committed content, not dirty source files"
        );
        assert!(!worktree.path.join("local-note.txt").exists());
        assert_eq!(
            std::fs::read_to_string(source.join("AGENTS.md")).unwrap(),
            "uncommitted user changes\n"
        );
        assert_eq!(
            std::fs::read_to_string(source.join("local-note.txt")).unwrap(),
            "untracked user data\n"
        );
        assert_eq!(
            safety::inspect_repository(&source)
                .unwrap()
                .repository
                .current_branch
                .as_deref(),
            Some("main")
        );

        let mut changed_root_plan = plan_repository_library_setup(
            &temp.path().join("new-library"),
            &workspace_home,
            "ws-library",
            &facts,
        )
        .unwrap();
        let saved_paths = management::WorkspaceRepositoryWorktree {
            workspace_id: "ws-library".into(),
            repository_id: record.id.clone(),
            source_identity: plan.source_identity.clone(),
            checkout_identity: Some(worktree.checkout_identity.clone()),
            branch: plan.workspace_branch.clone(),
            base_checkout_path: plan.base_checkout_path.to_string_lossy().into_owned(),
            worktree_path: plan.worktree_path.to_string_lossy().into_owned(),
            workspace_link: plan.workspace_link.to_string_lossy().into_owned(),
            setup_status: management::WorkspaceWorktreeStatus::Ready,
            error_code: None,
            error_detail: None,
            created_at: 1,
            updated_at: 1,
        };
        store
            .save_workspace_repository_worktree(&saved_paths)
            .unwrap();
        store
            .validate_and_save_workspace_repository_binding(
                &management::WorkspaceRepositoryBinding {
                    workspace_id: workspace.id.clone(),
                    repository_id: record.id.clone(),
                    checkout_path: worktree.path.to_string_lossy().into_owned(),
                    checkout_mode: management::CheckoutMode::Clone,
                    branch: worktree.branch.clone(),
                    verification_status: management::VerificationStatus::Verified,
                    created_at: 1,
                },
            )
            .unwrap();
        let binding = store
            .list_workspace_repository_bindings(&workspace.id)
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(binding.checkout_path, worktree.path.to_string_lossy());
        assert!(!Path::new(&binding.checkout_path).starts_with(&workspace_home.join("repos")));
        assert_eq!(
            std::fs::canonicalize(&plan.workspace_link).unwrap(),
            worktree.path
        );
        use_recorded_workspace_repository_paths(&mut changed_root_plan, &saved_paths).unwrap();
        let reused = verify_recorded_workspace_repository(
            &changed_root_plan,
            worktree.checkout_identity.as_str(),
        )
        .unwrap();
        assert_eq!(reused.worktree, worktree);
        assert_eq!(reused.base_checkout, base);

        assert_eq!(
            provision_workspace_repository(&plan).unwrap().worktree,
            worktree
        );
        std::fs::write(source.join("AGENTS.md"), "changed again after review\n").unwrap();
        assert!(provision_repository_library_base(&plan).is_ok());
        assert!(plan.base_checkout_path.join("AGENTS.md").is_file());
        assert!(plan.worktree_path.join("AGENTS.md").is_file());
        run(&source, &["add", "AGENTS.md"]);
        run(
            &source,
            &["commit", "--quiet", "-m", "source commit changed"],
        );
        assert!(provision_repository_library_base(&plan)
            .unwrap_err()
            .contains("source commit changed after review"));
    }

    #[test]
    fn paths_are_safe_stable_and_independent_of_selection_order() {
        let home = Path::new("/projects/workspace");
        let first = plan_workspace_setup(
            home,
            vec![
                repository("repo-2", "My Repo!"),
                repository("repo-1", "My Repo!"),
            ],
        )
        .unwrap();
        let second = plan_workspace_setup(
            home,
            vec![
                repository("repo-1", "My Repo!"),
                repository("repo-2", "My Repo!"),
            ],
        )
        .unwrap();
        assert_eq!(first, second);
        assert_eq!(first.repositories[0].repository_id, "repo-1");
        assert_eq!(
            first.repositories[0].destination_path,
            Path::new("/projects/workspace/repos/my-repo-7265706f2d31")
        );
        assert_ne!(
            first.repositories[0].destination_path,
            first.repositories[1].destination_path
        );
    }

    #[test]
    fn accepts_dirty_sources_but_rejects_missing_default_branches_and_duplicate_ids() {
        let home = Path::new("/projects/workspace");
        let mut dirty = repository("repo-1", "Repo");
        dirty.clean = false;
        dirty.source_path = PathBuf::from("/sources/my-repo");
        assert_eq!(
            plan_workspace_setup(home, vec![dirty])
                .unwrap()
                .repositories
                .len(),
            1
        );
        let mut unknown_default = repository("repo-1", "Repo");
        unknown_default.default_branch = None;
        assert!(plan_workspace_setup(home, vec![unknown_default])
            .unwrap_err()
            .contains("default branch"));
        assert!(plan_workspace_setup(
            home,
            vec![repository("repo-1", "One"), repository("repo-1", "Two")]
        )
        .unwrap_err()
        .contains("duplicated"));
    }

    #[test]
    fn preflight_facts_include_submodules_and_review_detects_changed_facts() {
        let home = Path::new("/projects/workspace");
        let reviewed = plan_workspace_setup(home, vec![repository("repo-1", "Repo")]).unwrap();
        let current = plan_workspace_setup(home, vec![repository("repo-1", "Repo")]).unwrap();
        assert!(reviewed_plan_is_current(&reviewed, &current));
        let mutations: [fn(&mut RepositoryPreflight); 5] = [
            |facts| facts.head = "new-head".into(),
            |facts| facts.source_identity = "changed-identity".into(),
            |facts| facts.default_branch = Some("trunk".into()),
            |facts| facts.upstream_fetch_url = Some("https://example.invalid/changed.git".into()),
            |facts| facts.submodules[0].url = Some("../changed.git".into()),
        ];
        for mutate in mutations {
            let mut facts = repository("repo-1", "Repo");
            mutate(&mut facts);
            let changed = plan_workspace_setup(home, vec![facts]).unwrap();
            assert!(!reviewed_plan_is_current(&reviewed, &changed));
        }
        let mut dirty_only = repository("repo-1", "Repo");
        dirty_only.clean = false;
        let dirty_plan = plan_workspace_setup(home, vec![dirty_only]).unwrap();
        assert!(reviewed_plan_is_current(&reviewed, &dirty_plan));
        assert_eq!(reviewed.repositories[0].submodules[0].path, "vendor/lib");
    }

    #[test]
    fn workspace_instruction_block_is_deterministic_and_preserves_user_content() {
        let plans = plan_workspace_setup(
            Path::new("/projects/workspace"),
            vec![repository("repo-2", "Two"), repository("repo-1", "One")],
        )
        .unwrap();
        let first = update_workspace_instructions(Some("User guidance."), &plans.repositories);
        assert!(first.starts_with("User guidance.\n\n"));
        assert!(first.contains("orchestrator session stays outside all repositories"));
        let second = update_workspace_instructions(Some(&first), &plans.repositories);
        assert_eq!(first, second);
        assert_eq!(
            update_workspace_instructions(Some(&first), &[]),
            "User guidance.\n"
        );
        assert_eq!(
            update_workspace_instructions(None, &plans.repositories[..1]),
            ""
        );
    }

    #[test]
    fn rejects_relative_source_and_unsafe_submodule_paths() {
        let mut relative = repository("repo-1", "Repo");
        relative.source_path = PathBuf::from("relative/repo");
        assert!(plan_workspace_setup(Path::new("/workspace"), vec![relative]).is_err());
        let mut escaping = repository("repo-1", "Repo");
        escaping.submodules[0].path = "../outside".into();
        assert!(plan_workspace_setup(Path::new("/workspace"), vec![escaping]).is_err());
    }

    #[test]
    fn repository_preflight_reports_cleanliness_head_default_remote_and_submodule_metadata() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source");
        std::fs::create_dir_all(&source).unwrap();
        let init = Command::new("git")
            .args(["init", "--quiet", "--initial-branch=main"])
            .arg(&source)
            .output()
            .unwrap();
        assert!(init.status.success());
        std::fs::write(source.join("README.md"), "fixture\n").unwrap();
        std::fs::write(source.join(".gitignore"), "ignored-cache/\n").unwrap();
        std::fs::write(
            source.join(".gitmodules"),
            "[submodule \"lib\"]\n\tpath = vendor/lib\n\turl = ../lib.git\n",
        )
        .unwrap();
        let commit = Command::new("git")
            .arg("-C")
            .arg(&source)
            .args([
                "-c",
                "user.name=fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "add",
                ".",
            ])
            .output()
            .unwrap();
        assert!(commit.status.success());
        let commit = Command::new("git")
            .arg("-C")
            .arg(&source)
            .args([
                "-c",
                "user.name=fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "--quiet",
                "-m",
                "fixture",
            ])
            .output()
            .unwrap();
        assert!(commit.status.success());
        std::fs::write(
            source.join(".gitmodules"),
            "[submodule \"lib\"]\n\tpath = vendor/dirty-lib\n\turl = ../dirty.git\n",
        )
        .unwrap();
        let symref = Command::new("git")
            .arg("-C")
            .arg(&source)
            .args([
                "symbolic-ref",
                "refs/remotes/origin/HEAD",
                "refs/remotes/origin/main",
            ])
            .output()
            .unwrap();
        assert!(symref.status.success());
        let record = management::Repository {
            id: "repo-preflight".into(),
            name: "Fixture Repo".into(),
            repository_path: source.to_string_lossy().into(),
            repository_identity: String::new(),
            purpose: None,
            purpose_status: management::PurposeStatus::Unavailable,
            created_at: 1,
            updated_at: 1,
        };
        let facts = inspect_repository_preflight(&record).unwrap();
        assert!(!facts.clean);
        assert_eq!(facts.default_branch.as_deref(), Some("main"));
        assert_eq!(facts.head, facts.default_branch_head.clone().unwrap());
        assert_eq!(
            facts.submodules,
            vec![SubmoduleFact {
                path: "vendor/lib".into(),
                url: Some("../lib.git".into())
            }]
        );
        assert_eq!(facts.upstream_fetch_url, None);
        std::fs::create_dir_all(source.join("ignored-cache")).unwrap();
        std::fs::write(source.join("ignored-cache/generated"), "ignored\n").unwrap();
        assert!(!inspect_repository_preflight(&record).unwrap().clean);
        std::fs::write(source.join("README.md"), "changed\n").unwrap();
        assert!(!inspect_repository_preflight(&record).unwrap().clean);
    }

    #[test]
    fn recursive_submodule_verification_checks_relative_url_gitlinks_and_pinned_heads() {
        fn run(path: &Path, args: &[&str]) -> std::process::Output {
            let output = Command::new("git")
                .arg("-C")
                .arg(path)
                .args(args)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "git {args:?} failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            output
        }
        fn init_repo(path: &Path, file: &str) {
            std::fs::create_dir_all(path).unwrap();
            let output = Command::new("git")
                .args(["init", "--quiet", "--initial-branch=main"])
                .arg(path)
                .output()
                .unwrap();
            assert!(output.status.success());
            std::fs::write(path.join(file), "first\n").unwrap();
            run(path, &["add", file]);
            run(
                path,
                &[
                    "-c",
                    "user.name=fixture",
                    "-c",
                    "user.email=fixture@example.invalid",
                    "commit",
                    "--quiet",
                    "-m",
                    "first",
                ],
            );
        }

        let fixture = tempfile::tempdir().unwrap();
        let lib_work = fixture.path().join("lib-work");
        init_repo(&lib_work, "LIB.md");
        let lib_bare = fixture.path().join("lib.git");
        let output = Command::new("git")
            .args(["clone", "--quiet", "--bare"])
            .arg(&lib_work)
            .arg(&lib_bare)
            .output()
            .unwrap();
        assert!(output.status.success());

        let parent = fixture.path().join("parent");
        init_repo(&parent, "README.md");
        let parent_bare = fixture.path().join("parent.git");
        let output = Command::new("git")
            .args(["clone", "--quiet", "--bare"])
            .arg(&parent)
            .arg(&parent_bare)
            .output()
            .unwrap();
        assert!(output.status.success());
        run(
            &parent,
            &["remote", "add", "origin", parent_bare.to_str().unwrap()],
        );
        run(&parent, &["fetch", "--quiet", "origin", "main"]);
        run(
            &parent,
            &[
                "symbolic-ref",
                "refs/remotes/origin/HEAD",
                "refs/remotes/origin/main",
            ],
        );
        let output = Command::new("git")
            .arg("-C")
            .arg(&parent)
            .args([
                "-c",
                "protocol.file.allow=always",
                "submodule",
                "add",
                "../lib.git",
                "vendor/lib",
            ])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "submodule add failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        run(&parent, &["add", ".gitmodules", "vendor/lib"]);
        run(
            &parent,
            &[
                "-c",
                "user.name=fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "--quiet",
                "-m",
                "add submodule",
            ],
        );
        assert_eq!(
            read_submodule_facts(&parent).unwrap()[0].url.as_deref(),
            Some("../lib.git")
        );
        verify_submodules(&parent).unwrap();

        std::fs::write(lib_work.join("LIB.md"), "second\n").unwrap();
        run(&lib_work, &["add", "LIB.md"]);
        run(
            &lib_work,
            &[
                "-c",
                "user.name=fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "--quiet",
                "-m",
                "second",
            ],
        );
        run(
            &lib_work,
            &["push", "--quiet", lib_bare.to_str().unwrap(), "main"],
        );
        run(&parent.join("vendor/lib"), &["fetch", "--quiet", "origin"]);
        run(
            &parent.join("vendor/lib"),
            &["checkout", "--quiet", "origin/main"],
        );
        assert!(verify_submodules(&parent)
            .unwrap_err()
            .contains("pinned commit"));
    }

    #[test]
    fn real_clone_is_independent_uses_default_branch_and_does_not_mutate_source() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source");
        std::fs::create_dir_all(&source).unwrap();
        let output = Command::new("git")
            .args(["init", "--quiet", "--initial-branch=main"])
            .arg(&source)
            .output()
            .unwrap();
        assert!(output.status.success());
        std::fs::write(source.join("README.md"), "original\n").unwrap();
        let output = Command::new("git")
            .arg("-C")
            .arg(&source)
            .args([
                "-c",
                "user.name=fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "add",
                ".",
            ])
            .output()
            .unwrap();
        assert!(output.status.success());
        let output = Command::new("git")
            .arg("-C")
            .arg(&source)
            .args([
                "-c",
                "user.name=fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "--quiet",
                "-m",
                "fixture",
            ])
            .output()
            .unwrap();
        assert!(output.status.success());
        let bare = root.path().join("upstream.git");
        let output = Command::new("git")
            .args(["clone", "--quiet", "--bare"])
            .arg(&source)
            .arg(&bare)
            .output()
            .unwrap();
        assert!(output.status.success());
        let output = Command::new("git")
            .arg("-C")
            .arg(&source)
            .args(["remote", "add", "origin"])
            .arg(&bare)
            .output()
            .unwrap();
        assert!(output.status.success());
        let output = Command::new("git")
            .arg("-C")
            .arg(&source)
            .args(["fetch", "--quiet", "origin", "main"])
            .output()
            .unwrap();
        assert!(output.status.success());
        let output = Command::new("git")
            .arg("-C")
            .arg(&source)
            .args([
                "symbolic-ref",
                "refs/remotes/origin/HEAD",
                "refs/remotes/origin/main",
            ])
            .output()
            .unwrap();
        assert!(output.status.success());
        let record = management::Repository {
            id: "repo-clone-test".into(),
            name: "Clone Test".into(),
            repository_path: source.to_string_lossy().into(),
            repository_identity: String::new(),
            purpose: None,
            purpose_status: management::PurposeStatus::Unavailable,
            created_at: 1,
            updated_at: 1,
        };
        let facts = inspect_repository_preflight(&record).unwrap();
        let home = root.path().join("workspace");
        let plan = plan_workspace_setup(&home, vec![facts])
            .unwrap()
            .repositories
            .remove(0);
        let repos = home.join("repos");
        std::fs::create_dir_all(&repos).unwrap();
        let staging = repos.join(".staging-clone-test");
        let args = clone_arguments(&plan, &staging);
        assert_eq!(
            args[0..5],
            [
                "clone",
                "--no-hardlinks",
                "--recurse-submodules",
                "--branch",
                "main"
            ]
            .map(OsString::from)
        );
        let result = provision_independent_clone(&record, &plan, &staging).unwrap();
        assert_eq!(result.checkout_path, plan.destination_path);
        assert_ne!(result.checkout_identity, plan.source_identity);
        assert_eq!(result.head, plan.default_branch_head);
        assert_eq!(
            git_text(&result.checkout_path, &["remote", "get-url", "origin"]).unwrap(),
            bare.to_string_lossy()
        );
        assert_eq!(
            git_text(&source, &["remote", "get-url", "origin"]).unwrap(),
            bare.to_string_lossy()
        );
        let retry = provision_independent_clone(&record, &plan, &staging).unwrap();
        assert_eq!(retry, result);
        let user_file = plan.destination_path.join("user-work.txt");
        std::fs::write(&user_file, "preserve me").unwrap();
        let retry_with_user_file = provision_independent_clone(&record, &plan, &staging).unwrap();
        assert_eq!(retry_with_user_file, result);
        assert_eq!(std::fs::read_to_string(user_file).unwrap(), "preserve me");
        let removed = Command::new("git")
            .arg("-C")
            .arg(&source)
            .args(["remote", "remove", "origin"])
            .output()
            .unwrap();
        assert!(removed.status.success());
        let tracking = Command::new("git")
            .arg("-C")
            .arg(&source)
            .args(["update-ref", "refs/remotes/origin/main", "HEAD"])
            .output()
            .unwrap();
        assert!(tracking.status.success());
        let tracking_head = Command::new("git")
            .arg("-C")
            .arg(&source)
            .args([
                "symbolic-ref",
                "refs/remotes/origin/HEAD",
                "refs/remotes/origin/main",
            ])
            .output()
            .unwrap();
        assert!(tracking_head.status.success());
        let second_home = root.path().join("second-workspace");
        let second_plan = plan_workspace_setup(
            &second_home,
            vec![inspect_repository_preflight(&record).unwrap()],
        )
        .unwrap()
        .repositories
        .remove(0);
        assert_eq!(second_plan.upstream_fetch_url, None);
        let second_staging = second_home.join("repos/.staging-clone-test");
        let second_result =
            provision_independent_clone(&record, &second_plan, &second_staging).unwrap();
        assert_ne!(second_result.checkout_identity, result.checkout_identity);
        assert_eq!(second_result.head, result.head);
        assert!(git_optional_text(
            &second_result.checkout_path,
            &["remote", "get-url", "origin"]
        )
        .unwrap()
        .is_none());
        let task_home = root.path().join("task-home");
        std::fs::create_dir_all(task_home.join("worktrees")).unwrap();
        let task_worktree = provision_task_worktree(
            &second_result.checkout_path,
            &task_home,
            "task-fixture",
            &record.id,
            "main",
            &second_result.checkout_identity,
        )
        .unwrap();
        assert_eq!(task_worktree.branch, "work/task-fixture");
        assert_eq!(
            task_worktree.path.parent(),
            Some(task_home.join("worktrees").as_path())
        );
        assert_eq!(
            provision_task_worktree(
                &second_result.checkout_path,
                &task_home,
                "task-fixture",
                &record.id,
                "main",
                &second_result.checkout_identity,
            )
            .unwrap(),
            task_worktree
        );
        assert!(!staging.exists());
        assert!(plan.destination_path.exists());
    }
}
