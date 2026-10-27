export function handleSessionTabKeydown(event, entries, { activeSessionId, focusTab }) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.target?.disabled) return;
  const tabs = entries.filter((entry) => entry.visible && !entry.disabled);
  if (!tabs.length || !['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const current = Math.max(0, tabs.findIndex((entry) => entry.sessionId === activeSessionId));
  const next = event.key === 'Home' ? 0
    : event.key === 'End' ? tabs.length - 1
      : (current + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  focusTab(tabs[next].sessionId);
  tabs[next].onSelect();
}
