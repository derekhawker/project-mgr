use std::{fs, path::Path};

const PLUGIN_TEMPLATE: &str = include_str!("../../../opencode/plugins/ticket-worktree-plugin.js");
const PLUGIN_MARKER: &str = "project-mgr managed plugin.";
const PLUGIN_SOURCE_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../opencode/plugins/ticket-worktree-plugin.js"
);
const CONFIG_MARKER: &str = "opencode-project-manager-ticket-plugin";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeConfig<'a> {
    schema_version: u8,
    managed_by: &'static str,
    executable: &'a str,
    app_data_directory: &'a str,
}

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
    let config_path = plugin_directory.join("project-mgr-ticket-worktree.json");
    let executable = executable.to_string_lossy();
    let app_data = app_data.to_string_lossy();
    let config = serde_json::to_vec_pretty(&RuntimeConfig {
        schema_version: 1,
        managed_by: CONFIG_MARKER,
        executable: &executable,
        app_data_directory: &app_data,
    })
    .map_err(|error| error.to_string())?;

    let source_path = match fs::symlink_metadata(PLUGIN_SOURCE_PATH) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err("Tracked OpenCode plugin source is not a regular file".into())
        }
        Ok(_) => Some(
            Path::new(PLUGIN_SOURCE_PATH)
                .canonicalize()
                .map_err(|error| {
                    format!("Could not resolve tracked OpenCode plugin source: {error}")
                })?,
        ),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(format!(
                "Could not inspect tracked OpenCode plugin source: {error}"
            ))
        }
    };
    let existing = match fs::symlink_metadata(&destination) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            let target = fs::read_link(&destination).map_err(|error| error.to_string())?;
            if source_path.as_deref() == Some(target.as_path()) {
                write_runtime_config(&config_path, &config)?;
                return Ok(());
            }
            return Err("The OpenCode ticket plugin path is a symlink to an unrelated file; it was not replaced".into());
        }
        Ok(metadata) if metadata.is_file() => {
            let existing = fs::read_to_string(&destination).map_err(|error| error.to_string())?;
            if !existing.contains(PLUGIN_MARKER) {
                return Err("An unrelated OpenCode plugin already uses project-mgr-ticket-worktree.js; it was not overwritten".into());
            }
            Some(existing)
        }
        Ok(_) => {
            return Err("The OpenCode ticket plugin path is not a regular file or symlink".into());
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.to_string()),
    };
    write_runtime_config(&config_path, &config)?;
    let temporary = destination.with_extension(format!("js.{}.tmp", std::process::id()));
    if let Some(source_path) = source_path.as_deref() {
        symlink_file(source_path, &temporary)
            .map_err(|error| format!("Could not stage OpenCode ticket plugin symlink: {error}"))?;
    } else {
        fs::write(&temporary, PLUGIN_TEMPLATE)
            .map_err(|error| format!("Could not stage OpenCode ticket plugin copy: {error}"))?;
    }
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
    if existing.is_some() {
        fs::remove_file(&destination).map_err(|error| {
            let _ = fs::remove_file(&temporary);
            format!("Could not replace the app-managed OpenCode ticket plugin: {error}")
        })?;
    }
    fs::rename(&temporary, &destination).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!("Could not install OpenCode ticket plugin: {error}")
    })
}

fn write_runtime_config(path: &Path, contents: &[u8]) -> Result<(), String> {
    let existing = match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err("The OpenCode ticket plugin config path is not a regular file".into())
        }
        Ok(_) => {
            let bytes = fs::read(path).map_err(|error| error.to_string())?;
            let text = String::from_utf8_lossy(&bytes);
            if !text.contains(CONFIG_MARKER) {
                return Err(
                    "An unrelated file already uses the OpenCode ticket plugin config path".into(),
                );
            }
            if bytes == contents {
                return Ok(());
            }
            Some(bytes)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.to_string()),
    };
    let temporary = path.with_extension(format!("json.{}.tmp", std::process::id()));
    fs::write(&temporary, contents)
        .map_err(|error| format!("Could not stage OpenCode ticket plugin config: {error}"))?;
    let still_matches = match existing.as_deref() {
        Some(expected) => fs::symlink_metadata(path).is_ok_and(|metadata| {
            !metadata.file_type().is_symlink()
                && metadata.is_file()
                && fs::read(path).is_ok_and(|current| current == expected)
        }),
        None => fs::symlink_metadata(path)
            .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound),
    };
    if !still_matches {
        let _ = fs::remove_file(&temporary);
        return Err("The OpenCode ticket plugin config changed during installation".into());
    }
    if existing.is_some() {
        fs::remove_file(path).map_err(|error| {
            let _ = fs::remove_file(&temporary);
            format!("Could not replace app-managed OpenCode ticket plugin config: {error}")
        })?;
    }
    fs::rename(&temporary, path).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!("Could not install OpenCode ticket plugin config: {error}")
    })
}

#[cfg(unix)]
fn symlink_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(source, destination)
}

#[cfg(windows)]
fn symlink_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_file(source, destination)
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
        let expected_source = Path::new(PLUGIN_SOURCE_PATH).canonicalize().unwrap();
        assert!(fs::symlink_metadata(&plugin)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read_link(&plugin).unwrap(), expected_source);
        let config_path = config.join("opencode/plugins/project-mgr-ticket-worktree.json");
        let runtime_config: serde_json::Value =
            serde_json::from_slice(&fs::read(config_path).unwrap()).unwrap();
        assert_eq!(runtime_config["managedBy"], CONFIG_MARKER);
        assert_eq!(
            runtime_config["executable"],
            executable.to_string_lossy().as_ref()
        );
        assert_eq!(
            runtime_config["appDataDirectory"],
            data.to_string_lossy().as_ref()
        );
        install(&config, &data, &executable).unwrap();
        fs::remove_file(&plugin).unwrap();
        fs::write(&plugin, "user plugin\n").unwrap();
        assert!(install(&config, &data, &executable).is_err());
        assert_eq!(fs::read_to_string(plugin).unwrap(), "user plugin\n");
    }
}
