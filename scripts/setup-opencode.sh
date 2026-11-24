#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
if ! command -v opencode >/dev/null 2>&1; then
  printf 'OpenCode CLI was not found. Install OpenCode, then rerun this script.\n' >&2
  exit 1
fi

printf 'OpenCode detected: '
opencode --version
printf 'This will add links to project agents and skills in your user config.\n'
printf 'Existing files and links to other targets will not be replaced.\n'
read -r -p 'Continue? [y/N] ' answer
case "$answer" in
  y|Y|yes|YES) ;;
  *) printf 'OpenCode setup cancelled.\n'; exit 0 ;;
esac

config_root="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
agent_root="$config_root/agent"
skill_root="$config_root/skills"
agent_skill_root="$HOME/.agents/skills"

link_if_available() {
  local source="$1"
  local target="$2"
  local target_source

  if [[ ! -e "$source" ]]; then
    printf 'Missing repository source: %s\n' "$source" >&2
    return 1
  fi
  mkdir -p "$(dirname "$target")"

  if [[ -L "$target" ]]; then
    target_source="$(readlink "$target" || true)"
    if [[ "$source" == "$target_source" ]]; then
      printf 'Already linked: %s\n' "$target"
      return 0
    fi
    printf 'Conflict (different symlink left untouched): %s\n' "$target" >&2
    return 1
  fi

  if [[ -e "$target" ]]; then
    printf 'Conflict (existing path left untouched): %s\n' "$target" >&2
    return 1
  fi

  ln -s "$source" "$target"
  printf 'Linked: %s -> %s\n' "$target" "$source"
}

errors=0
for agent in tester code-reviewer; do
  link_if_available \
    "$repo_root/opencode/agents/$agent.md" \
    "$agent_root/$agent.md" || errors=1
done
link_if_available \
  "$repo_root/opencode/agents/references" \
  "$agent_root/references" || errors=1

for skill in gated-implementation ticket-management agent-loop; do
  link_if_available \
    "$repo_root/opencode/skills/$skill" \
    "$skill_root/$skill" || errors=1
done

for skill in gated-implementation ticket-management; do
  link_if_available \
    "$repo_root/opencode/skills/$skill" \
    "$agent_skill_root/$skill" || errors=1
done

if (( errors != 0 )); then
  printf 'Some links were not installed. Resolve the conflicts above and rerun this script.\n' >&2
  exit 1
fi

printf 'Project agents and skills are ready. Restart OpenCode or run /reload.\n'
