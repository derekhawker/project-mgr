const retryDelay = (attempt) => Math.min(1000 * 2 ** Math.min(attempt - 1, 5), 30_000);

function waitForRetry(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

export async function consumeEventStream({ subscribe, onEvent, onState, signal, wait = waitForRetry }) {
  let attempt = 0;
  while (!signal.aborted) {
    try {
      const stream = subscribe({ signal });
      onState("listening");
      for await (const event of stream) {
        if (signal.aborted) break;
        onEvent(event);
      }
    } catch {
      // A failed stream is retried; never log event payloads or SDK errors.
    }
    if (signal.aborted) break;
    attempt += 1;
    onState("retrying");
    await wait(retryDelay(attempt), signal);
  }
  onState("closed");
}
