//! Deterministic production vertical checks.  These deliberately cross the
//! management service and its SQLite/filesystem boundary; live OpenCode/TUI
//! and Wayland checks remain separate acceptance work.
use opencode_project_manager_lib::management::{
    quick_requests_directory, ManagementStore, NewSession, NewTask, NewWorkspace, SessionOwner,
    TaskSetupStatus, WorkspaceKind,
};
use tempfile::tempdir;

struct Fixture {
    _root: tempfile::TempDir,
    store: ManagementStore,
    quick_workspace: String,
    regular_workspace: String,
}

impl Fixture {
    fn new() -> Self {
        let root = tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("home")).unwrap();
        std::fs::create_dir_all(root.path().join("tmp")).unwrap();
        let store = ManagementStore::open_with_paths(
            root.path().join("state.sqlite"),
            root.path().join("home"),
            root.path().join("tmp"),
        )
        .unwrap();
        let quick = store.ensure_quick_requests_workspace(1).unwrap();
        let regular = store
            .create_workspace(&NewWorkspace {
                id: "workspace-1".into(),
                name: "Workspace".into(),
                slug: "workspace".into(),
                description: None,
                kind: WorkspaceKind::Regular,
                created_at: 1,
            })
            .unwrap();
        Self {
            _root: root,
            store,
            quick_workspace: quick.id,
            regular_workspace: regular.id,
        }
    }

    fn quick_task(&self, id: &str) -> (String, String) {
        let task_id = id.to_owned();
        let directory = quick_requests_directory(&self._root.path().join("tmp"));
        let task = NewTask {
            id: task_id.clone(),
            workspace_id: self.quick_workspace.clone(),
            name: "Quick request".into(),
            slug: id.into(),
            description: Some("hello".into()),
            setup_status: TaskSetupStatus::Ready,
            created_at: 1,
        };
        let session_id = format!("session-{id}");
        let session = NewSession {
            open_code_session_id: session_id.clone(),
            owner: SessionOwner::Task(task_id.clone()),
            directory: directory.to_string_lossy().into(),
            last_known_status: "starting".into(),
            created_at: 2,
        };
        self.store
            .create_quick_request_with_session_and_model(&task, &session, "openai/gpt-6-luna")
            .unwrap();
        (task_id, session_id)
    }
}

#[test]
fn quick_request_create_start_restore_crosses_store_and_exact_session_context() {
    let fixture = Fixture::new();
    let (task_id, session_id) = fixture.quick_task("quick-1");
    let listed = fixture.store.list_quick_requests(false).unwrap();
    assert_eq!(
        listed[0].session.as_ref().unwrap().open_code_session_id,
        session_id
    );
    let wire = serde_json::to_value(&listed[0]).unwrap();
    assert_eq!(wire["task"]["workspaceId"], fixture.quick_workspace);
    assert!(wire["task"].get("workspace_id").is_none());
    assert_eq!(wire["task"]["quickRequest"]["createdAt"], 1);
    assert!(wire["task"]["quickRequest"].get("created_at").is_none());
    assert_eq!(wire["session"]["openCodeSessionId"], session_id);
    assert!(wire["session"].get("open_code_session_id").is_none());
    assert_eq!(
        wire["session"]["owner"],
        serde_json::json!({
            "owner_type": "task",
            "owner_id": "quick-1"
        })
    );
    fixture
        .store
        .update_session_status(&session_id, "running", 3)
        .unwrap();
    let restored = fixture
        .store
        .validate_session_context(
            &session_id,
            std::path::Path::new(&listed[0].session.as_ref().unwrap().directory),
        )
        .unwrap();
    assert_eq!(restored.owner, SessionOwner::Task(task_id));
}

#[test]
fn workspace_session_start_and_task_session_use_distinct_owner_contexts() {
    let fixture = Fixture::new();
    let workspace = fixture
        .store
        .get_workspace(&fixture.regular_workspace)
        .unwrap()
        .unwrap();
    let workspace_session = NewSession {
        open_code_session_id: "workspace-session".into(),
        owner: SessionOwner::Workspace(workspace.id.clone()),
        directory: workspace.home_path.clone(),
        last_known_status: "starting".into(),
        created_at: 2,
    };
    fixture.store.create_session(&workspace_session).unwrap();
    let task = fixture
        .store
        .create_task(&NewTask {
            id: "task-1".into(),
            workspace_id: workspace.id.clone(),
            name: "Task".into(),
            slug: "task".into(),
            description: Some("implement".into()),
            setup_status: TaskSetupStatus::Ready,
            created_at: 3,
        })
        .unwrap();
    let task_session = NewSession {
        open_code_session_id: "task-session".into(),
        owner: SessionOwner::Task(task.id),
        directory: task.home_path.clone(),
        last_known_status: "starting".into(),
        created_at: 4,
    };
    fixture.store.create_session(&task_session).unwrap();
    assert_ne!(workspace_session.directory, task_session.directory);
    assert_eq!(
        fixture
            .store
            .list_sessions(&SessionOwner::Workspace(workspace.id))
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn task_setup_registration_and_reconcile_preserve_itemized_owner_state() {
    let fixture = Fixture::new();
    let task = fixture
        .store
        .create_task(&NewTask {
            id: "task-setup".into(),
            workspace_id: fixture.regular_workspace.clone(),
            name: "Setup".into(),
            slug: "setup".into(),
            description: Some("setup".into()),
            setup_status: TaskSetupStatus::InProgress,
            created_at: 1,
        })
        .unwrap();
    let session = fixture
        .store
        .create_session(&NewSession {
            open_code_session_id: "setup-session".into(),
            owner: SessionOwner::Task(task.id.clone()),
            directory: task.home_path.clone(),
            last_known_status: "starting".into(),
            created_at: 2,
        })
        .unwrap();
    fixture
        .store
        .bind_task_setup_operation(&task.id, "operation-1", &session.open_code_session_id)
        .unwrap();
    fixture
        .store
        .update_session_reconciliation(
            &session.open_code_session_id,
            "unknown",
            Some("7"),
            true,
            Some("{\"forms\":[]}"),
            3,
        )
        .unwrap();
    let current = fixture
        .store
        .get_session(&session.open_code_session_id)
        .unwrap()
        .unwrap();
    assert_eq!(current.reconciliation_uncertain, true);
    assert_eq!(
        fixture
            .store
            .get_task(&task.id)
            .unwrap()
            .unwrap()
            .setup_operation_id
            .as_deref(),
        Some("operation-1")
    );
}

#[test]
fn task_completion_queues_cleanup_without_reopening_or_losing_session() {
    let fixture = Fixture::new();
    let task = fixture
        .store
        .create_task_with_session(
            &NewTask {
                id: "task-complete".into(),
                workspace_id: fixture.regular_workspace.clone(),
                name: "Done".into(),
                slug: "done".into(),
                description: None,
                setup_status: TaskSetupStatus::Ready,
                created_at: 1,
            },
            &NewSession {
                open_code_session_id: "done-session".into(),
                owner: SessionOwner::Task("task-complete".into()),
                directory: "/tmp/task-complete".into(),
                last_known_status: "running".into(),
                created_at: 2,
            },
        )
        .unwrap();
    let completed = fixture
        .store
        .complete_task_and_queue_cleanup(&task.id, 4)
        .unwrap();
    assert_eq!(
        completed.status,
        opencode_project_manager_lib::management::TaskStatus::Completed
    );
    assert!(
        fixture
            .store
            .list_sessions(&SessionOwner::Task(task.id.clone()))
            .unwrap()
            .len()
            == 1
    );
    assert!(fixture
        .store
        .complete_task_and_queue_cleanup(&task.id, 5)
        .is_err());
}

#[test]
fn promotion_preserves_quick_identity_and_history_but_changes_future_owner_context() {
    let fixture = Fixture::new();
    let (task_id, session_id) = fixture.quick_task("quick-promote");
    let promoted = fixture
        .store
        .promote_quick_request(&task_id, &fixture.regular_workspace, "promoted", 5)
        .unwrap();
    assert_eq!(promoted.id, task_id);
    assert!(promoted.quick_request.unwrap().promoted_at.is_some());
    let old = fixture.store.get_session(&session_id).unwrap().unwrap();
    assert!(old.directory.contains("quick-requests"));
}

#[test]
fn startup_recovery_marks_session_uncertain_without_fabricating_completion() {
    let fixture = Fixture::new();
    let (_, session_id) = fixture.quick_task("quick-recovery");
    fixture
        .store
        .mark_sessions_for_startup_reconciliation(6)
        .unwrap();
    let session = fixture.store.get_session(&session_id).unwrap().unwrap();
    assert!(session.reconciliation_uncertain);
    assert_ne!(session.last_known_status, "ready_for_review");
}
