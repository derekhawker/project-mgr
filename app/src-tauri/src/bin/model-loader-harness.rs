//! Test-only executable boundary for the model selector integration test.
//!
//! This intentionally delegates catalog loading to the same public adapter as
//! the Tauri command.  It is not a second OpenCode client or catalog parser.
use opencode_project_manager_lib::{opencode, opencode_models_command};
use serde::Serialize;

#[derive(Serialize)]
#[serde(tag = "ok", rename_all = "camelCase")]
enum Output {
    #[serde(rename = "true")]
    Success {
        info: opencode::Info,
        catalog: Vec<opencode::ModelCatalogEntry>,
    },
    #[serde(rename = "false")]
    Failure { error: String },
}

fn main() {
    let result = (|| {
        let runtime = opencode::Runtime::new();
        // ensure_started starts the app-owned server and validates the CLI.
        // info() then exercises the authenticated /api/info route, while the
        // production command below exercises the authenticated /api/model
        // route and its filtering path.
        runtime.ensure_started()?;
        let info = runtime.info()?;
        let catalog = opencode_models_command(&runtime)?;
        Ok::<_, String>(Output::Success { info, catalog })
    })();

    let output = match result {
        Ok(output) => output,
        Err(error) => Output::Failure { error },
    };
    println!(
        "{}",
        serde_json::to_string(&output).expect("harness output is serializable")
    );
    if matches!(output, Output::Failure { .. }) {
        std::process::exit(1);
    }
}
