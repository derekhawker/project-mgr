-- The Rust migration conditionally adds workspace_repository_worktrees.base_checkout_path.
-- Migration 18 was shipped in a development build both with and without this column.
SELECT 1;
