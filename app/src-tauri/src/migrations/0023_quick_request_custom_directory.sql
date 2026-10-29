DROP TRIGGER IF EXISTS sessions_require_active_owner;
CREATE TRIGGER sessions_require_active_owner
BEFORE INSERT ON sessions
WHEN
    (NEW.owner_workspace_id IS NOT NULL AND
     ((SELECT status FROM workspaces WHERE id = NEW.owner_workspace_id) <> 'active' OR
      (SELECT kind FROM workspaces WHERE id = NEW.owner_workspace_id) <> 'regular'))
    OR
    (NEW.owner_task_id IS NOT NULL AND
     ((SELECT status FROM tasks WHERE id = NEW.owner_task_id) <> 'active' OR
      ((SELECT quick_request_created_at FROM tasks WHERE id = NEW.owner_task_id) IS NOT NULL AND
       (SELECT quick_request_promoted_at FROM tasks WHERE id = NEW.owner_task_id) IS NULL AND
       (SELECT kind FROM workspaces WHERE id = (SELECT workspace_id FROM tasks WHERE id = NEW.owner_task_id)) <> 'quick_requests')))
BEGIN
    SELECT RAISE(ABORT, 'new sessions require an active eligible owner');
END;
