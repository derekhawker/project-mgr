CREATE TABLE quick_request_prompts (
    task_id TEXT PRIMARY KEY NOT NULL
        REFERENCES tasks(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    original_prompt TEXT NOT NULL CHECK (length(trim(original_prompt)) > 0)
);

CREATE TRIGGER quick_request_prompts_require_quick_request
BEFORE INSERT ON quick_request_prompts
WHEN (SELECT quick_request_created_at FROM tasks WHERE id = NEW.task_id) IS NULL
BEGIN
    SELECT RAISE(ABORT, 'prompt storage is only for Quick Requests');
END;

CREATE TRIGGER quick_request_prompts_are_immutable
BEFORE UPDATE ON quick_request_prompts
BEGIN
    SELECT RAISE(ABORT, 'Quick Request original prompts are immutable');
END;

INSERT INTO quick_request_prompts(task_id, original_prompt)
SELECT id, description
FROM tasks
WHERE quick_request_created_at IS NOT NULL
  AND description IS NOT NULL
  AND length(trim(description)) > 0;

UPDATE tasks
SET description = NULL
WHERE quick_request_created_at IS NOT NULL;

UPDATE tasks
SET name = 'Quick Request'
WHERE quick_request_created_at IS NOT NULL;
