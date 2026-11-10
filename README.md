# OpenCode Project Manager

## OpenCode setup

Link the global skills and ticket plugin from the repository root:

```sh
mkdir -p ~/.agents/skills
ln -s "$PWD/opencode/skills/gated-implementation" ~/.agents/skills/gated-implementation
ln -s "$PWD/opencode/skills/ticket-management" ~/.agents/skills/ticket-management
mkdir -p ~/.config/opencode/plugins
ln -s "$PWD/opencode/plugins/ticket-worktree-plugin.js" ~/.config/opencode/plugins/project-mgr-ticket-worktree.js
```

Launch the app once to write the plugin's runtime config, then restart OpenCode.
