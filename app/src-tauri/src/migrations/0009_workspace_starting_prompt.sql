CREATE TABLE workspace_starting_prompts (
    session_id TEXT PRIMARY KEY NOT NULL REFERENCES sessions(open_code_session_id) ON DELETE CASCADE,
    prompt TEXT NOT NULL
);
