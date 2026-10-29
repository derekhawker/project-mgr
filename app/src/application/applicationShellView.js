import { createSignal } from "solid-js";

// The production shell's transient presentation state, independent of DOM/native
// APIs so command success and failures can exercise this exact adapter in Node.
export function createApplicationShellView() {
  const [state, setState] = createSignal({
    connection: "connecting",
    message: "Contacting the Rust core…",
    version: "Version —",
    result: "Waiting for app_shell_info…",
  });
  return {
    state,
    setState,
    setResult: (result) => setState((current) => ({ ...current, result })),
  };
}
