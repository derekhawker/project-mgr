DROP TRIGGER quick_request_prompts_are_immutable;

ALTER TABLE quick_request_prompts ADD COLUMN starting_prompt TEXT;

UPDATE quick_request_prompts
SET starting_prompt = original_prompt;

CREATE TRIGGER quick_request_prompts_original_is_immutable
BEFORE UPDATE OF original_prompt ON quick_request_prompts
BEGIN
    SELECT RAISE(ABORT, 'Quick Request original prompts are immutable');
END;

CREATE TRIGGER quick_request_prompts_starting_prompt_is_valid
BEFORE INSERT ON quick_request_prompts
WHEN NEW.starting_prompt IS NULL OR length(trim(NEW.starting_prompt)) = 0
BEGIN
    SELECT RAISE(ABORT, 'Quick Request starting prompts must be non-empty');
END;

CREATE TRIGGER quick_request_prompts_starting_prompt_is_immutable
BEFORE UPDATE OF starting_prompt ON quick_request_prompts
BEGIN
    SELECT RAISE(ABORT, 'Quick Request starting prompts are immutable');
END;
