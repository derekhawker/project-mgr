//! Production-boundary tests for the installed OpenCode v2 CLI.
//!
//! The fixture tests deliberately execute a child process.  Calling a parser
//! directly would not have caught the real `opencode v2.0.27` regression.

use opencode_project_manager_lib::opencode::{self, Runtime};
use opencode_project_manager_lib::opencode_models_command;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tempfile::tempdir;

#[path = "../test_support/resource_lock.rs"]
mod resource_lock;

fn executable_fixture(dir: &Path, name: &str, version: &str, help: &str) -> PathBuf {
    // Do not rewrite an executable after it has been run.  Linux can reject a
    // concurrent rewrite with ETXTBSY, which made this child-process fixture
    // intermittently fail when the test runner overlapped cases.
    let path = dir.join(name);
    let script = format!(
        "#!/bin/sh\ncase \"$1\" in\n  --version) printf '%s\\n' '{version}' ;;\n  --help) printf '%s\\n' '{help}' ;;\n  *) exit 2 ;;\nesac\n"
    );
    fs::write(&path, script).expect("write OpenCode fixture");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755))
            .expect("make OpenCode fixture executable");
    }
    path
}

#[test]
fn production_help_validation_executes_fixture_child_for_real_version_output() {
    let _resource_guard = resource_lock::ResourceLock::acquire("opencode-cli-runtime");
    let help = "Usage: opencode [directory] --server <URL> --session <ID>";
    for (version_index, version) in [
        "opencode v2.0.27",
        "v2.0.27",
        "2.0.27",
        "  opencode v2.0.27  ",
    ]
    .into_iter()
    .enumerate()
    {
        // Keep every case in its own directory as well as using a unique
        // executable name.  The fixture is immutable for the whole case;
        // another case can never rewrite a path while a child is executing.
        let directory = tempdir().unwrap();
        let executable = executable_fixture(
            directory.path(),
            &format!("fixture-valid-{version_index}"),
            version,
            help,
        );
        assert_eq!(
            opencode::validate_help(&executable).unwrap(),
            version.trim()
        );
    }
}

#[test]
fn production_help_validation_rejects_malformed_and_unsupported_child_output() {
    let _resource_guard = resource_lock::ResourceLock::acquire("opencode-cli-runtime");
    let directory = tempdir().unwrap();
    let help = "Usage: opencode --server <URL> --session <ID>";
    for (version_index, version) in [
        "",
        "opencode",
        "opencode version",
        "opencode v2",
        "opencode vtwo.0.27",
    ]
    .into_iter()
    .enumerate()
    {
        let executable = executable_fixture(
            directory.path(),
            &format!("fixture-invalid-{version_index}"),
            version,
            help,
        );
        let error = opencode::validate_help(&executable).unwrap_err();
        assert!(
            error.contains("could not parse OpenCode version"),
            "{version:?}: {error}"
        );
    }
    let executable = executable_fixture(
        directory.path(),
        "fixture-major-three",
        "opencode v3.0.0",
        help,
    );
    assert!(opencode::validate_help(&executable)
        .unwrap_err()
        .contains("unsupported OpenCode major version 3"));

    let executable = executable_fixture(
        directory.path(),
        "fixture-missing-options",
        "opencode v2.0.27",
        "Usage: opencode",
    );
    assert!(opencode::validate_help(&executable)
        .unwrap_err()
        .contains("root --help must advertise both --server and --session"));
}

#[test]
fn installed_opencode_v2_cli_resolves_and_advertises_production_contract() {
    let _resource_guard = resource_lock::ResourceLock::acquire("opencode-cli-runtime");
    let executable = opencode::resolve_opencode().unwrap_or_else(|error| {
        panic!("installed OpenCode v2 CLI is required for this integration test: {error}")
    });
    let version = Command::new(&executable)
        .arg("--version")
        .output()
        .expect("run resolved OpenCode --version");
    assert!(version.status.success(), "--version failed: {version:?}");
    let version_text = String::from_utf8_lossy(&version.stdout).trim().to_owned();
    assert!(
        version_text.starts_with("opencode v2."),
        "this app's integration contract requires OpenCode v2, got {version_text:?}"
    );

    let help = Command::new(&executable)
        .arg("--help")
        .output()
        .expect("run resolved OpenCode --help");
    assert!(help.status.success(), "--help failed: {help:?}");
    let help_text = format!(
        "{}{}",
        String::from_utf8_lossy(&help.stdout),
        String::from_utf8_lossy(&help.stderr)
    );
    assert!(help_text.contains("--server"), "root help omitted --server");
    assert!(
        help_text.contains("--session"),
        "root help omitted --session"
    );
    assert_eq!(opencode::validate_help(&executable).unwrap(), version_text);
}

#[test]
fn production_runtime_authenticates_info_and_checks_v2_model_wrapper() {
    let _resource_guard = resource_lock::ResourceLock::acquire("opencode-cli-runtime");
    let runtime = Runtime::new();
    let info = runtime
        .info()
        .unwrap_or_else(|error| panic!("could not start installed OpenCode v2 server: {error}"));
    assert!(
        info.version.starts_with("2."),
        "expected v2 server, got {}",
        info.version
    );
    let executable = opencode::resolve_opencode().unwrap();
    let cli_version = Command::new(executable).arg("--version").output().unwrap();
    let cli_version = String::from_utf8_lossy(&cli_version.stdout)
        .trim()
        .strip_prefix("opencode v")
        .unwrap()
        .to_owned();
    assert_eq!(
        info.version, cli_version,
        "server and installed CLI versions differ"
    );
    assert!(info.pid.is_some(), "/api/info must include the server pid");

    let models = runtime.models().unwrap_or_else(|error| {
        panic!("OpenCode /api/model boundary failed after healthy /api/info: {error}")
    });
    let data = models
        .get("data")
        .and_then(serde_json::Value::as_array)
        .unwrap_or_else(|| {
            panic!("OpenCode /api/model boundary returned an invalid response: expected data[]")
        });
    for model in data {
        assert!(
            model
                .get("providerID")
                .and_then(serde_json::Value::as_str)
                .is_some(),
            "OpenCode /api/model boundary returned a model without providerID"
        );
        assert!(
            model
                .get("id")
                .and_then(serde_json::Value::as_str)
                .is_some(),
            "OpenCode /api/model boundary returned a model without id"
        );
    }
}

#[test]
fn production_runtime_drop_stops_and_reaps_its_server_child() {
    let _resource_guard = resource_lock::ResourceLock::acquire("opencode-cli-runtime");
    let runtime = Runtime::new();
    let info = runtime
        .info()
        .unwrap_or_else(|error| panic!("could not start installed OpenCode v2 server: {error}"));
    let pid = info.pid.expect("/api/info must include the server pid");

    drop(runtime);

    // This production test runs on Linux, where /proc distinguishes a live
    // child from a child that has been waited on (including a lingering
    // zombie).  The assertion is deliberately after Drop, not just after an
    // explicit shutdown call.
    assert!(
        !Path::new(&format!("/proc/{pid}")).exists(),
        "app-owned OpenCode server child {pid} is still alive after Runtime::drop"
    );
}

#[test]
fn production_opencode_models_command_adapter_uses_runtime_catalog_path() {
    let _resource_guard = resource_lock::ResourceLock::acquire("opencode-cli-runtime");
    let runtime = Runtime::new();
    let _ = runtime
        .info()
        .unwrap_or_else(|error| panic!("could not start installed OpenCode v2 server: {error}"));
    let models = opencode_models_command(&runtime)
        .unwrap_or_else(|error| panic!("opencode_models command boundary failed: {error}"));
    assert!(
        !models.is_empty(),
        "the installed server must expose a usable catalog"
    );
    assert!(models.iter().all(|model| model.enabled));
    assert!(models
        .iter()
        .all(|model| model.status.as_deref() != Some("deprecated")));
    assert!(!models
        .iter()
        .any(|model| { model.provider_id == "opencode" && model.id == "exo-free" }));
    let serialized = serde_json::to_value(&models).unwrap();
    assert!(serialized
        .as_array()
        .unwrap()
        .iter()
        .all(|entry| { entry.get("providerID").is_some() && entry.get("id").is_some() }));
}

#[test]
fn model_loader_failure_fixture_preserves_cli_and_api_boundary_errors() {
    let _resource_guard = resource_lock::ResourceLock::acquire("opencode-cli-runtime");
    let directory = tempdir().unwrap();
    let executable = executable_fixture(
        directory.path(),
        "fixture-old-cli",
        "opencode v1.18.35",
        "Usage: opencode --server <URL> --session <ID>",
    );
    let cli_error = opencode::validate_help(&executable).unwrap_err();
    assert!(
        cli_error.contains("unsupported OpenCode major version 1"),
        "{cli_error}"
    );

    // This is the exact shape returned when /api/info is healthy but the model
    // endpoint fails (the production parser must not turn it into an empty,
    // enabled selector).
    let api_error = opencode::parse_model_catalog(serde_json::json!({
        "error": "No provider route available"
    }))
    .unwrap_err();
    assert_eq!(api_error, "invalid OpenCode response: missing data wrapper");
}
