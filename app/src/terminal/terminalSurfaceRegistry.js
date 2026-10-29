// xterm owns the contents of each surface; this registry owns only the wrapper
// nodes and which one is currently visible.
export function createTerminalSurfaceRegistry() {
  const surfaces = new Map();
  let visibleId = null;

  function register(sessionId, node) {
    surfaces.set(sessionId, node);
    node.hidden = sessionId !== visibleId;
    return node;
  }

  function get(sessionId) {
    return surfaces.get(sessionId) || null;
  }

  function show(sessionId) {
    if (visibleId !== sessionId) {
      const previous = get(visibleId);
      if (previous) previous.hidden = true;
    }
    const next = get(sessionId);
    if (!next) {
      visibleId = null;
      return false;
    }
    next.hidden = false;
    visibleId = sessionId;
    return true;
  }

  function hide() {
    const current = get(visibleId);
    if (current) current.hidden = true;
    visibleId = null;
  }

  function remove(sessionId) {
    const node = get(sessionId);
    if (!node) return;
    if (visibleId === sessionId) visibleId = null;
    surfaces.delete(sessionId);
    node.remove();
  }

  return { register, get, show, hide, remove };
}
