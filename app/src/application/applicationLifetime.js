// One owner for the application's Solid root and native adapters. This is
// deliberately not a navigation scope: hidden destinations keep their resources.
export function createApplicationLifetime({
  render,
  listen,
  windowTarget,
  onError = console.error,
}) {
  let rootCleanup;
  const unlisteners = [];
  let disposed = false;
  let started = false;
  let terminalRuntime;
  let terminalReady;
  let interval;

  function release(cleanup) {
    try {
      cleanup();
    } catch (error) {
      onError(error);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    windowTarget.removeEventListener("pagehide", dispose);
    if (interval !== undefined) windowTarget.clearInterval(interval);
    for (const unlisten of unlisteners.splice(0).reverse()) release(unlisten);
    if (terminalRuntime) release(() => terminalRuntime.dispose());
    if (rootCleanup) release(rootCleanup);
    rootCleanup = undefined;
  }
  windowTarget.addEventListener("pagehide", dispose);

  return {
    get disposed() {
      return disposed;
    },
    mount(component, container) {
      if (disposed)
        throw new Error("Application presentation has been disposed.");
      if (rootCleanup) throw new Error("Application root is already mounted.");
      rootCleanup = render(component, container);
    },
    start({ loadTerminalRuntime, terminalOptions, subscriptions, poll }) {
      if (disposed) return Promise.resolve(null);
      if (started) return terminalReady;
      started = true;
      for (const [event, callback] of subscriptions) {
        // listen() may finish after page teardown. Never lose the late handle,
        // and ignore events even in the interval before unlisten resolves.
        // Initiate registration now, before main launches its command loads.
        void (async () => {
          try {
            const unlisten = await listen(event, (message) => {
              if (!disposed) callback(message);
            });
            if (disposed) release(unlisten);
            else unlisteners.push(unlisten);
          } catch (error) {
            if (!disposed) onError(error);
          }
        })();
      }
      interval = windowTarget.setInterval(() => {
        if (!disposed) poll();
      }, 3000);
      terminalReady = Promise.resolve().then(async () => {
        if (disposed) return null;
        const { TerminalRuntime } = await loadTerminalRuntime();
        if (disposed) return null;
        // Own the instance before awaiting start: disposal can race registration.
        terminalRuntime = new TerminalRuntime(terminalOptions);
        await terminalRuntime.start();
        return disposed ? null : terminalRuntime;
      });
      return terminalReady;
    },
    dispose,
  };
}
