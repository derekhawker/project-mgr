use crate::change_review::validate_repo_root;
use crate::management::{ManagementStore, RepositorySetupStatus, VerificationStatus};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPath {
    pub path: String,
    pub repository_id: Option<String>,
    pub repository_name: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentContent {
    pub path: String,
    pub contents: String,
}

fn is_document(path: &Path) -> bool {
    path.extension().is_some_and(|extension| {
        extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("txt")
    })
}

fn is_hidden_directory(path: &Path) -> bool {
    path.file_name()
        .is_some_and(|name| name.to_string_lossy().starts_with('.'))
}

fn is_dependency_directory(path: &Path) -> bool {
    let Some(name) = path.file_name() else {
        return false;
    };
    matches!(
        name.to_string_lossy().to_ascii_lowercase().as_str(),
        "node_modules"
            | "vendor"
            | "bower_components"
            | "third_party"
            | "pods"
            | "carthage"
            | "venv"
            | "virtualenv"
            | "site-packages"
    )
}

fn discover_in(root: &Path, found: &mut Vec<PathBuf>) -> Result<(), String> {
    let root = validate_repo_root(root)?;
    let mut pending = vec![root.clone()];
    while let Some(directory) = pending.pop() {
        let entries = fs::read_dir(&directory).map_err(|error| error.to_string())?;
        for entry in entries {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            let kind = entry.file_type().map_err(|error| error.to_string())?;
            if kind.is_dir() {
                if !is_hidden_directory(&path) && !is_dependency_directory(&path) {
                    pending.push(path);
                }
            } else if kind.is_file() && is_document(&path) {
                found.push(path);
            }
        }
    }
    Ok(())
}

fn discover_workspace_home(root: &Path, found: &mut Vec<PathBuf>) -> Result<(), String> {
    let root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    let mut pending = vec![root];
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            let kind = entry.file_type().map_err(|error| error.to_string())?;
            if kind.is_dir() {
                if !is_hidden_directory(&path)
                    && !is_dependency_directory(&path)
                    && path
                        .file_name()
                        .is_some_and(|name| name != "repos" && name != "tasks")
                {
                    pending.push(path);
                }
            } else if kind.is_file() && is_document(&path) {
                found.push(path);
            }
        }
    }
    Ok(())
}

#[derive(Clone)]
struct SearchRoot {
    path: PathBuf,
    repository_id: Option<String>,
    repository_name: Option<String>,
    workspace_home: bool,
}

fn repository_root(
    store: &ManagementStore,
    repository_id: String,
    path: String,
) -> Result<SearchRoot, String> {
    let name = store
        .get_repository(&repository_id)
        .map_err(|error| error.to_string())?
        .map(|repository| repository.name)
        .unwrap_or_else(|| repository_id.clone());
    Ok(SearchRoot {
        path: PathBuf::from(path),
        repository_id: Some(repository_id),
        repository_name: Some(name),
        workspace_home: false,
    })
}

fn roots_for_owner(
    store: &ManagementStore,
    owner_type: &str,
    owner_id: &str,
) -> Result<Vec<SearchRoot>, String> {
    match owner_type {
        "workspace" => {
            let workspace = store
                .get_workspace(owner_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "Workspace was not found.".to_owned())?;
            let mut roots = vec![SearchRoot {
                path: PathBuf::from(workspace.home_path),
                repository_id: None,
                repository_name: None,
                workspace_home: true,
            }];
            for binding in store
                .list_workspace_repository_bindings(&workspace.id)
                .map_err(|e| e.to_string())?
                .into_iter()
                .filter(|binding| binding.verification_status == VerificationStatus::Verified)
            {
                roots.push(repository_root(
                    store,
                    binding.repository_id,
                    binding.checkout_path,
                )?);
            }
            Ok(roots)
        }
        "task" => {
            let task = store
                .get_task(owner_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "Task was not found.".to_owned())?;
            if task.quick_request.is_some() {
                return Err("Quick Requests do not have Docs.".into());
            }
            let mut roots = Vec::new();
            for binding in store
                .list_task_repository_bindings(&task.id)
                .map_err(|e| e.to_string())?
                .into_iter()
                .filter(|binding| binding.setup_status == RepositorySetupStatus::Ready)
            {
                roots.push(repository_root(
                    store,
                    binding.repository_id,
                    binding.worktree_path,
                )?);
            }
            Ok(roots)
        }
        _ => return Err("Docs owner type must be workspace or task.".into()),
    }
}

pub fn list_for_owner(
    store: &ManagementStore,
    owner_type: &str,
    owner_id: &str,
) -> Result<Vec<DocumentPath>, String> {
    let roots = roots_for_owner(store, owner_type, owner_id)?;
    let mut documents = Vec::new();
    for root in roots {
        let mut found = Vec::new();
        if root.workspace_home {
            discover_workspace_home(&root.path, &mut found)?;
        } else {
            discover_in(&root.path, &mut found)?;
        }
        let canonical_root = fs::canonicalize(&root.path).map_err(|error| error.to_string())?;
        for file in found {
            let relative = file
                .strip_prefix(&canonical_root)
                .map_err(|error| error.to_string())?;
            documents.push(DocumentPath {
                path: relative.to_string_lossy().replace('\\', "/"),
                repository_id: root.repository_id.clone(),
                repository_name: root.repository_name.clone(),
            });
        }
    }
    documents.sort_by(|left, right| {
        left.repository_name
            .cmp(&right.repository_name)
            .then_with(|| left.path.cmp(&right.path))
    });
    documents.dedup_by(|left, right| {
        left.repository_id == right.repository_id && left.path == right.path
    });
    Ok(documents)
}

pub fn read_for_owner(
    store: &ManagementStore,
    owner_type: &str,
    owner_id: &str,
    requested_path: &str,
    repository_id: Option<&str>,
) -> Result<DocumentContent, String> {
    let listed = list_for_owner(store, owner_type, owner_id)?;
    if !listed.iter().any(|document| {
        document.path == requested_path && document.repository_id.as_deref() == repository_id
    }) {
        return Err("Document is not available in this Workspace or Task.".into());
    }
    let relative = Path::new(requested_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|part| !matches!(part, std::path::Component::Normal(_)))
    {
        return Err("Document path must be relative to its Workspace or repository.".into());
    }
    let root = roots_for_owner(store, owner_type, owner_id)?
        .into_iter()
        .find(|root| root.repository_id.as_deref() == repository_id)
        .ok_or_else(|| "Document source is not available in this Workspace or Task.".to_owned())?;
    let canonical_root = fs::canonicalize(&root.path).map_err(|error| error.to_string())?;
    let requested =
        fs::canonicalize(canonical_root.join(relative)).map_err(|error| error.to_string())?;
    if !requested.starts_with(&canonical_root) {
        return Err("Document path escapes its Workspace or repository.".into());
    }
    let contents = fs::read_to_string(&requested)
        .map_err(|error| format!("Could not read {}: {error}", requested.display()))?;
    Ok(DocumentContent {
        path: requested_path.to_owned(),
        contents,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    #[test]
    fn discovers_markdown_and_text_files_recursively_but_skips_hidden_directories() {
        let root = tempfile::tempdir().unwrap();
        let git = |args: &[&str]| {
            let output = Command::new("git")
                .arg("-C")
                .arg(root.path())
                .args(args)
                .output()
                .unwrap();
            assert!(output.status.success());
        };
        git(&["init", "-q"]);
        fs::create_dir(root.path().join("docs")).unwrap();
        fs::create_dir(root.path().join(".hidden")).unwrap();
        fs::write(root.path().join("guide.MD"), "root markdown").unwrap();
        fs::write(root.path().join("docs/notes.txt"), "nested text").unwrap();
        fs::write(root.path().join("docs/not-a-doc.json"), "ignore").unwrap();
        fs::write(root.path().join(".git/secret.md"), "not content").unwrap();
        fs::write(root.path().join(".hidden/private.txt"), "not content").unwrap();
        let mut found = Vec::new();
        discover_in(root.path(), &mut found).unwrap();
        assert_eq!(found.len(), 2);
        assert!(found
            .iter()
            .all(|path| !path.components().any(|part| part.as_os_str() == ".git")));
    }
}
