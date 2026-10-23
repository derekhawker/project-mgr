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
        // Ignored build/cache output does not make a source checkout unsuitable
        // for cloning. Keep the broader safety status intact for cleanup, where
        // ignored files must still prevent deleting a worktree that contains them.
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
    let file = root.join(".gitmodules");
    if !file.exists() {
        return Ok(Vec::new());
    }
    let output = Command::new("git")
        .args(["config", "--file"])
        .arg(&file)
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
        if !repository.clean {
            return Err(format!(
                "Repository `{}` at `{}` has uncommitted changes.",
                repository.name,
                repository.source_path.display()
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
    block.push_str("Each repository below is an independent checkout. Each Task creates a separate OpenCode session rooted in that repository's task worktree. Keep repository changes in that repository's session; do not edit another repository from a different session.\n\n");
    for repository in repositories {
        block.push_str(&format!(
            "- `{}`: `{}`\n",
            repository.repository_id,
            repository.destination_path.display()
        ));
    }
    block.push_str(INSTRUCTIONS_END);
    if content.is_empty() {
        format!("{block}\n")
    } else {
        format!("{content}\n\n{block}\n")
    }
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
            upstream_fetch_url: Some(format!("https://example.invalid/{id}.git")),
            submodules: vec![SubmoduleFact {
                path: "vendor/lib".into(),
                url: Some("../lib.git".into()),
            }],
        }
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
    fn rejects_dirty_sources_missing_default_branches_and_duplicate_ids() {
        let home = Path::new("/projects/workspace");
        let mut dirty = repository("repo-1", "Repo");
        dirty.clean = false;
        dirty.source_path = PathBuf::from("/sources/my-repo");
        assert_eq!(
            plan_workspace_setup(home, vec![dirty]).unwrap_err(),
            "Repository `Repo` at `/sources/my-repo` has uncommitted changes."
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
        assert!(first.contains("separate OpenCode session"));
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
    fn repository_preflight_reads_cleanliness_head_default_remote_and_submodule_metadata() {
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
        assert!(facts.clean);
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
        assert!(inspect_repository_preflight(&record).unwrap().clean);
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
