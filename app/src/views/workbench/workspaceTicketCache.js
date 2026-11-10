/** Caches ticket lists; loading is explicit and never happens during reads. */
export function createWorkspaceTicketCache(loadTickets, onLoaded = () => {}) {
  const values = new Map();
  const pending = new Map();
  let generation = 0;
  const keyFor = (workspaceId, archived) =>
    `${workspaceId}:${archived ? "archived" : "active"}`;

  function get(workspaceId, archived = false) {
    return values.get(keyFor(workspaceId, archived));
  }

  function load(workspaceId, archived = false, { force = false } = {}) {
    const key = keyFor(workspaceId, archived);
    if (force) invalidate();
    if (!force && values.has(key)) return Promise.resolve(values.get(key));
    if (!force && pending.get(key)?.generation === generation)
      return pending.get(key).request;

    const requestGeneration = generation;
    const request = Promise.resolve()
      .then(() => loadTickets(workspaceId, archived))
      .then((tickets) => {
        if (requestGeneration === generation) {
          values.set(key, tickets);
          onLoaded(workspaceId, archived, tickets);
        }
        return tickets;
      })
      .finally(() => {
        if (pending.get(key)?.request === request) pending.delete(key);
      });
    pending.set(key, { generation: requestGeneration, request });
    return request;
  }

  function invalidate() {
    generation += 1;
    values.clear();
  }

  async function preload(workspaces) {
    const activeWorkspaces = (workspaces || []).filter(
      (workspace) => workspace.kind === "regular" && workspace.status === "active",
    );
    const entries = activeWorkspaces.flatMap((workspace) => [
      { workspaceId: workspace.id, archived: false },
      { workspaceId: workspace.id, archived: true },
    ]);
    return Promise.all(
      entries.map(async (entry) => {
        try {
          await load(entry.workspaceId, entry.archived);
          return { ...entry, error: null };
        } catch (error) {
          return { ...entry, error };
        }
      }),
    );
  }

  return { get, load, invalidate, preload };
}
