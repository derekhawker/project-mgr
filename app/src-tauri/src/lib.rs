use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

pub mod management;
pub mod opencode;
pub mod safety;
pub mod terminal;

use management::ManagementStore;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppShellInfo {
    app_name: String,
    version: String,
    status: String,
    message: String,
}

impl AppShellInfo {
    fn initialized(version: &str) -> Self {
        Self {
            app_name: "OpenCode Project Manager".to_owned(),
            version: version.to_owned(),
            status: "ready".to_owned(),
            message: "The Rust core and management storage are initialized.".to_owned(),
        }
    }

    fn storage_unavailable(version: &str, reason: &str) -> Self {
        Self {
            app_name: "OpenCode Project Manager".to_owned(),
            version: version.to_owned(),
            status: "error".to_owned(),
            message: format!(
                "Management storage could not be initialized: {reason}. Management features are unavailable."
            ),
        }
    }
}

/// Shell status published after app-owned management storage has opened and migrated.
struct AppState {
    shell_info: AppShellInfo,
    quick_request_in_flight: Arc<Mutex<bool>>,
}

impl AppState {
    fn initialized() -> Self {
        Self {
            shell_info: AppShellInfo::initialized(env!("CARGO_PKG_VERSION")),
            quick_request_in_flight: Arc::new(Mutex::new(false)),
        }
    }

    fn storage_unavailable(reason: &str) -> Self {
        Self {
            shell_info: AppShellInfo::storage_unavailable(env!("CARGO_PKG_VERSION"), reason),
            quick_request_in_flight: Arc::new(Mutex::new(false)),
        }
    }

    fn shell_info(&self) -> AppShellInfo {
        self.shell_info.clone()
    }
}

#[tauri::command]
fn app_shell_info(state: State<'_, AppState>) -> AppShellInfo {
    state.shell_info()
}

fn reveal_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn tray_icon() -> Image<'static> {
    let mut rgba = vec![0_u8; 32 * 32 * 4];
    for y in 0..32 {
        for x in 0..32 {
            let dx = x as i32 - 15;
            let dy = y as i32 - 15;
            let distance = dx * dx + dy * dy;
            let color = if (distance > 52 && distance < 180) || distance < 28 {
                [130, 226, 180, 255]
            } else if distance < 235 {
                [24, 38, 34, 255]
            } else {
                [0, 0, 0, 0]
            };
            let offset = (y * 32 + x) * 4;
            rgba[offset..offset + 4].copy_from_slice(&color);
        }
    }

    Image::new_owned(rgba, 32, 32)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            reveal_main_window(app);
        }))
        .setup(|app| {
            // OpenCode is started lazily by its command, so an absent install
            // cannot prevent the management shell from opening.
            app.manage(opencode::Runtime::new());
            let storage = (|| -> Result<ManagementStore, String> {
                let app_data_dir = app
                    .path()
                    .app_data_dir()
                    .map_err(|error| error.to_string())?;
                std::fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
                let user_home = app.path().home_dir().map_err(|error| error.to_string())?;
                ManagementStore::open_with_paths(
                    app_data_dir.join("management.sqlite3"),
                    user_home,
                    std::env::temp_dir(),
                )
                .map_err(|error| error.to_string())
            })();
            let shell_state = match storage {
                Ok(management_store) => {
                    // Recovery is deliberately performed before the worker
                    // starts. Never discard a recovery error: the renderer
                    // receives a session-scoped event and the durable row is
                    // left visibly failed/recoverable.
                    if let Err(error) = reconcile_startup(app.handle(), &management_store) {
                        if let Err(delivery) = app.emit(
                            "startup-recovery-error",
                            serde_json::json!({"message": error}),
                        ) {
                            eprintln!("startup-recovery-error delivery failed: {delivery}");
                        }
                    }
                    app.manage(management_store);
                    start_cleanup_worker(app.handle().clone());
                    AppState::initialized()
                }
                Err(error) => AppState::storage_unavailable(&error),
            };
            app.manage(shell_state);

            let show_item = MenuItem::with_id(
                app,
                "show",
                "Show OpenCode Project Manager",
                true,
                None::<&str>,
            )?;
            let quit_item = MenuItem::with_id(
                app,
                "quit",
                "Quit OpenCode Project Manager",
                true,
                None::<&str>,
            )?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
            let tray = TrayIconBuilder::new()
                .icon(tray_icon())
                .tooltip("OpenCode Project Manager")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => reveal_main_window(app),
                    "quit" => {
                        if let Some(runtime) = app.try_state::<opencode::Runtime>() {
                            runtime.shutdown();
                        }
                        app.exit(0)
                    }
                    _ => {}
                })
                .build(app)?;
            app.manage(tray);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_shell_info,
            opencode_runtime_info,
            opencode_models,
            opencode_model_default,
            opencode_session_create,
            opencode_session_model,
            opencode_session_prompt,
            opencode_permission_reply,
            opencode_form_reply,
            opencode_form_cancel,
            opencode_session_history,
            opencode_session_status,
            opencode_session_reconcile,
            opencode_pending_inputs,
            opencode_pending_inputs_all,
            opencode_session_pending_inputs,
            opencode_terminal_attach,
            opencode_terminal_replay,
            opencode_session_restore,
            opencode_terminal_start,
            opencode_terminal_write,
            opencode_terminal_resize,
            opencode_terminal_detach,
            opencode_terminal_cleanup,
            quick_request_create,
            quick_request_start_prompt,
            quick_request_retry_prompt,
            quick_request_follow_up,
            quick_request_restore,
            quick_request_list,
            quick_request_dismiss,
            quick_request_expire,
            quick_request_promote,
            workspace_navigation,
            workspace_create,
            workspace_complete,
            workspace_reactivate,
            task_create,
            task_complete,
            task_cleanup_jobs,
            task_cleanup_retry,
            task_setup_start_prompt,
            task_setup_status,
            task_setup_cancel,
            task_setup_resume,
            task_registration_report,
            task_registration_results,
            repository_scan,
            repository_catalog,
            repository_attach,
            workspace_session_create,
            task_session_create
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run OpenCode Project Manager");
}

fn reconcile_startup(app: &AppHandle, store: &ManagementStore) -> Result<(), String> {
    let mut startup_failures = Vec::new();
    if let Err(error) = store.recover_running_cleanup_jobs(now_millis()) {
        startup_failures.push(format!("cleanup recovery: {error}"));
        if let Err(delivery) = app.emit(
            "cleanup-recovery-error",
            serde_json::json!({"message": error.to_string()}),
        ) {
            eprintln!("cleanup-recovery-error delivery failed: {delivery}");
        }
    }
    if let Err(error) = store.mark_sessions_for_startup_reconciliation(now_millis()) {
        startup_failures.push(format!("session reconciliation marking: {error}"));
    }
    let runtime = app
        .try_state::<opencode::Runtime>()
        .ok_or_else(|| "OpenCode runtime is unavailable during startup recovery".to_owned())?;
    let sessions = store.list_all_sessions().map_err(|e| e.to_string())?;
    let mut failures = Vec::new();
    for session in sessions
        .into_iter()
        .filter(|session| session.last_known_status != "failed")
    {
        let result = runtime
            .reconcile_session(
                &session.open_code_session_id,
                session.event_cursor.as_deref(),
            )
            .and_then(|result| {
                let status = match result.status {
                    opencode::SessionApplicationStatus::Starting => "starting",
                    opencode::SessionApplicationStatus::Running => "running",
                    opencode::SessionApplicationStatus::WaitingForInput => "waiting_for_input",
                    opencode::SessionApplicationStatus::ReadyForReview => "ready_for_review",
                    opencode::SessionApplicationStatus::Reconnecting => "reconnecting",
                    opencode::SessionApplicationStatus::Unknown => "unknown",
                    opencode::SessionApplicationStatus::Failed => "failed",
                };
                let pending = serde_json::to_string(
                    &serde_json::json!({"permissions": result.permissions, "forms": result.forms}),
                )
                .map_err(|e| e.to_string())?;
                store
                    .update_session_reconciliation(
                        &session.open_code_session_id,
                        status,
                        result.cursor.as_deref(),
                        matches!(
                            result.status,
                            opencode::SessionApplicationStatus::Unknown
                                | opencode::SessionApplicationStatus::Reconnecting
                        ),
                        Some(&pending),
                        now_millis(),
                    )
                    .map_err(|e| e.to_string())?;
                if status != "failed" {
                    runtime.restore_terminal(
                        app.clone(),
                        &session.open_code_session_id,
                        std::path::Path::new(&session.directory),
                    )?;
                }
                Ok(())
            });
        if let Err(error) = result {
            let persistence_error = store
                .update_session_reconciliation(
                    &session.open_code_session_id,
                    "failed",
                    session.event_cursor.as_deref(),
                    true,
                    None,
                    now_millis(),
                )
                .err()
                .map(|persist| format!("recovery persistence failed: {persist}"));
            let message = match persistence_error {
                Some(persist) => format!("{error}; {persist}"),
                None => error.clone(),
            };
            if let Err(delivery) = app.emit(
                "session-recovery-error",
                serde_json::json!({"sessionId": session.open_code_session_id, "message": message}),
            ) {
                eprintln!(
                    "session-recovery-error delivery failed for {}: {delivery}",
                    session.open_code_session_id
                );
            }
            failures.push(message);
        }
    }
    startup_failures.extend(failures);
    if startup_failures.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "startup recovery encountered {} error(s): {}",
            startup_failures.len(),
            startup_failures.join("; ")
        ))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceNavigation {
    workspaces: Vec<management::Workspace>,
    tasks: Vec<management::Task>,
    quick_requests: Vec<management::QuickRequestRecord>,
}

#[tauri::command]
fn workspace_navigation(store: State<'_, ManagementStore>) -> Result<WorkspaceNavigation, String> {
    let workspaces = store.list_workspaces().map_err(|e| e.to_string())?;
    let mut tasks = Vec::new();
    for workspace in &workspaces {
        tasks.extend(store.list_tasks(&workspace.id).map_err(|e| e.to_string())?);
    }
    let quick_requests = store
        .list_quick_requests(false)
        .map_err(|e| e.to_string())?;
    Ok(WorkspaceNavigation {
        workspaces,
        tasks,
        quick_requests,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TaskCompletionCommand {
    task_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskCompletionResponse {
    task: management::Task,
    cleanup_jobs: Vec<management::CleanupJob>,
}

#[tauri::command]
fn task_complete(
    store: State<'_, ManagementStore>,
    request: TaskCompletionCommand,
) -> Result<TaskCompletionResponse, String> {
    let task = store
        .complete_task_and_queue_cleanup(&request.task_id, now_millis())
        .map_err(|e| e.to_string())?;
    let cleanup_jobs = store
        .list_cleanup_jobs(&task.id)
        .map_err(|e| e.to_string())?;
    Ok(TaskCompletionResponse { task, cleanup_jobs })
}

#[tauri::command]
fn task_cleanup_jobs(
    store: State<'_, ManagementStore>,
    request: TaskCompletionCommand,
) -> Result<Vec<management::CleanupJob>, String> {
    store
        .list_cleanup_jobs(&request.task_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn task_cleanup_retry(
    store: State<'_, ManagementStore>,
    request: TaskCompletionCommand,
) -> Result<Vec<management::CleanupJob>, String> {
    store
        .retry_cleanup_jobs(&request.task_id, now_millis())
        .map_err(|e| e.to_string())
}

fn start_cleanup_worker(app: AppHandle) {
    thread::Builder::new()
        .name("task-cleanup-worker".into())
        .spawn(move || loop {
            let Some(store) = app.try_state::<ManagementStore>() else {
                break;
            };
            let Some(runtime) = app.try_state::<opencode::Runtime>() else {
                break;
            };
            // A previous process may have died after claiming a job. Requeue
            // those claims before normal polling; this does not touch Git.
            if let Err(error) = store.recover_running_cleanup_jobs(now_millis()) {
                if let Err(delivery) = app.emit(
                    "cleanup-recovery-error",
                    serde_json::json!({"message": error.to_string()}),
                ) { eprintln!("cleanup-recovery-error delivery failed: {delivery}"); }
            }
            let active_terminal_ids = runtime.terminals.active_session_ids();
            let mut active_dirs = Vec::<PathBuf>::new();
            for id in active_terminal_ids {
                if let Ok(Some(session)) = store.get_session(&id) {
                    active_dirs.push(PathBuf::from(session.directory));
                }
            }
            if let Ok(active) = runtime.active_sessions() {
                for id in active.keys() {
                    if let Ok(Some(session)) = store.get_session(id) {
                        active_dirs.push(PathBuf::from(session.directory));
                    }
                }
            }
            match store.list_pending_cleanup_jobs(now_millis()) {
                Ok(jobs) => for job in jobs {
                    if let Err(error) = store.execute_cleanup_job(&job.id, &active_dirs, now_millis()) {
                        if let Err(delivery) = app.emit("cleanup-job-error", serde_json::json!({
                            "jobId": job.id, "failureDetail": error.to_string(), "message": error.to_string()
                        })) {
                            eprintln!("cleanup-job-error delivery failed for {}: {delivery}", job.id);
                        }
                    }
                },
                Err(error) => {
                    if let Err(delivery) = app.emit("cleanup-worker-error", serde_json::json!({
                        "failureDetail": error.to_string(), "message": error.to_string()
                    })) {
                        eprintln!("cleanup-worker-error delivery failed: {delivery}");
                    }
                }
            }
            drop(runtime);
            drop(store);
            std::thread::sleep(std::time::Duration::from_secs(2));
        })
        .ok();
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkspaceCreateCommand {
    name: String,
    description: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkspaceIdCommand {
    workspace_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct QuickRequestPromoteCommand {
    request_id: String,
    target_workspace_id: Option<String>,
    new_workspace_name: Option<String>,
    target_slug: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TaskCreateCommand {
    workspace_id: String,
    prompt: String,
    model: Option<ModelCommand>,
}

#[tauri::command]
fn task_create(
    app: AppHandle,
    runtime: State<'_, opencode::Runtime>,
    store: State<'_, ManagementStore>,
    request: TaskCreateCommand,
) -> Result<management::Task, String> {
    let prompt = request.prompt.trim().to_owned();
    if prompt.is_empty() {
        return Err("Enter a task prompt first.".into());
    }
    let workspace = store
        .get_workspace(&request.workspace_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Workspace not found".to_owned())?;
    if workspace.kind != management::WorkspaceKind::Regular
        || workspace.status != management::WorkspaceStatus::Active
    {
        return Err("Tasks can only be created in an active regular workspace.".into());
    }
    let model_command = request
        .model
        .ok_or_else(|| "Choose an OpenCode model for task setup.".to_owned())?;
    let selected_model = model_key(&model_command);
    let model = model_command.runtime_model();
    let id = format!("task-{}", request_id());
    let operation_id = format!("setup-{id}");
    let slug = id.strip_prefix("task-").unwrap_or(&id).to_owned();
    let name = prompt.chars().take(64).collect::<String>();
    let task = store
        .create_task(&management::NewTask {
            id,
            workspace_id: workspace.id,
            name,
            slug,
            description: Some(prompt),
            setup_status: management::TaskSetupStatus::NotStarted,
            created_at: now_millis(),
        })
        .map_err(|e| e.to_string())?;
    if let Err(error) =
        store.update_task_setup_status(&task.id, management::TaskSetupStatus::InProgress)
    {
        let _ = store.rollback_new_task(&task.id);
        return Err(error.to_string());
    }
    let directory = std::path::Path::new(&task.home_path);
    let response = match runtime.create_session(&task.name, directory, model) {
        Ok(response) => response,
        Err(error) => {
            let _ = store.rollback_new_task(&task.id);
            return Err(error);
        }
    };
    let session_id = match session_id_from_response(&response) {
        Ok(session_id) => session_id,
        Err(error) => {
            let _ = store.rollback_new_task(&task.id);
            return Err(error);
        }
    };
    let _session = store
        .create_session_with_model(
            &management::NewSession {
                open_code_session_id: session_id.clone(),
                owner: management::SessionOwner::Task(task.id.clone()),
                directory: task.home_path.clone(),
                last_known_status: "starting".into(),
                created_at: now_millis(),
            },
            &selected_model,
        )
        .map_err(|error| {
            let _ = store.rollback_new_task(&task.id);
            error.to_string()
        })?;
    let task = match store.bind_task_setup_operation(&task.id, &operation_id, &session_id) {
        Ok(task) => task,
        Err(error) => {
            let _ = runtime.cleanup_terminal(&session_id);
            let _ = store.rollback_new_task(&task.id);
            return Err(error.to_string());
        }
    };
    if let Err(error) = runtime.attach_terminal(app, &session_id, directory) {
        let _ = runtime.cleanup_terminal(&session_id);
        let _ = store.rollback_new_task(&task.id);
        return Err(error);
    }
    Ok(task)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TaskSetupIdCommand {
    task_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TaskSetupResumeCommand {
    task_id: String,
    operation_id: String,
    session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TaskSetupStartCommand {
    task_id: String,
    operation_id: String,
    session_id: String,
    model: ModelCommand,
}

#[tauri::command]
fn task_setup_start_prompt(
    runtime: State<'_, opencode::Runtime>,
    store: State<'_, ManagementStore>,
    request: TaskSetupStartCommand,
) -> Result<(), String> {
    let task = store
        .get_task(&request.task_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Task not found".to_owned())?;
    if task.setup_status == management::TaskSetupStatus::Canceled {
        return Err("Task setup is canceled; resume it first.".into());
    }
    if task.setup_cancelled_at.is_some() {
        return Err("Task setup was canceled; resume it explicitly first.".into());
    }
    if task.setup_operation_id.as_deref() != Some(request.operation_id.as_str())
        || task.setup_session_id.as_deref() != Some(request.session_id.as_str())
    {
        return Err("The setup operation/session does not belong to this task.".into());
    }
    let session = store
        .get_session(&request.session_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Task setup session not found".to_owned())?;
    if session.owner != management::SessionOwner::Task(task.id.clone()) {
        return Err("The setup session does not belong to this task.".into());
    }
    if session.last_known_status == "running" {
        return Err("Task setup is already running for this operation.".into());
    }
    if !runtime.terminal_attached(&session.open_code_session_id) {
        return Err("The task setup terminal is not attached.".into());
    }
    let repository_context = store
        .list_repositories()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|repository| format!("{}: {}", repository.id, repository.repository_path))
        .collect::<Vec<_>>();
    let setup_prompt = if repository_context.is_empty() {
        task.description.clone().unwrap_or_default()
    } else {
        format!(
            "{}\n\nAvailable repository catalog context:\n{}\n\nCreate the required branches and worktrees, then call register_task_setup with one result per repository.",
            task.description.as_deref().unwrap_or("Set up this task."),
            repository_context.join("\n")
        )
    };
    let result = (|| {
        ensure_session_model(&session, &request.model)?;
        runtime.wait_for_terminal_ready(&session.open_code_session_id)?;
        store
            .claim_initial_prompt(&session.open_code_session_id)
            .map_err(|e| e.to_string())?;
        runtime.set_session_model(&session.open_code_session_id, request.model.runtime_model())?;
        runtime.prompt(&session.open_code_session_id, &setup_prompt)
    })();
    match result {
        Ok(()) => {
            let _ =
                store.update_session_status(&session.open_code_session_id, "running", now_millis());
            Ok(())
        }
        Err(error) => Err(mark_prompt_failed(
            &store,
            &session.open_code_session_id,
            error,
        )),
    }
}

#[tauri::command]
fn task_setup_status(
    store: State<'_, ManagementStore>,
    request: TaskSetupIdCommand,
) -> Result<serde_json::Value, String> {
    let task = store
        .get_task(&request.task_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Task not found".to_owned())?;
    let repositories = store
        .list_registration_results(&task.id)
        .map_err(|e| e.to_string())?;
    let session = task
        .setup_session_id
        .as_deref()
        .map(|id| store.get_session(id))
        .transpose()
        .map_err(|e| e.to_string())?
        .flatten();
    Ok(serde_json::json!({"task": task, "session": session, "repositories": repositories}))
}

#[tauri::command]
fn task_setup_cancel(
    store: State<'_, ManagementStore>,
    request: TaskSetupIdCommand,
) -> Result<management::Task, String> {
    store
        .cancel_task_setup(&request.task_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn task_setup_resume(
    store: State<'_, ManagementStore>,
    request: TaskSetupResumeCommand,
) -> Result<management::Task, String> {
    store
        .resume_task_setup(
            &request.task_id,
            Some(&request.operation_id),
            Some(&request.session_id),
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn task_registration_report(
    store: State<'_, ManagementStore>,
    report: management::RegistrationReport,
) -> Result<management::RegistrationResult, String> {
    store
        .apply_registration_report(&report)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn task_registration_results(
    store: State<'_, ManagementStore>,
    request: TaskSetupIdCommand,
) -> Result<Vec<management::TaskRepositoryBinding>, String> {
    store
        .list_registration_results(&request.task_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn workspace_create(
    store: State<'_, ManagementStore>,
    request: WorkspaceCreateCommand,
) -> Result<management::Workspace, String> {
    let name = request.name.trim().to_owned();
    let slug = store
        .suggest_workspace_slug(&name)
        .map_err(|e| e.to_string())?;
    store
        .create_workspace(&management::NewWorkspace {
            id: format!("workspace-{}", now_millis()),
            name,
            slug,
            description: request.description.filter(|v| !v.trim().is_empty()),
            kind: management::WorkspaceKind::Regular,
            created_at: now_millis(),
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn workspace_complete(
    store: State<'_, ManagementStore>,
    request: WorkspaceIdCommand,
) -> Result<management::Workspace, String> {
    store
        .complete_workspace(&request.workspace_id, now_millis())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn workspace_reactivate(
    store: State<'_, ManagementStore>,
    request: WorkspaceIdCommand,
) -> Result<management::Workspace, String> {
    store
        .reactivate_workspace(&request.workspace_id)
        .map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryScanResult {
    repositories: Vec<management::Repository>,
    errors: Vec<String>,
}

#[tauri::command]
fn repository_catalog(
    store: State<'_, ManagementStore>,
) -> Result<Vec<management::Repository>, String> {
    store.list_repositories().map_err(|e| e.to_string())
}

fn scan_repository_dirs(
    root: &std::path::Path,
    found: &mut Vec<std::path::PathBuf>,
) -> Result<(), String> {
    if !root.is_dir() {
        return Err(format!("{} is not a directory", root.display()));
    }
    let mut stack = vec![root.to_path_buf()];
    while let Some(path) = stack.pop() {
        if path.join(".git").exists() {
            found.push(path);
            continue;
        }
        let entries = std::fs::read_dir(&path)
            .map_err(|e| format!("could not read {}: {e}", path.display()))?;
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let child = entry.path();
            if entry.file_type().map_err(|e| e.to_string())?.is_dir()
                && child.file_name().and_then(|n| n.to_str()) != Some(".git")
            {
                stack.push(child);
            }
        }
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RepositoryScanCommand {
    paths: Vec<String>,
    purpose_proposals: Option<std::collections::HashMap<String, String>>,
}

#[tauri::command]
fn repository_scan(
    store: State<'_, ManagementStore>,
    request: RepositoryScanCommand,
) -> Result<RepositoryScanResult, String> {
    if request.paths.is_empty() {
        return Err("Choose at least one folder to scan.".into());
    }
    let mut candidates = Vec::new();
    let mut errors = Vec::new();
    for path in request.paths {
        if let Err(error) = scan_repository_dirs(std::path::Path::new(&path), &mut candidates) {
            errors.push(error);
        }
    }
    let mut repositories = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (index, path) in candidates.into_iter().enumerate() {
        let canonical_path = match std::fs::canonicalize(&path) {
            Ok(path) => path,
            Err(error) => {
                errors.push(format!(
                    "{}: could not canonicalize repository: {error}",
                    path.display()
                ));
                continue;
            }
        };
        if !seen.insert(canonical_path.clone()) {
            continue;
        }
        let canonical_key = canonical_path.to_string_lossy().to_string();
        let proposal = request
            .purpose_proposals
            .as_ref()
            .and_then(|p| {
                p.get(&canonical_key)
                    .or_else(|| p.get(&path.to_string_lossy().to_string()))
            })
            .map(String::as_str);
        match store.catalog_discovered_repository(
            &format!("repo-{}-{}", now_millis(), index),
            &canonical_path,
            proposal,
            now_millis(),
        ) {
            Ok(repository) => repositories.push(repository),
            Err(error) => errors.push(format!("{}: {error}", path.display())),
        }
    }
    Ok(RepositoryScanResult {
        repositories,
        errors,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RepositoryAttachCommand {
    workspace_id: String,
    repository_id: String,
    checkout_path: String,
    branch: String,
    checkout_mode: management::CheckoutMode,
}

#[tauri::command]
fn repository_attach(
    store: State<'_, ManagementStore>,
    request: RepositoryAttachCommand,
) -> Result<(), String> {
    let binding = management::WorkspaceRepositoryBinding {
        workspace_id: request.workspace_id,
        repository_id: request.repository_id,
        checkout_path: request.checkout_path,
        checkout_mode: request.checkout_mode,
        branch: request.branch,
        verification_status: management::VerificationStatus::Verified,
        created_at: now_millis(),
    };
    match store.validate_and_save_workspace_repository_binding(&binding) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = store.record_workspace_repository_failure(&binding);
            Err(error.to_string())
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkspaceSessionCreateCommand {
    workspace_id: String,
    prompt: Option<String>,
    model: ModelCommand,
}

#[tauri::command]
fn workspace_session_create(
    app: AppHandle,
    runtime: State<'_, opencode::Runtime>,
    store: State<'_, ManagementStore>,
    request: WorkspaceSessionCreateCommand,
) -> Result<management::SessionRecord, String> {
    let workspace = store
        .get_workspace(&request.workspace_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Workspace not found".to_owned())?;
    if workspace.kind != management::WorkspaceKind::Regular
        || workspace.status != management::WorkspaceStatus::Active
    {
        return Err("Workspace is not active.".into());
    }
    let bindings = store
        .list_workspace_repository_bindings(&workspace.id)
        .map_err(|e| e.to_string())?;
    let context_paths = management::resolve_workspace_context(
        std::path::Path::new(&workspace.home_path),
        &bindings,
    );
    let context_note = context_paths
        .iter()
        .skip(1)
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>();
    let prompt = request
        .prompt
        .filter(|p| !p.trim().is_empty())
        .map(|prompt| {
            if context_note.is_empty() {
                prompt
            } else {
                format!(
                    "{prompt}\n\nVerified workspace repository checkouts:\n{}",
                    context_note.join("\n")
                )
            }
        });
    let session_response = runtime.create_session(
        &workspace.name,
        std::path::Path::new(&workspace.home_path),
        request.model.clone().runtime_model(),
    )?;
    let session_id = session_id_from_response(&session_response)?;
    let session = store
        .create_session_with_model(
            &management::NewSession {
                open_code_session_id: session_id.clone(),
                owner: management::SessionOwner::Workspace(workspace.id),
                directory: workspace.home_path.clone(),
                last_known_status: "starting".into(),
                created_at: now_millis(),
            },
            &model_key(&request.model),
        )
        .map_err(|e| e.to_string())?;
    // Validate the persisted association before attaching or prompting.  In
    // particular, a stale/mismatched model must not start a TUI or generate.
    ensure_session_model(&session, &request.model)?;
    if let Err(error) =
        runtime.attach_terminal(app, &session_id, std::path::Path::new(&session.directory))
    {
        return Err(mark_session_failed(&store, &session_id, error));
    }
    if let Some(prompt) = prompt {
        if let Err(error) = (|| {
            ensure_session_model(&session, &request.model)?;
            runtime.wait_for_terminal_ready(&session_id)?;
            store
                .claim_initial_prompt(&session_id)
                .map_err(|e| e.to_string())?;
            runtime.set_session_model(&session_id, request.model.clone().runtime_model())?;
            runtime.prompt(&session_id, &prompt)
        })() {
            return Err(mark_prompt_failed(&store, &session_id, error));
        }
        if let Err(error) = store.update_session_status(&session_id, "running", now_millis()) {
            return Err(mark_prompt_failed(&store, &session_id, error.to_string()));
        }
    }
    Ok(session)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TaskSessionCreateCommand {
    task_id: String,
    prompt: Option<String>,
    model: ModelCommand,
}

/// Start a second conversation for an existing active task. This deliberately
/// creates only a session row: task identity and all conversation histories
/// remain separate.
#[tauri::command]
fn task_session_create(
    app: AppHandle,
    runtime: State<'_, opencode::Runtime>,
    store: State<'_, ManagementStore>,
    request: TaskSessionCreateCommand,
) -> Result<management::SessionRecord, String> {
    let task = store
        .get_task(&request.task_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Task not found".to_owned())?;
    if task.status != management::TaskStatus::Active {
        return Err("Completed tasks cannot receive new sessions.".into());
    }
    let bindings = store
        .list_task_repository_bindings(&task.id)
        .map_err(|e| e.to_string())?;
    let context =
        management::resolve_task_context(std::path::Path::new(&task.home_path), &bindings);
    let prompt = request
        .prompt
        .filter(|value| !value.trim().is_empty())
        .map(|value| {
            if context.len() <= 1 {
                value
            } else {
                format!(
                    "{value}\n\nVerified task worktrees:\n{}",
                    context
                        .iter()
                        .skip(1)
                        .map(|p| p.display().to_string())
                        .collect::<Vec<_>>()
                        .join("\n")
                )
            }
        });
    let response = runtime.create_session(
        &task.name,
        std::path::Path::new(&task.home_path),
        request.model.clone().runtime_model(),
    )?;
    let session_id = session_id_from_response(&response)?;
    let session = store
        .create_session_with_model(
            &management::NewSession {
                open_code_session_id: session_id.clone(),
                owner: management::SessionOwner::Task(task.id),
                directory: task.home_path.clone(),
                last_known_status: "starting".into(),
                created_at: now_millis(),
            },
            &model_key(&request.model),
        )
        .map_err(|e| e.to_string())?;
    ensure_session_model(&session, &request.model)?;
    if let Err(error) =
        runtime.attach_terminal(app, &session_id, std::path::Path::new(&session.directory))
    {
        return Err(mark_session_failed(&store, &session_id, error));
    }
    if let Some(prompt) = prompt {
        if let Err(error) = (|| {
            ensure_session_model(&session, &request.model)?;
            runtime.wait_for_terminal_ready(&session_id)?;
            store
                .claim_initial_prompt(&session_id)
                .map_err(|e| e.to_string())?;
            runtime.set_session_model(&session_id, request.model.runtime_model())?;
            runtime.prompt(&session_id, &prompt)
        })() {
            return Err(mark_prompt_failed(&store, &session_id, error));
        }
        if let Err(error) = store.update_session_status(&session_id, "running", now_millis()) {
            return Err(mark_prompt_failed(&store, &session_id, error.to_string()));
        }
    }
    Ok(session)
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn mark_session_failed(store: &ManagementStore, session_id: &str, error: String) -> String {
    match store.update_session_status(session_id, "failed", now_millis()) {
        Ok(_) => error,
        Err(persistence) => format!("{error}; recovery persistence failed: {persistence}"),
    }
}

fn ensure_session_model(
    session: &management::SessionRecord,
    model: &ModelCommand,
) -> Result<(), String> {
    let expected = model_key(model);
    match session.selected_model.as_deref() {
        Some(actual) if actual == expected => Ok(()),
        Some(actual) => Err(format!(
            "Selected model changed from `{actual}` to `{expected}`; start was rejected."
        )),
        None => Err(
            "The session has no persisted model; it must be reconciled before prompting.".into(),
        ),
    }
}

fn mark_prompt_failed(store: &ManagementStore, session_id: &str, error: String) -> String {
    match store.mark_initial_prompt_failed(session_id, now_millis()) {
        Ok(_) => error,
        Err(persistence) => format!("{error}; recovery persistence failed: {persistence}"),
    }
}

fn request_id() -> String {
    static NEXT_REQUEST: AtomicU64 = AtomicU64::new(0);
    format!(
        "quick-{}-{}",
        now_millis(),
        NEXT_REQUEST.fetch_add(1, Ordering::Relaxed)
    )
}

fn session_id_from_response(value: &serde_json::Value) -> Result<String, String> {
    value
        .get("data")
        .and_then(|data| data.get("id"))
        .and_then(|id| id.as_str())
        .or_else(|| value.get("id").and_then(|id| id.as_str()))
        .map(str::to_owned)
        .ok_or_else(|| "OpenCode's session response did not include an ID.".into())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct QuickRequestCreateCommand {
    prompt: String,
    model: ModelCommand,
}

#[tauri::command]
fn quick_request_create(
    app: AppHandle,
    runtime: State<'_, opencode::Runtime>,
    store: State<'_, ManagementStore>,
    state: State<'_, AppState>,
    request: QuickRequestCreateCommand,
) -> Result<management::QuickRequestRecord, String> {
    let prompt = request.prompt.trim().to_owned();
    if prompt.is_empty() {
        return Err("Enter a prompt first.".into());
    }
    let mut busy = state
        .quick_request_in_flight
        .lock()
        .map_err(|_| "Quick Request guard unavailable".to_owned())?;
    if *busy {
        return Err("A Quick Request is already being submitted.".into());
    }
    *busy = true;
    let result = (|| {
        let now = now_millis();
        let workspace = store
            .ensure_quick_requests_workspace(now)
            .map_err(|e| e.to_string())?;
        let directory = std::path::PathBuf::from(&workspace.home_path);
        std::fs::create_dir_all(&directory)
            .map_err(|e| format!("Could not create shared Quick Requests directory: {e}"))?;
        let selected_model = model_key(&request.model);
        let model = request.model.clone().runtime_model();
        let title = format!(
            "Quick Request: {}",
            prompt.chars().take(48).collect::<String>()
        );
        let response = runtime.create_session(&title, &directory, model.clone())?;
        let session_id = session_id_from_response(&response)?;
        let task_id = request_id();
        let task = management::NewTask {
            id: task_id.clone(),
            workspace_id: workspace.id,
            name: title.clone(),
            slug: task_id.clone(),
            description: Some(prompt.clone()),
            setup_status: management::TaskSetupStatus::Ready,
            created_at: now,
        };
        let session = management::NewSession {
            open_code_session_id: session_id.clone(),
            owner: management::SessionOwner::Task(task_id),
            directory: directory.to_string_lossy().into(),
            last_known_status: "starting".into(),
            created_at: now,
        };
        let record = store
            .create_quick_request_with_session_and_model(&task, &session, &selected_model)
            .map_err(|e| e.to_string())?;
        // This ordering is an invariant: attach/readiness precedes model bind
        // and prompt, so a prompt cannot race a missing visible terminal.
        if let Err(error) = runtime.attach_terminal(app.clone(), &session_id, &directory) {
            return Err(mark_session_failed(&store, &session_id, error));
        }
        Ok(record)
    })();
    *busy = false;
    result
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct QuickRequestStartCommand {
    request_id: String,
    model: ModelCommand,
}

/// The second phase is intentionally explicit: the WebView mounts xterm and
/// registers its listeners after create returns, then asks Rust to generate.
#[tauri::command]
fn quick_request_start_prompt(
    runtime: State<'_, opencode::Runtime>,
    store: State<'_, ManagementStore>,
    request: QuickRequestStartCommand,
) -> Result<(), String> {
    let record = store
        .get_task(&request.request_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Quick Request not found".to_owned())?;
    if record.quick_request.is_none() {
        return Err("Record is not a Quick Request".into());
    }
    let session = store
        .list_sessions(&management::SessionOwner::Task(record.id.clone()))
        .map_err(|e| e.to_string())?
        .into_iter()
        .next()
        .ok_or_else(|| "Quick Request session not found".to_owned())?;
    if session.last_known_status != "starting" {
        return Err(format!(
            "Quick Request is not startable from `{}`.",
            session.last_known_status
        ));
    }
    let model = request.model.clone().runtime_model();
    let result = (|| {
        ensure_session_model(&session, &request.model)?;
        if !runtime.terminal_attached(&session.open_code_session_id) {
            return Err("The Quick Request terminal is not attached.".to_owned());
        }
        runtime.wait_for_terminal_ready(&session.open_code_session_id)?;
        store
            .claim_initial_prompt(&session.open_code_session_id)
            .map_err(|e| e.to_string())?;
        runtime.set_session_model(&session.open_code_session_id, model)?;
        runtime.prompt(
            &session.open_code_session_id,
            record.description.as_deref().unwrap_or(""),
        )
    })();
    match result {
        Ok(()) => {
            match store.update_session_status(
                &session.open_code_session_id,
                "running",
                now_millis(),
            ) {
                Ok(_) => Ok(()),
                Err(error) => Err(mark_prompt_failed(
                    &store,
                    &session.open_code_session_id,
                    error.to_string(),
                )),
            }
        }
        Err(error) => Err(mark_prompt_failed(
            &store,
            &session.open_code_session_id,
            error,
        )),
    }
}

#[tauri::command]
fn quick_request_retry_prompt(
    runtime: State<'_, opencode::Runtime>,
    store: State<'_, ManagementStore>,
    request: QuickRequestStartCommand,
) -> Result<management::SessionRecord, String> {
    let record = store
        .get_task(&request.request_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Quick Request not found".to_owned())?;
    if record.quick_request.is_none() {
        return Err("Record is not a Quick Request".into());
    }
    let session = store
        .list_sessions(&management::SessionOwner::Task(record.id))
        .map_err(|e| e.to_string())?
        .into_iter()
        .next()
        .ok_or_else(|| "Quick Request session not found".to_owned())?;
    let model = request.model.clone();
    ensure_session_model(&session, &model)?;
    let validated = store
        .validate_session_context(
            &session.open_code_session_id,
            std::path::Path::new(&session.directory),
        )
        .map_err(|e| e.to_string())?;
    if !runtime.terminal_attached(&validated.open_code_session_id) {
        return Err("The Quick Request terminal is not attached.".into());
    }
    runtime.wait_for_terminal_ready(&validated.open_code_session_id)?;
    let claimed = store
        .claim_retry_initial_prompt(&validated.open_code_session_id, now_millis())
        .map_err(|e| e.to_string())?;
    let result = (|| {
        ensure_session_model(&claimed, &model)?;
        runtime.set_session_model(&claimed.open_code_session_id, model.runtime_model())?;
        runtime.prompt(
            &claimed.open_code_session_id,
            record.description.as_deref().unwrap_or(""),
        )
    })();
    match result {
        Ok(()) => store
            .update_session_status(&claimed.open_code_session_id, "running", now_millis())
            .map_err(|e| e.to_string()),
        Err(error) => Err(mark_prompt_failed(
            &store,
            &claimed.open_code_session_id,
            error,
        )),
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct QuickRequestIdCommand {
    request_id: String,
}

#[tauri::command]
fn quick_request_follow_up(
    runtime: State<'_, opencode::Runtime>,
    store: State<'_, ManagementStore>,
    request: QuickRequestIdCommand,
    data: String,
) -> Result<(), String> {
    let task = store
        .get_task(&request.request_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Quick Request not found".to_owned())?;
    if task.quick_request.is_none() {
        return Err("Record is not a Quick Request".into());
    }
    let session = store
        .list_sessions(&management::SessionOwner::Task(task.id))
        .map_err(|e| e.to_string())?
        .into_iter()
        .next()
        .ok_or_else(|| "Quick Request session not found".to_owned())?;
    runtime.write_terminal(&session.open_code_session_id, &data)
}

#[tauri::command]
fn quick_request_restore(
    app: AppHandle,
    runtime: State<'_, opencode::Runtime>,
    store: State<'_, ManagementStore>,
    request: QuickRequestIdCommand,
) -> Result<management::QuickRequestRecord, String> {
    let record = store
        .get_task(&request.request_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Quick Request not found".to_owned())?;
    if record.quick_request.is_none() {
        return Err("Record is not a Quick Request".into());
    }
    let session = store
        .list_sessions(&management::SessionOwner::Task(record.id.clone()))
        .map_err(|e| e.to_string())?
        .into_iter()
        .next()
        .ok_or_else(|| "Quick Request session not found".to_owned())?;
    if let Err(error) = store.validate_session_context(
        &session.open_code_session_id,
        std::path::Path::new(&session.directory),
    ) {
        let message = mark_session_failed(&store, &session.open_code_session_id, error.to_string());
        return Err(format!("Quick Request restore rejected: {message}"));
    }
    if !runtime.terminal_attached(&session.open_code_session_id) {
        runtime.attach_terminal(
            app,
            &session.open_code_session_id,
            std::path::Path::new(&session.directory),
        )?;
        runtime.wait_for_terminal_ready(&session.open_code_session_id)?;
    }
    Ok(management::QuickRequestRecord {
        task: record,
        session: Some(session),
    })
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct QuickRequestListCommand {
    #[serde(default)]
    history: bool,
}

#[tauri::command]
fn quick_request_list(
    store: State<'_, ManagementStore>,
    request: QuickRequestListCommand,
) -> Result<Vec<management::QuickRequestRecord>, String> {
    store
        .list_quick_requests(request.history)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn opencode_models(
    state: State<'_, opencode::Runtime>,
) -> Result<Vec<opencode::ModelCatalogEntry>, String> {
    opencode_models_command(&state)
}

/// The production implementation behind the `opencode_models` Tauri command.
///
/// Keeping this tiny adapter public gives integration tests the same command
/// path without exposing Tauri's `State` wrapper or the command itself.
pub fn opencode_models_command(
    runtime: &opencode::Runtime,
) -> Result<Vec<opencode::ModelCatalogEntry>, String> {
    runtime.enabled_models()
}

#[tauri::command]
fn quick_request_dismiss(
    store: State<'_, ManagementStore>,
    request: QuickRequestIdCommand,
) -> Result<management::Task, String> {
    store
        .dismiss_quick_request(&request.request_id, now_millis())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn quick_request_expire(
    runtime: State<'_, opencode::Runtime>,
    store: State<'_, ManagementStore>,
    request: QuickRequestIdCommand,
) -> Result<management::Task, String> {
    let session = store
        .list_sessions(&management::SessionOwner::Task(request.request_id.clone()))
        .map_err(|e| e.to_string())?
        .into_iter()
        .next()
        .ok_or_else(|| "Quick Request session not found".to_owned())?;
    if runtime
        .session_status(&session.open_code_session_id)?
        .active
        .is_some()
    {
        return store
            .get_task(&request.request_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Quick Request not found".to_owned());
    }
    store
        .expire_quick_request(&request.request_id, now_millis())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn quick_request_promote(
    store: State<'_, ManagementStore>,
    request: QuickRequestPromoteCommand,
) -> Result<management::Task, String> {
    let task_name = store
        .get_task(&request.request_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Quick Request not found".to_owned())?;
    if task_name.quick_request.is_none() {
        return Err("Record is not a Quick Request".into());
    }
    let mut newly_created_workspace = None;
    let workspace_id = if let Some(workspace_id) = request.target_workspace_id {
        let workspace = store
            .get_workspace(&workspace_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Promotion target workspace not found".to_owned())?;
        workspace.id
    } else {
        let name = request
            .new_workspace_name
            .filter(|name| !name.trim().is_empty())
            .ok_or_else(|| {
                "Choose an existing workspace or provide a new workspace name.".to_owned()
            })?;
        let id = format!("workspace-{}", request_id());
        let slug = store
            .suggest_workspace_slug(&name)
            .map_err(|e| e.to_string())?;
        store
            .create_workspace(&management::NewWorkspace {
                id: id.clone(),
                name: name.trim().to_owned(),
                slug: slug.clone(),
                description: None,
                kind: management::WorkspaceKind::Regular,
                created_at: now_millis(),
            })
            .map_err(|e| e.to_string())?;
        newly_created_workspace = Some(id.clone());
        id
    };
    let promotion = (|| {
        let slug = if let Some(slug) = request.target_slug {
            slug
        } else {
            store
                .suggest_task_slug(&workspace_id, &task_name.name)
                .map_err(|e| e.to_string())?
        };
        store
            .promote_quick_request(&request.request_id, &workspace_id, &slug, now_millis())
            .map_err(|e| e.to_string())
    })();
    match promotion {
        Ok(task) => Ok(task),
        Err(error) => {
            if let Some(workspace_id) = newly_created_workspace {
                if let Err(rollback) = store.rollback_new_workspace(&workspace_id) {
                    return Err(format!("{error}; promotion cleanup failed: {rollback}"));
                }
            }
            Err(error)
        }
    }
}

#[tauri::command]
fn opencode_terminal_attach(
    app: AppHandle,
    state: State<'_, opencode::Runtime>,
    store: State<'_, ManagementStore>,
    session_id: String,
    directory: String,
) -> Result<terminal::TerminalAttachResult, String> {
    store
        .validate_session_context(&session_id, std::path::Path::new(&directory))
        .map_err(|e| e.to_string())?;
    state.attach_terminal(app, &session_id, std::path::Path::new(&directory))?;
    Ok(state.replay_terminal(&session_id))
}

#[tauri::command]
fn opencode_terminal_replay(
    state: State<'_, opencode::Runtime>,
    session_id: String,
) -> terminal::TerminalAttachResult {
    state.replay_terminal(&session_id)
}

/// Resolve and attach a persisted session in Rust before the renderer mounts
/// its terminal surface. Restore never creates a new conversation or prompt.
#[tauri::command]
fn opencode_session_restore(
    app: AppHandle,
    runtime: State<'_, opencode::Runtime>,
    store: State<'_, ManagementStore>,
    session_id: String,
) -> Result<management::SessionRecord, String> {
    let session = store
        .get_session(&session_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Persisted OpenCode session not found".to_owned())?;
    store
        .validate_session_context(&session_id, std::path::Path::new(&session.directory))
        .map_err(|e| e.to_string())?;
    runtime.restore_terminal(
        app.clone(),
        &session.open_code_session_id,
        std::path::Path::new(&session.directory),
    )?;
    Ok(session)
}

#[tauri::command]
fn opencode_terminal_start(
    app: AppHandle,
    state: State<'_, opencode::Runtime>,
    store: State<'_, ManagementStore>,
    session_id: String,
    directory: String,
) -> Result<terminal::TerminalAttachResult, String> {
    opencode_terminal_attach(app, state, store, session_id, directory)
}

#[tauri::command]
fn opencode_terminal_write(
    state: State<'_, opencode::Runtime>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    state.write_terminal(&session_id, &data)
}

#[tauri::command]
fn opencode_terminal_resize(
    state: State<'_, opencode::Runtime>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.resize_terminal(&session_id, cols, rows)
}

#[tauri::command]
fn opencode_terminal_detach(
    _state: State<'_, opencode::Runtime>,
    _session_id: String,
) -> Result<(), String> {
    // Detach/hide is presentation-only. The PTY remains owned by Runtime.
    Ok(())
}

#[tauri::command]
fn opencode_terminal_cleanup(
    state: State<'_, opencode::Runtime>,
    session_id: String,
) -> Result<(), String> {
    state.cleanup_terminal(&session_id)
}

#[tauri::command]
fn opencode_runtime_info(
    state: State<'_, opencode::Runtime>,
) -> Result<opencode::RuntimeInfo, String> {
    state.ensure_started()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelCommand {
    pub provider_id: String,
    pub id: String,
}

impl ModelCommand {
    fn runtime_model(self) -> opencode::ModelReference {
        opencode::ModelReference {
            provider_id: self.provider_id,
            id: self.id,
        }
    }
}

fn model_key(model: &ModelCommand) -> String {
    format!("{}/{}", model.provider_id, model.id)
}

pub fn opencode_model_default_command(store: &ManagementStore) -> Result<ModelCommand, String> {
    let configured = store
        .get_setting("default_model")
        .map_err(|error| error.to_string())?
        .map(|setting| setting.value)
        .unwrap_or_else(|| management::DEFAULT_MODEL.to_owned());
    let (provider_id, id) = configured
        .split_once('/')
        .ok_or_else(|| format!("Invalid configured OpenCode model `{configured}`."))?;
    if provider_id.trim().is_empty() || id.trim().is_empty() {
        return Err(format!("Invalid configured OpenCode model `{configured}`."));
    }
    Ok(ModelCommand {
        provider_id: provider_id.to_owned(),
        id: id.to_owned(),
    })
}

#[tauri::command]
fn opencode_model_default(store: State<'_, ManagementStore>) -> Result<ModelCommand, String> {
    opencode_model_default_command(&store)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateSessionCommand {
    title: String,
    directory: String,
    model: ModelCommand,
}

#[tauri::command]
fn opencode_session_create(
    state: State<'_, opencode::Runtime>,
    request: CreateSessionCommand,
) -> Result<serde_json::Value, String> {
    state.create_session(
        &request.title,
        std::path::Path::new(&request.directory),
        request.model.runtime_model(),
    )
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SessionModelCommand {
    session_id: String,
    model: ModelCommand,
}

#[tauri::command]
fn opencode_session_model(
    state: State<'_, opencode::Runtime>,
    request: SessionModelCommand,
) -> Result<(), String> {
    state.set_session_model(&request.session_id, request.model.runtime_model())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SessionPromptCommand {
    session_id: String,
    prompt: String,
}

#[tauri::command]
fn opencode_session_prompt(
    state: State<'_, opencode::Runtime>,
    request: SessionPromptCommand,
) -> Result<(), String> {
    state.prompt(&request.session_id, &request.prompt)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PermissionReplyCommand {
    session_id: String,
    request_id: String,
    decision: String,
    message: Option<String>,
}

#[tauri::command]
fn opencode_permission_reply(
    state: State<'_, opencode::Runtime>,
    request: PermissionReplyCommand,
) -> Result<(), String> {
    state.reply_permission(
        &request.session_id,
        &request.request_id,
        &request.decision,
        request.message.as_deref(),
    )
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FormReplyCommand {
    session_id: String,
    request_id: String,
    answer: serde_json::Value,
}

#[tauri::command]
fn opencode_form_reply(
    state: State<'_, opencode::Runtime>,
    request: FormReplyCommand,
) -> Result<(), String> {
    state.reply_form(&request.session_id, &request.request_id, request.answer)
}

#[tauri::command]
fn opencode_form_cancel(
    state: State<'_, opencode::Runtime>,
    request: SessionRequestIdCommand,
) -> Result<(), String> {
    state.cancel_form(&request.session_id, &request.request_id)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SessionRequestIdCommand {
    session_id: String,
    request_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SessionHistoryCommand {
    session_id: String,
    #[serde(default = "history_order")]
    order: String,
    #[serde(default = "history_limit")]
    limit: u32,
}
fn history_order() -> String {
    "asc".to_owned()
}
fn history_limit() -> u32 {
    500
}

#[tauri::command]
fn opencode_session_history(
    state: State<'_, opencode::Runtime>,
    request: SessionHistoryCommand,
) -> Result<opencode::SessionHistory, String> {
    state.session_history(&request.session_id, &request.order, request.limit)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SessionCommand {
    session_id: String,
}

#[tauri::command]
fn opencode_session_status(
    state: State<'_, opencode::Runtime>,
    request: SessionCommand,
) -> Result<opencode::SessionStatus, String> {
    state.session_status(&request.session_id)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SessionReconcileCommand {
    session_id: String,
    cursor: Option<String>,
}

#[tauri::command]
fn opencode_session_reconcile(
    state: State<'_, opencode::Runtime>,
    store: State<'_, ManagementStore>,
    request: SessionReconcileCommand,
) -> Result<opencode::SessionReconciliation, String> {
    let result = state.reconcile_session(&request.session_id, request.cursor.as_deref())?;
    let status = match result.status {
        opencode::SessionApplicationStatus::Starting => "starting",
        opencode::SessionApplicationStatus::Running => "running",
        opencode::SessionApplicationStatus::WaitingForInput => "waiting_for_input",
        opencode::SessionApplicationStatus::ReadyForReview => "ready_for_review",
        opencode::SessionApplicationStatus::Reconnecting => "reconnecting",
        opencode::SessionApplicationStatus::Unknown => "unknown",
        opencode::SessionApplicationStatus::Failed => "failed",
    };
    let pending_json = serde_json::to_string(
        &serde_json::json!({"permissions": &result.permissions, "forms": &result.forms}),
    )
    .ok();
    store
        .update_session_reconciliation(
            &request.session_id,
            status,
            result.cursor.as_deref(),
            matches!(
                result.status,
                opencode::SessionApplicationStatus::Unknown
                    | opencode::SessionApplicationStatus::Reconnecting
            ),
            pending_json.as_deref(),
            now_millis(),
        )
        .map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
fn opencode_pending_inputs(
    state: State<'_, opencode::Runtime>,
    request: SessionCommand,
) -> Result<opencode::PendingInputs, String> {
    state.pending_inputs(&request.session_id)
}

#[tauri::command]
fn opencode_session_pending_inputs(
    state: State<'_, opencode::Runtime>,
    request: SessionCommand,
) -> Result<opencode::PendingInputs, String> {
    state.pending_inputs(&request.session_id)
}

#[tauri::command]
fn opencode_pending_inputs_all(
    runtime: State<'_, opencode::Runtime>,
    store: State<'_, ManagementStore>,
) -> Result<Vec<opencode::PendingInputs>, String> {
    store
        .list_all_sessions()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|session| runtime.pending_inputs(&session.open_code_session_id))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn initialized_app_state_returns_the_known_shell_command_result() {
        let info = AppState::initialized().shell_info();

        assert_eq!(info.app_name, "OpenCode Project Manager");
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
        assert_eq!(info.status, "ready");
        assert_eq!(
            info.message,
            "The Rust core and management storage are initialized."
        );
    }

    #[test]
    fn shell_command_response_keeps_the_serialized_frontend_contract() {
        let info = AppState::initialized().shell_info();

        assert_eq!(
            serde_json::to_value(info).unwrap(),
            json!({
                "appName": "OpenCode Project Manager",
                "version": env!("CARGO_PKG_VERSION"),
                "status": "ready",
                "message": "The Rust core and management storage are initialized."
            })
        );
    }

    #[test]
    fn default_model_command_reads_the_persisted_setting_and_serializes_frontend_fields() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("home");
        let temp = root.path().join("tmp");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::create_dir_all(&temp).unwrap();
        let store =
            ManagementStore::open_with_paths(root.path().join("state.sqlite"), home, temp).unwrap();

        let default = opencode_model_default_command(&store).unwrap();
        assert_eq!(
            serde_json::to_value(default).unwrap(),
            json!({ "providerId": "openai", "id": "gpt-6-luna" })
        );

        store
            .set_setting("default_model", "fixture/provider-model", 1)
            .unwrap();
        let configured = opencode_model_default_command(&store).unwrap();
        assert_eq!(configured.provider_id, "fixture");
        assert_eq!(configured.id, "provider-model");

        store.set_setting("default_model", "invalid", 2).unwrap();
        assert!(opencode_model_default_command(&store)
            .unwrap_err()
            .contains("Invalid configured OpenCode model"));
    }

    #[test]
    fn startup_storage_failure_is_serialized_as_unavailable_not_ready() {
        let info = AppState::storage_unavailable("migration fixture failed").shell_info();

        assert_eq!(info.status, "error");
        assert!(info.message.contains("migration fixture failed"));
        assert!(info.message.contains("Management features are unavailable"));
        assert_eq!(
            serde_json::to_value(info).unwrap(),
            json!({
                "appName": "OpenCode Project Manager",
                "version": env!("CARGO_PKG_VERSION"),
                "status": "error",
                "message": "Management storage could not be initialized: migration fixture failed. Management features are unavailable."
            })
        );
    }

    #[test]
    fn quick_request_ids_remain_unique_within_one_clock_tick() {
        assert_ne!(request_id(), request_id());
    }

    #[test]
    fn quick_start_command_keeps_model_and_request_identity_explicit() {
        let command = QuickRequestStartCommand {
            request_id: "quick-1".into(),
            model: ModelCommand {
                provider_id: "openai".into(),
                id: "gpt-6-luna".into(),
            },
        };
        assert_eq!(
            serde_json::to_value(command).unwrap(),
            json!({"requestId":"quick-1","model":{"providerId":"openai","id":"gpt-6-luna"}})
        );
    }

    #[test]
    fn task_session_model_mismatch_is_rejected_before_prompt_start() {
        let session = management::SessionRecord {
            open_code_session_id: "ses-task-model".into(),
            owner: management::SessionOwner::Task("task-1".into()),
            directory: "/tmp/task-1".into(),
            last_known_status: "starting".into(),
            created_at: 1,
            updated_at: 1,
            event_cursor: None,
            reconciliation_status: "unknown".into(),
            reconciliation_uncertain: false,
            pending_input_json: None,
            selected_model: Some("openai/gpt-6-luna".into()),
        };
        let mismatch = ModelCommand {
            provider_id: "openai".into(),
            id: "different-model".into(),
        };
        let error = ensure_session_model(&session, &mismatch).unwrap_err();
        assert!(error.contains("Selected model changed"));
    }

    #[test]
    fn opencode_command_adapters_preserve_camel_case_ids_and_payloads() {
        let cases = [
            (
                serde_json::to_value(CreateSessionCommand {
                    title: "t".into(),
                    directory: "/x".into(),
                    model: ModelCommand {
                        provider_id: "p".into(),
                        id: "m".into(),
                    },
                })
                .unwrap(),
                json!({"title":"t","directory":"/x","model":{"providerId":"p","id":"m"}}),
            ),
            (
                serde_json::to_value(SessionModelCommand {
                    session_id: "ses".into(),
                    model: ModelCommand {
                        provider_id: "p".into(),
                        id: "m".into(),
                    },
                })
                .unwrap(),
                json!({"sessionId":"ses","model":{"providerId":"p","id":"m"}}),
            ),
            (
                serde_json::to_value(SessionPromptCommand {
                    session_id: "ses".into(),
                    prompt: "go".into(),
                })
                .unwrap(),
                json!({"sessionId":"ses","prompt":"go"}),
            ),
            (
                serde_json::to_value(PermissionReplyCommand {
                    session_id: "ses".into(),
                    request_id: "r".into(),
                    decision: "once".into(),
                    message: None,
                })
                .unwrap(),
                json!({"sessionId":"ses","requestId":"r","decision":"once","message":null}),
            ),
            (
                serde_json::to_value(FormReplyCommand {
                    session_id: "ses".into(),
                    request_id: "f".into(),
                    answer: json!({"name":"Ada"}),
                })
                .unwrap(),
                json!({"sessionId":"ses","requestId":"f","answer":{"name":"Ada"}}),
            ),
            (
                serde_json::to_value(SessionRequestIdCommand {
                    session_id: "ses".into(),
                    request_id: "f".into(),
                })
                .unwrap(),
                json!({"sessionId":"ses","requestId":"f"}),
            ),
            (
                serde_json::to_value(SessionHistoryCommand {
                    session_id: "ses".into(),
                    order: "asc".into(),
                    limit: 2,
                })
                .unwrap(),
                json!({"sessionId":"ses","order":"asc","limit":2}),
            ),
            (
                serde_json::to_value(SessionCommand {
                    session_id: "ses".into(),
                })
                .unwrap(),
                json!({"sessionId":"ses"}),
            ),
            (
                serde_json::to_value(SessionReconcileCommand {
                    session_id: "ses".into(),
                    cursor: Some("17".into()),
                })
                .unwrap(),
                json!({"sessionId":"ses","cursor":"17"}),
            ),
        ];
        for (actual, expected) in cases {
            assert_eq!(actual, expected);
        }
    }

    #[test]
    fn command_dtos_reject_unknown_wire_fields() {
        let valid: SessionCommand = serde_json::from_value(json!({"sessionId":"ses"})).unwrap();
        assert_eq!(valid.session_id, "ses");
        let invalid = serde_json::from_value::<SessionCommand>(
            json!({"sessionId":"ses", "unexpected": true}),
        );
        assert!(invalid.is_err());

        let valid_list: QuickRequestListCommand =
            serde_json::from_value(json!({"history": true})).unwrap();
        assert!(valid_list.history);
        let invalid_list = serde_json::from_value::<QuickRequestListCommand>(
            json!({"history": false, "unexpected": true}),
        );
        assert!(invalid_list.is_err());
    }

    #[test]
    fn command_error_results_serialize_as_explicit_errors() {
        let error: Result<serde_json::Value, String> = Err("server rejected request".into());
        assert_eq!(
            serde_json::to_value(error).unwrap(),
            json!({"Err":"server rejected request"})
        );
    }
}
