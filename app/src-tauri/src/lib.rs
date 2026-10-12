use serde::Serialize;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, State, WindowEvent};

pub mod management;
pub mod safety;

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
}

impl AppState {
    fn initialized() -> Self {
        Self {
            shell_info: AppShellInfo::initialized(env!("CARGO_PKG_VERSION")),
        }
    }

    fn storage_unavailable(reason: &str) -> Self {
        Self {
            shell_info: AppShellInfo::storage_unavailable(env!("CARGO_PKG_VERSION"), reason),
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
                    app.manage(management_store);
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
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            app.manage(tray);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![app_shell_info])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run OpenCode Project Manager");
}

#[cfg(test)]
mod tests {
    use super::AppState;
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
}
