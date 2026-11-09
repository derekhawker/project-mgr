//! Markdown-backed Workspace ticket discovery. Ticket files remain outside Git;
//! this module deliberately treats their contents (not SQLite) as authority.
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

/// External effects needed to open one ticket's work session.
pub trait TicketWorkRuntime {
    type Session;
    fn exists(&mut self, id: &str) -> Result<bool, String>;
    fn create(&mut self, title: &str, repository: &Path) -> Result<String, String>;
    fn prepare(&mut self, id: &str, directory: &Path, instructions: &str) -> Result<(), String>;
    fn attach(&mut self, id: &str, repository: &Path) -> Result<Self::Session, String>;
}

/// Open the session named in the Markdown ticket, or create one if absent.
/// The lock covers the entire operation, not only the final file write.
pub fn work<R: TicketWorkRuntime>(
    directory: &Path,
    repository: &Path,
    workspace_name: &str,
    filename: &str,
    runtime: &mut R,
) -> Result<R::Session, String> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    let _guard = LOCK.get_or_init(|| std::sync::Mutex::new(())).lock().map_err(|e| e.to_string())?;
    let repository = repository.canonicalize().map_err(|e| format!("Workspace repository unavailable: {e}"))?;
    let ticket = canonical_ticket(directory, filename)?;
    let ticket_dir = directory.canonicalize().map_err(|e| e.to_string())?;
    if ticket_dir.starts_with(&repository) { return Err("Workspace ticket storage must be outside the repository".into()); }
    let markdown = fs::read_to_string(&ticket).map_err(|e| format!("Could not read ticket: {e}"))?;
    let (title, status) = ticket_metadata(&markdown, filename);
    let id = match work_session_id(&markdown)? {
        Some(id) if runtime.exists(&id)? => id,
        _ => {
            let id = runtime.create(&format!("{workspace_name}: {title}"), &repository)?;
            write_session_id_safely(&ticket, &markdown, &id)?;
            id
        }
    };
    let instructions = format!("Work on ticket {title} ({filename}). Canonical ticket Markdown: {}. Current status: {status}. Workspace ticket directory: {}. Repository root: {}. Follow the globally available ticket-management skill. Read the canonical Markdown for the complete assignment and latest status; it is authoritative. Do not infer another ticket from repository contents or UI selection.", ticket.display(), ticket_dir.display(), repository.display());
    runtime.prepare(&id, &ticket_dir, &instructions)?;
    runtime.attach(&id, &repository)
}

/// Resolve only a direct Markdown child of the canonical ticket directory.
pub fn canonical_ticket(directory: &Path, filename: &str) -> Result<PathBuf, String> {
    if filename.is_empty() || filename != Path::new(filename).file_name().and_then(|n| n.to_str()).unwrap_or("") || !filename.ends_with(".md") || filename == "archived" {
        return Err("Invalid Workspace ticket filename".into());
    }
    let root = directory.canonicalize().map_err(|e| format!("Ticket directory: {e}"))?;
    let path = root.join(filename);
    let canonical = path.canonicalize().map_err(|e| format!("Ticket file: {e}"))?;
    if canonical.parent() != Some(root.as_path()) || !canonical.is_file() {
        return Err("Ticket must be a Markdown file directly inside the Workspace ticket directory".into());
    }
    Ok(canonical)
}

/// Replace the sole `work_session_id` front-matter key, preserving all other
/// bytes (including the body). Refuses malformed/missing YAML front matter.
pub fn record_work_session(markdown: &str, id: &str) -> Result<String, String> {
    if id.is_empty() || id.contains(['\n', '\r', '\'', '"']) { return Err("Invalid OpenCode session ID".into()); }
    let mut lines: Vec<String> = markdown.split_inclusive('\n').map(str::to_owned).collect();
    if lines.first().map(|s| s.trim_end_matches(['\r','\n'])) != Some("---") { return Err("Ticket must begin with YAML front matter".into()); }
    let end = lines.iter().enumerate().position(|(i, line)| i > 0 && line.trim_end_matches(['\r','\n']) == "---").ok_or("Ticket YAML front matter is not closed")?;
    let keys: Vec<usize> = (1..end).filter(|&i| lines[i].split_once(':').map(|(k,_)| k.trim() == "work_session_id").unwrap_or(false)).collect();
    if keys.len() > 1 { return Err("Ticket has duplicate work_session_id fields".into()); }
    let value = format!("work_session_id: {id}\n");
    if let Some(index) = keys.first().copied() { lines[index] = value; }
    else { lines.insert(end, value); }
    Ok(lines.concat())
}

/// Compare-before-replace with an atomic rename. A process-wide lock prevents
/// two writes in this process from racing; byte comparisons detect edits seen
/// before replacement, but cannot exclude non-cooperating external writers.
pub fn write_session_id_safely(path: &Path, original: &str, id: &str) -> Result<(), String> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    let _guard = LOCK.get_or_init(|| std::sync::Mutex::new(())).lock().map_err(|e| e.to_string())?;
    let current = fs::read_to_string(path).map_err(|e| e.to_string())?;
    if current != original { return Err("Ticket changed while starting work; no ticket content was overwritten. Retry Work.".into()); }
    let updated = record_work_session(original, id)?;
    let tmp = path.with_extension(format!("md.{}.tmp", std::process::id()));
    use std::io::Write;
    let mut temporary = fs::OpenOptions::new().write(true).create_new(true).open(&tmp)
        .map_err(|e| format!("Could not create temporary ticket file: {e}"))?;
    if let Err(error) = temporary.write_all(updated.as_bytes()) {
        drop(temporary);
        let _ = fs::remove_file(&tmp);
        return Err(error.to_string());
    }
    drop(temporary);
    if fs::read_to_string(path).map_err(|e| e.to_string())? != original { let _ = fs::remove_file(&tmp); return Err("Ticket changed while starting work; no ticket content was overwritten. Retry Work.".into()); }
    fs::rename(&tmp, path).map_err(|e| { let _ = fs::remove_file(&tmp); e.to_string() })
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ticket {
    pub filename: String,
    pub title: String,
    pub status: String,
    pub content: String,
    pub modified_at: u128,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationTicket {
    pub filename: String,
    pub title: String,
    pub status: String,
    pub modified_at: u128,
}

pub fn workspace_ticket_dir(app_data: &Path, workspace_slug: &str) -> Result<PathBuf, String> {
    crate::safety::validate_slug(workspace_slug).map_err(|e| e.to_string())?;
    Ok(app_data.join("workspace-tickets").join(workspace_slug))
}

/// Validate the explicit ticket selection used to authorize Workspace workbench
/// destinations and resolve its sole verified repository checkout.
pub fn selected_ticket_repository(
    store: &crate::management::ManagementStore,
    app_data: &Path,
    workspace_id: &str,
    filename: &str,
) -> Result<(PathBuf, String), String> {
    let workspace = store.get_workspace(workspace_id).map_err(|e| e.to_string())?
        .ok_or_else(|| "Workspace was not found.".to_owned())?;
    if workspace.kind != crate::management::WorkspaceKind::Regular
        || workspace.status != crate::management::WorkspaceStatus::Active {
        return Err("A selected ticket in an active regular Workspace is required.".into());
    }
    let directory = workspace_ticket_dir(app_data, &workspace.slug)?;
    let ticket = canonical_ticket(&directory, filename)?;
    if !ticket.starts_with(directory.canonicalize().map_err(|e| e.to_string())?) {
        return Err("Invalid Workspace ticket selection.".into());
    }
    let bindings = store.list_workspace_repository_bindings(workspace_id).map_err(|e| e.to_string())?;
    if bindings.len() != 1 || bindings[0].verification_status != crate::management::VerificationStatus::Verified {
        return Err("Workspace must have exactly one verified repository for ticket work.".into());
    }
    let binding = &bindings[0];
    let repository = crate::change_review::validate_repo_root(Path::new(&binding.checkout_path))?;
    if ticket.starts_with(&repository) {
        return Err("Workspace ticket storage must be outside the repository.".into());
    }
    Ok((repository, binding.repository_id.clone()))
}

pub fn validate_workbench_context(
    store: &crate::management::ManagementStore,
    app_data: &Path,
    owner_type: &str,
    owner_id: &str,
    filename: Option<&str>,
    repository_id: Option<&str>,
) -> Result<(), String> {
    if owner_type != "workspace" { return Ok(()); }
    let filename = filename.ok_or("Select a ticket before opening Workspace tools.")?;
    let (_, actual_id) = selected_ticket_repository(store, app_data, owner_id, filename)?;
    if repository_id.is_some_and(|id| id != actual_id) {
        return Err("Repository does not belong to the selected ticket's Workspace.".into());
    }
    Ok(())
}

pub fn list(directory: &Path) -> Result<Vec<Ticket>, String> {
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut tickets = Vec::new();
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") || !path.is_file() {
            continue;
        }
        let modified_at = path.metadata().map_err(|e| e.to_string())?
            .modified().map_err(|e| e.to_string())?
            .duration_since(std::time::UNIX_EPOCH).unwrap_or_default()
            .as_millis().min(u64::MAX as u128) as u64;
        let content = fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        let (title, status) = ticket_metadata(
            &content,
            path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Ticket"),
        );
        tickets.push(Ticket {
            filename: path.file_name().unwrap().to_string_lossy().into_owned(),
            title,
            status,
            content,
            modified_at: modified_at as u128,
        });
    }
    tickets.sort_by(|a, b| a.filename.cmp(&b.filename));
    Ok(tickets)
}

/// Lists only tickets shown in persistent Workspace navigation.
pub fn list_for_navigation(directory: &Path) -> Result<Vec<NavigationTicket>, String> {
    let mut tickets: Vec<_> = list(directory)?
        .into_iter()
        .filter(|ticket| matches!(ticket.status.as_str(), "in_progress" | "blocked"))
        .map(|ticket| NavigationTicket {
            filename: ticket.filename,
            title: ticket.title,
            status: ticket.status,
            modified_at: ticket.modified_at,
        })
        .collect();
    tickets.sort_by(|a, b| {
        b.modified_at
            .cmp(&a.modified_at)
            .then_with(|| a.filename.cmp(&b.filename))
    });
    Ok(tickets)
}

pub fn is_ticket_markdown_event(event: &notify::Event) -> bool {
    event.paths.iter().any(|path| {
        path.extension().and_then(|extension| extension.to_str()) == Some("md")
    })
}

pub fn watch_directory(
    directory: &Path,
    on_change: impl Fn() + Send + 'static,
) -> Result<notify::RecommendedWatcher, String> {
    use notify::Watcher;

    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        if result
            .as_ref()
            .is_ok_and(is_ticket_markdown_event)
        {
            on_change();
        }
    })
    .map_err(|error| error.to_string())?;
    watcher
        .watch(directory, notify::RecursiveMode::Recursive)
        .map_err(|error| error.to_string())?;
    Ok(watcher)
}

/// Lists closed tickets separately; archived files never leak into the default list.
pub fn list_archived(directory: &Path) -> Result<Vec<Ticket>, String> {
    list(&directory.join("archived"))
}

pub fn ticket_metadata(text: &str, fallback: &str) -> (String, String) {
    let mut lines = text.lines();
    if lines.next() == Some("---") {
        let mut title = None;
        let mut status = None;
        for line in lines.by_ref() {
            if line.trim() == "---" {
                break;
            }
            if let Some(v) = line.strip_prefix("title:") {
                title = Some(v.trim().trim_matches(['\"', '\'']).to_owned());
            }
            if let Some(v) = line.strip_prefix("status:") {
                status = Some(v.trim().trim_matches(['\"', '\'']).to_owned());
            }
        }
        let rest = lines.collect::<Vec<_>>().join("\n");
        let heading = rest
            .lines()
            .find_map(|l| l.strip_prefix("# "))
            .map(str::trim)
            .filter(|s| !s.is_empty());
        return (
            title
                .or_else(|| heading.map(str::to_owned))
                .unwrap_or_else(|| fallback.to_owned()),
            status.unwrap_or_else(|| "unknown".into()),
        );
    }
    (
        text.lines()
            .find_map(|l| l.strip_prefix("# "))
            .unwrap_or(fallback)
            .to_owned(),
        "unknown".into(),
    )
}

pub fn work_session_id(text: &str) -> Result<Option<String>, String> {
    if !text.starts_with("---\n") { return Err("Ticket must begin with YAML front matter".into()); }
    let end = text[4..].find("\n---").map(|i| i + 4).ok_or("Ticket YAML front matter is not closed")?;
    let values: Vec<_> = text[4..end].lines().filter_map(|line| line.strip_prefix("work_session_id:").map(str::trim)).collect();
    if values.len() > 1 { return Err("Ticket has duplicate work_session_id fields".into()); }
    values.first().map(|v| { if v.is_empty() || !v.starts_with("ses_") || !v.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') { Err("Invalid work_session_id in ticket front matter".into()) } else { Ok((*v).to_owned()) }}).transpose()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct FakeRuntime {
        creates: usize,
        exists: bool,
        fail_exists: bool,
        prepared: Vec<(String, String)>,
        attached: Vec<(String, PathBuf)>,
    }
    impl TicketWorkRuntime for FakeRuntime {
        type Session = String;
        fn exists(&mut self, _: &str) -> Result<bool, String> {
            if self.fail_exists { Err("network unavailable".into()) } else { Ok(self.exists) }
        }
        fn create(&mut self, _: &str, _: &Path) -> Result<String, String> {
            self.creates += 1;
            Ok(format!("ses_{}", self.creates))
        }
        fn prepare(&mut self, id: &str, _: &Path, instructions: &str) -> Result<(), String> {
            self.prepared.push((id.into(), instructions.into()));
            Ok(())
        }
        fn attach(&mut self, id: &str, repository: &Path) -> Result<String, String> {
            self.attached.push((id.into(), repository.into()));
            Ok(id.into())
        }
    }

    #[test]
    fn work_creates_resumes_and_replaces_only_when_confirmed_missing() {
        let root = tempfile::tempdir().unwrap();
        let repo = root.path().join("repo");
        let dir = root.path().join("tickets");
        fs::create_dir(&repo).unwrap();
        fs::create_dir(&dir).unwrap();
        let path = dir.join("test.md");
        fs::write(&path, "---\ntitle: Test\nstatus: draft\n---\n# Test\nPrivate body\n").unwrap();
        let mut runtime = FakeRuntime::default();
        assert_eq!(work(&dir, &repo, "Workspace", "test.md", &mut runtime).unwrap(), "ses_1");
        let first = fs::read_to_string(&path).unwrap();
        assert!(first.contains("status: draft") && first.ends_with("# Test\nPrivate body\n"));
        assert!(!runtime.prepared[0].1.contains("Private body"));
        assert_eq!(runtime.attached[0].1, repo.canonicalize().unwrap());
        runtime.exists = true;
        fs::write(&path, first.replace("status: draft", "status: in_progress")).unwrap();
        assert_eq!(work(&dir, &repo, "Workspace", "test.md", &mut runtime).unwrap(), "ses_1");
        assert_eq!(runtime.creates, 1);
        assert!(runtime.prepared[1].1.contains("Current status: in_progress"));
        runtime.fail_exists = true;
        let before = fs::read_to_string(&path).unwrap();
        assert!(work(&dir, &repo, "Workspace", "test.md", &mut runtime).is_err());
        assert_eq!(runtime.creates, 1);
        assert_eq!(fs::read_to_string(&path).unwrap(), before);
        runtime.fail_exists = false;
        runtime.exists = false;
        assert_eq!(work(&dir, &repo, "Workspace", "test.md", &mut runtime).unwrap(), "ses_2");
        let last = fs::read_to_string(&path).unwrap();
        assert!(last.contains("status: in_progress") && last.ends_with("# Test\nPrivate body\n"));
    }

    #[test]
    fn selected_ticket_context_requires_real_ticket_and_routes_to_sole_repository() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("home");
        fs::create_dir(&home).unwrap();
        let store = crate::management::ManagementStore::in_memory_with_paths(&home, root.path()).unwrap();
        let input = crate::management::NewWorkspace {
            id: "ticket-workspace".into(), name: "Ticket Workspace".into(), slug: "ticket-workspace".into(),
            description: None, kind: crate::management::WorkspaceKind::Regular, created_at: 42,
        };
        let (workspace, repository) = store.create_single_repository_workspace(&input, None).unwrap();
        let app_data = root.path().join("app-data");
        let dir = workspace_ticket_dir(&app_data, &workspace.slug).unwrap();
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("one.md"), "---\ntitle: One\nstatus: draft\n---\n").unwrap();
        let (actual_path, actual_id) = selected_ticket_repository(&store, &app_data, &workspace.id, "one.md").unwrap();
        assert_eq!(actual_path, PathBuf::from(&repository.repository_path));
        assert_eq!(actual_id, repository.id);
        assert!(selected_ticket_repository(&store, &app_data, &workspace.id, "missing.md").is_err());
        assert!(selected_ticket_repository(&store, &app_data, &workspace.id, "../one.md").is_err());
        assert!(validate_workbench_context(&store, &app_data, "workspace", &workspace.id, None, None).is_err());
        assert!(validate_workbench_context(&store, &app_data, "workspace", &workspace.id, Some("one.md"), Some("other-repo")).is_err());
        assert!(validate_workbench_context(&store, &app_data, "workspace", &workspace.id, Some("one.md"), Some(&repository.id)).is_ok());
    }

    #[test]
    fn work_session_frontmatter_updates_preserve_body_and_reject_concurrent_edit() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("ticket.md");
        let source = "---\ntitle: T\nstatus: draft\n---\n# T\nBody stays exact\n";
        fs::write(&path, source).unwrap();
        write_session_id_safely(&path, source, "ses_first").unwrap();
        let written = fs::read_to_string(&path).unwrap();
        assert!(written.contains("status: draft"));
        assert!(written.ends_with("# T\nBody stays exact\n"));
        assert_eq!(work_session_id(&written).unwrap().as_deref(), Some("ses_first"));
        fs::write(&path, written.replace("Body stays exact", "external edit")).unwrap();
        assert!(write_session_id_safely(&path, &written, "ses_second").is_err());
        assert!(fs::read_to_string(path).unwrap().contains("external edit"));
    }
    #[test]
    fn work_session_temp_collision_never_overwrites_existing_file() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("ticket.md");
        let source = "---\ntitle: T\nstatus: draft\n---\nBody\n";
        fs::write(&path, source).unwrap();
        let temp = path.with_extension(format!("md.{}.tmp", std::process::id()));
        fs::write(&temp, "existing user data").unwrap();
        assert!(write_session_id_safely(&path, source, "ses_first").is_err());
        assert_eq!(fs::read_to_string(&temp).unwrap(), "existing user data");
        assert_eq!(fs::read_to_string(&path).unwrap(), source);
    }
    #[test]
    fn lists_markdown_and_reads_current_status_after_file_edit() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("sample.md");
        fs::write(
            &file,
            "---\ntitle: Sample\nstatus: draft\n---\n# Sample\nBody",
        )
        .unwrap();
        let listed = list(root.path()).unwrap();
        assert_eq!(listed[0].status, "draft");
        let expected = file.metadata().unwrap().modified().unwrap()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();
        assert_eq!(listed[0].modified_at, expected);
        assert_eq!(serde_json::to_value(&listed[0]).unwrap()["modifiedAt"], serde_json::json!(expected));
        fs::write(
            &file,
            "---\ntitle: Sample\nstatus: in_progress\n---\n# Sample\nBody",
        )
        .unwrap();
        assert_eq!(list(root.path()).unwrap()[0].status, "in_progress");
    }
    #[test]
    fn navigation_lists_only_active_statuses_newest_first_by_file_mtime() {
        use std::time::{Duration, SystemTime};

        let root = tempfile::tempdir().unwrap();
        let files = [
            ("older.md", "in_progress", 10),
            ("blocked.md", "blocked", 30),
            ("draft.md", "draft", 40),
            ("newer.md", "in_progress", 20),
        ];
        for (name, status, seconds) in files {
            let path = root.path().join(name);
            fs::write(&path, format!("---\ntitle: {name}\nstatus: {status}\n---\n"))
                .unwrap();
            fs::File::open(path)
                .unwrap()
                .set_times(
                    fs::FileTimes::new().set_modified(
                        SystemTime::UNIX_EPOCH + Duration::from_secs(seconds),
                    ),
                )
                .unwrap();
        }

        let tickets = list_for_navigation(root.path()).unwrap();
        assert_eq!(
            tickets.iter().map(|ticket| ticket.filename.as_str()).collect::<Vec<_>>(),
            ["blocked.md", "newer.md", "older.md"],
        );
        assert!(tickets.iter().all(|ticket| ticket.status != "draft"));
    }

    #[test]
    fn ticket_watcher_recognizes_markdown_files_only() {
        let markdown = notify::Event::new(notify::EventKind::Any)
            .add_path(PathBuf::from("/tickets/active.md"));
        let ignored = notify::Event::new(notify::EventKind::Any)
            .add_path(PathBuf::from("/tickets/readme.txt"));
        assert!(is_ticket_markdown_event(&markdown));
        assert!(!is_ticket_markdown_event(&ignored));
    }

    #[test]
    fn ticket_watcher_notifies_after_markdown_changes() {
        use std::sync::mpsc;
        use std::time::Duration;

        let root = tempfile::tempdir().unwrap();
        let (sender, receiver) = mpsc::channel();
        let _watcher = watch_directory(root.path(), move || {
            let _ = sender.send(());
        })
        .unwrap();
        fs::write(root.path().join("ticket.md"), "status: in_progress\n").unwrap();
        receiver.recv_timeout(Duration::from_secs(5)).unwrap();
    }
    #[test]
    fn archived_markdown_is_separate_from_open_tickets() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("archived")).unwrap();
        fs::write(
            root.path().join("open.md"),
            "---\ntitle: Open\nstatus: draft\n---\n",
        )
        .unwrap();
        fs::write(
            root.path().join("archived/closed.md"),
            "---\ntitle: Closed\nstatus: done\n---\n",
        )
        .unwrap();
        assert_eq!(list(root.path()).unwrap().len(), 1);
        assert_eq!(list_archived(root.path()).unwrap()[0].title, "Closed");
    }
    #[test]
    fn ticket_path_is_in_app_data_and_slugged() {
        assert!(workspace_ticket_dir(Path::new("/data"), "my-workspace")
            .unwrap()
            .ends_with("workspace-tickets/my-workspace"));
        assert!(workspace_ticket_dir(Path::new("/data"), "../escape").is_err());
    }
}
