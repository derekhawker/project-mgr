use std::{fs, path::Path};

const PLUGIN_TEMPLATE: &str = include_str!("../resources/ticket-worktree-plugin.js");
const PLUGIN_MARKER: &str = "project-mgr managed plugin. Do not edit";

pub fn install(config_directory: &Path, app_data: &Path, executable: &Path) -> Result<(), String> {
    fs::create_dir_all(config_directory)
        .map_err(|error| format!("Could not create user configuration directory: {error}"))?;
    let config_metadata =
        fs::symlink_metadata(config_directory).map_err(|error| error.to_string())?;
    if config_metadata.file_type().is_symlink() || !config_metadata.is_dir() {
        return Err("User configuration path is not a regular directory".into());
    }
    let opencode_directory = config_directory.join("opencode");
    let plugin_directory = opencode_directory.join("plugins");
    for directory in [&opencode_directory, &plugin_directory] {
        match fs::symlink_metadata(directory) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(
                    "OpenCode plugin installation path contains a non-directory or symlink".into(),
                );
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(directory).map_err(|error| {
                    format!("Could not create OpenCode plugin directory: {error}")
                })?;
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    let destination = plugin_directory.join("project-mgr-ticket-worktree.js");
    let source = PLUGIN_TEMPLATE
        .replace(
            "__PROJECT_MGR_EXECUTABLE__",
            &serde_json::to_string(&executable.to_string_lossy())
                .map_err(|error| error.to_string())?,
        )
        .replace(
            "__PROJECT_MGR_APP_DATA__",
            &serde_json::to_string(&app_data.to_string_lossy())
                .map_err(|error| error.to_string())?,
        );
    let existing = match fs::symlink_metadata(&destination) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(
                    "The OpenCode ticket plugin path is not a regular file; it was not replaced"
                        .into(),
                );
            }
            let existing = fs::read_to_string(&destination).map_err(|error| error.to_string())?;
            if !existing.contains(PLUGIN_MARKER) {
                return Err("An unrelated OpenCode plugin already uses project-mgr-ticket-worktree.js; it was not overwritten".into());
            }
            if existing == source {
                return Ok(());
            }
            Some(existing)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.to_string()),
    };
    let temporary = destination.with_extension(format!("js.{}.tmp", std::process::id()));
    fs::write(&temporary, source)
        .map_err(|error| format!("Could not stage OpenCode ticket plugin: {error}"))?;
    let still_matches = match existing.as_deref() {
        Some(expected) => fs::symlink_metadata(&destination).is_ok_and(|metadata| {
            !metadata.file_type().is_symlink()
                && metadata.is_file()
                && fs::read_to_string(&destination).is_ok_and(|current| current == expected)
        }),
        None => fs::symlink_metadata(&destination)
            .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound),
    };
    if !still_matches {
        let _ = fs::remove_file(&temporary);
        return Err(
            "The OpenCode plugin path changed during installation; it was not replaced".into(),
        );
    }
    fs::rename(&temporary, &destination).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!("Could not install OpenCode ticket plugin: {error}")
    })
}

pub fn record_observed(app_data: &Path, session_id: &str, candidate: &Path) -> Result<(), String> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)
        .ok_or("User home is unavailable")?;
    let store = crate::management::ManagementStore::open_with_paths(
        app_data.join("management.sqlite3"),
        home.clone(),
        std::env::temp_dir(),
    )
    .map_err(|error| error.to_string())?;
    crate::workspace_tickets::record_observed_worktree_for_session(
        app_data, &store, session_id, candidate,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installs_its_plugin_without_overwriting_an_unrelated_plugin() {
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join("config");
        let data = root.path().join("app data");
        let executable = root.path().join("project mgr");
        install(&config, &data, &executable).unwrap();
        let plugin = config.join("opencode/plugins/project-mgr-ticket-worktree.js");
        let source = fs::read_to_string(&plugin).unwrap();
        assert!(source.contains(&serde_json::to_string(&executable.to_string_lossy()).unwrap()));
        assert!(source.contains(&serde_json::to_string(&data.to_string_lossy()).unwrap()));
        install(&config, &data, &executable).unwrap();
        fs::write(&plugin, "user plugin\n").unwrap();
        assert!(install(&config, &data, &executable).is_err());
        assert_eq!(fs::read_to_string(plugin).unwrap(), "user plugin\n");
    }
}
