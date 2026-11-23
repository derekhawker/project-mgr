# OpenCode Project Manager

## Install the OpenCode project tools

The repository includes project-wide agents and skills. From a terminal at the
main worktree, run:

```bash
./scripts/setup-opencode.sh
```

The helper checks that the `opencode` CLI is installed, asks before making
changes, and creates links for the repository's `tester` and `code-reviewer`
agents and its `gated-implementation`, `ticket-management`, and `agent-loop`
skills. Skills are linked into OpenCode's config and the two general-purpose
skills are also linked into `~/.agents/skills`. Existing files or links to other
targets are left untouched; resolve any reported conflict yourself. Links point
to this checkout, so keep the main worktree at a stable path.

Restart OpenCode or run `/reload` after setup so it discovers the agents and
skills.

## Plugins

- **Ticket worktree plugin:** The app installs and updates this plugin and its
  runtime configuration when the app starts. No manual symlink is needed.
- **Agent loop:** This optional plugin is not enabled by the helper. Review
  [`opencode/plugins/agent-loop/README.md`](opencode/plugins/agent-loop/README.md)
  and opt in there if you want its ticket-bound continuation commands.
- **Agent-loop model gate:** This is an isolated experiment, not part of normal
  setup. Use its
  [`README`](opencode/plugins/agent-loop-model-gate/README.md) and disposable
  test configuration only.

If OpenCode is not installed yet, install it first, then rerun the helper. This
repository currently has no packaged post-install hook; the helper is the
explicit setup step.
