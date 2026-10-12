DROP TRIGGER tasks_match_workspace_kind_on_insert;
DROP TRIGGER tasks_match_workspace_kind_on_update;
DROP TRIGGER sessions_require_active_owner;

CREATE TRIGGER quick_requests_workspace_home_is_shared
BEFORE UPDATE OF home_path ON workspaces
WHEN OLD.kind = 'quick_requests' AND NEW.home_path <> OLD.home_path
BEGIN
    SELECT RAISE(ABORT, 'Quick Requests workspace home is shared and immutable');
END;

CREATE TRIGGER tasks_match_workspace_kind_on_insert
BEFORE INSERT ON tasks
WHEN
    ((SELECT kind FROM workspaces WHERE id = NEW.workspace_id) = 'quick_requests' AND
     (NEW.quick_request_created_at IS NULL OR NEW.quick_request_promoted_at IS NOT NULL OR
      NEW.home_path <> (SELECT home_path FROM workspaces WHERE id = NEW.workspace_id)))
    OR
    ((SELECT kind FROM workspaces WHERE id = NEW.workspace_id) = 'regular' AND
     NEW.quick_request_created_at IS NOT NULL AND NEW.quick_request_promoted_at IS NULL)
    OR
    ((SELECT status FROM workspaces WHERE id = NEW.workspace_id) <> 'active')
BEGIN
    SELECT RAISE(ABORT, 'task kind or home path does not match owning workspace');
END;

CREATE TRIGGER tasks_match_workspace_kind_on_update
BEFORE UPDATE OF workspace_id, quick_request_created_at, quick_request_promoted_at, home_path ON tasks
WHEN
    ((SELECT kind FROM workspaces WHERE id = NEW.workspace_id) = 'quick_requests' AND
     (NEW.quick_request_created_at IS NULL OR NEW.quick_request_promoted_at IS NOT NULL OR
      NEW.home_path <> (SELECT home_path FROM workspaces WHERE id = NEW.workspace_id)))
    OR
    ((SELECT kind FROM workspaces WHERE id = NEW.workspace_id) = 'regular' AND
     NEW.quick_request_created_at IS NOT NULL AND NEW.quick_request_promoted_at IS NULL)
    OR
    ((SELECT status FROM workspaces WHERE id = NEW.workspace_id) <> 'active')
BEGIN
    SELECT RAISE(ABORT, 'task kind or home path does not match owning workspace');
END;

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
       ((SELECT kind FROM workspaces
          WHERE id = (SELECT workspace_id FROM tasks WHERE id = NEW.owner_task_id)) <> 'quick_requests' OR
        NEW.directory <> (SELECT home_path FROM workspaces
                           WHERE id = (SELECT workspace_id FROM tasks WHERE id = NEW.owner_task_id))))))
BEGIN
    SELECT RAISE(ABORT, 'new sessions require an active eligible owner and exact Quick Request directory');
END;
