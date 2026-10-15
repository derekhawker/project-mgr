ALTER TABLE setup_operation_state
    ADD COLUMN selected_repository_ids TEXT;

ALTER TABLE setup_operation_state
    ADD COLUMN starting_prompt TEXT;
