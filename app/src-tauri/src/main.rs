#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let mut arguments = std::env::args_os();
    let _program = arguments.next();
    if arguments.next().as_deref() == Some(std::ffi::OsStr::new("ticket-worktree-observed")) {
        let app_data = arguments.next().map(std::path::PathBuf::from);
        let session_id = arguments.next().and_then(|value| value.into_string().ok());
        let candidate = arguments.next().map(std::path::PathBuf::from);
        if arguments.next().is_some() {
            std::process::exit(2);
        }
        let (Some(app_data), Some(session_id), Some(candidate)) = (app_data, session_id, candidate)
        else {
            std::process::exit(2);
        };
        match opencode_project_manager_lib::ticket_worktree_plugin::record_observed(
            &app_data,
            &session_id,
            &candidate,
        ) {
            Ok(()) => return,
            Err(_) => std::process::exit(1),
        }
    }
    opencode_project_manager_lib::run();
}
