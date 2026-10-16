//! Emits representative values produced by the real Rust response DTOs.
//! Node integration tests feed these values through the production command
//! contract validator so frontend schemas cannot drift from Rust serialization.
use opencode_project_manager_lib::management::{
    quick_requests_directory, ManagementStore, NewSession, NewTask, NewWorkspace, SessionOwner,
    TaskSetupStatus, WorkspaceKind,
};
use opencode_project_manager_lib::opencode::{
    ActiveSession, Cursors, PendingInputs, SessionApplicationStatus, SessionHistory,
    SessionReconciliation, SessionStatus,
};
use opencode_project_manager_lib::opencode_model_default_command;
use serde_json::{json, Value};
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

fn main() {
    match run() {
        Ok(output) => println!("{}", serde_json::to_string(&output).unwrap()),
        Err(error) => {
            eprintln!("wire-contract harness failed: {error}");
            std::process::exit(1);
        }
    }
}

fn run() -> Result<Value, String> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "opencode-wire-contract-{}-{nonce}",
        std::process::id()
    ));
    fs::create_dir_all(root.join("home")).map_err(|error| error.to_string())?;
    fs::create_dir_all(root.join("tmp")).map_err(|error| error.to_string())?;

    let result = build_output(&root);
    let cleanup = fs::remove_dir_all(&root).map_err(|error| error.to_string());
    match (result, cleanup) {
        (Ok(output), Ok(())) => Ok(output),
        (Err(error), _) => Err(error),
        (Ok(_), Err(error)) => Err(error),
    }
}

fn build_output(root: &std::path::Path) -> Result<Value, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as i64;
    let temp_root = root.join("tmp");
    let store =
        ManagementStore::open_with_paths(root.join("state.sqlite"), root.join("home"), &temp_root)
            .map_err(|error| error.to_string())?;
    let quick_workspace = store
        .ensure_quick_requests_workspace(10)
        .map_err(|error| error.to_string())?;
    let workspace = store
        .create_workspace(&NewWorkspace {
            id: "wire-workspace".into(),
            name: "Wire workspace".into(),
            slug: "wire-workspace".into(),
            description: Some("contract sample".into()),
            kind: WorkspaceKind::Regular,
            created_at: 11,
        })
        .map_err(|error| error.to_string())?;
    let workspace_session_id = "ses_wire_workspace_pending";
    let workspace_session = NewSession {
        open_code_session_id: workspace_session_id.into(),
        owner: SessionOwner::Workspace(workspace.id.clone()),
        directory: workspace.home_path.clone(),
        last_known_status: "starting".into(),
        created_at: 11,
    };
    store
        .create_session_with_model(&workspace_session, "openai/gpt-6-luna")
        .map_err(|error| error.to_string())?;

    let task = NewTask {
        id: "wire-quick-request".into(),
        workspace_id: quick_workspace.id.clone(),
        name: "Wire request".into(),
        slug: "wire-quick-request".into(),
        description: Some("contract sample".into()),
        setup_status: TaskSetupStatus::Ready,
        created_at: now,
    };
    let session_id = "ses_wire_contract";
    let session = NewSession {
        open_code_session_id: session_id.into(),
        owner: SessionOwner::Task(task.id.clone()),
        directory: quick_requests_directory(&root.join("home/OpenCode Projects"))
            .to_string_lossy()
            .into_owned(),
        last_known_status: "running".into(),
        created_at: now + 1,
    };
    store
        .create_quick_request_with_session_and_model(
            &task,
            &session,
            "openai/gpt-6-luna",
            "What's 2 + 2?",
        )
        .map_err(|error| error.to_string())?;

    let quick_requests = store
        .list_quick_requests(false)
        .map_err(|error| error.to_string())?;
    let tasks = store
        .list_tasks(&quick_workspace.id)
        .map_err(|error| error.to_string())?;
    let workspaces = store.list_workspaces().map_err(|error| error.to_string())?;
    let mut workspace_repositories = Vec::new();
    let mut sessions = Vec::new();
    for entry in &workspaces {
        sessions.extend(
            store
                .list_sessions(&SessionOwner::Workspace(entry.id.clone()))
                .map_err(|error| error.to_string())?,
        );
        for task in store
            .list_tasks(&entry.id)
            .map_err(|error| error.to_string())?
        {
            sessions.extend(
                store
                    .list_sessions(&SessionOwner::Task(task.id))
                    .map_err(|error| error.to_string())?,
            );
        }
        workspace_repositories.extend(
            store
                .list_workspace_repository_bindings(&entry.id)
                .map_err(|error| error.to_string())?,
        );
    }
    let default_model = opencode_model_default_command(&store)?;

    let history = SessionHistory {
        session_id: session_id.into(),
        data: vec![json!({"type":"user","id":"message-wire"})],
        cursor: Cursors {
            previous: None,
            next: Some("cursor-wire".into()),
        },
    };
    let active = ActiveSession {
        kind: "running".into(),
    };
    let status = SessionStatus {
        session_id: session_id.into(),
        active: Some(active.clone()),
        outcome: None,
        application_status: SessionApplicationStatus::Running,
    };
    let reconciliation = SessionReconciliation {
        session_id: session_id.into(),
        cursor: Some("cursor-wire".into()),
        history: history.clone(),
        active: Some(active),
        permissions: vec![],
        forms: vec![],
        durable_events: vec![],
        status: SessionApplicationStatus::WaitingForInput,
    };
    let pending_inputs = PendingInputs {
        session_id: session_id.into(),
        permissions: vec![],
        forms: vec![],
    };

    Ok(json!({
        "defaultModel": default_model,
        "workspace": workspace,
        "quickRequest": quick_requests.first().ok_or("Quick Request record missing")?,
        "taskCreate": {
            "task": quick_requests.first().ok_or("Quick Request record missing")?.task,
            "sessions": [quick_requests.first().ok_or("Quick Request record missing")?.session],
            "repositories": [],
        },
        "taskSetupStatus": {
            "task": quick_requests.first().ok_or("Quick Request record missing")?.task,
            "session": quick_requests.first().ok_or("Quick Request record missing")?.session,
            "repositories": [],
            "repositoryIds": null,
        },
        "quickRequestList": quick_requests,
        "workspaceNavigation": {
            "workspaces": workspaces,
            "tasks": tasks,
            "sessions": sessions,
            "workspaceRepositories": workspace_repositories,
            "quickRequests": store.list_quick_requests(false).map_err(|error| error.to_string())?,
        },
        "sessionHistory": history,
        "sessionStatus": status,
        "sessionReconciliation": reconciliation,
        "pendingInputs": pending_inputs,
    }))
}
