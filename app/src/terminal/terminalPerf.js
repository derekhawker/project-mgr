import "@xterm/xterm/css/xterm.css";
import { TerminalRuntime } from "./terminalRuntime.js";

const status = document.querySelector("#status");
const [port, token] = location.hash.slice(1).split(":");
history.replaceState(null, "", location.pathname);
if (!/^\d+$/.test(port || "") || !/^[a-f0-9]{64}$/.test(token || "")) {
  status.textContent =
    "Start the terminal performance server and use its printed URL.";
} else {
  const socket = new WebSocket(
    `ws://127.0.0.1:${port}/terminal?token=${token}`,
  );
  socket.binaryType = "arraybuffer";
  const listeners = new Map();
  const pending = [];
  let attached = false;
  const runtime = new TerminalRuntime({
    listenEvent: async (name, callback) => {
      listeners.set(name, callback);
      return () => listeners.delete(name);
    },
    invoke: async (name, payload) => {
      if (name === "opencode_terminal_replay") return { replay: [] };
      if (name === "opencode_terminal_resize") return null; // PTY remains 80×24 in this harness.
      if (name === "opencode_terminal_write") {
        socket.send(new TextEncoder().encode(payload.data));
        return null;
      }
      throw new Error(`Unsupported terminal harness command: ${name}`);
    },
    onError: ({ operation }) => {
      status.textContent = `Terminal error: ${operation}`;
    },
  });
  const output = (data) => {
    const bytes = new Uint8Array(data);
    let text = "";
    for (const byte of bytes) text += String.fromCharCode(byte);
    listeners.get("terminal-output")?.({
      payload: { sessionId: "perf", dataBase64: btoa(text) },
    });
  };
  socket.addEventListener("message", ({ data }) => {
    if (attached) output(data);
    else pending.push(data);
  });
  socket.addEventListener("open", async () => {
    try {
      await runtime.start();
      const terminal = await runtime.attachExisting(
        "perf",
        document.querySelector("#terminal"),
      );
      attached = true;
      for (const data of pending.splice(0)) output(data);
      // One input at a time prevents coalescing from being mistaken for latency.
      // This measures xterm input to PTY echo delivery, not keyboard or paint.
      window.terminalPerf = {
        async measure(count = 30) {
          if (!Number.isInteger(count) || count < 1 || count > 60)
            throw new Error("Sample count must be between 1 and 60.");
          const samples = [];
          for (let i = 0; i < count; i++) {
            samples.push(
              await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                  socket.removeEventListener("message", receive);
                  reject(new Error("Timed out waiting for PTY output"));
                }, 2000);
                const receive = () => {
                  clearTimeout(timeout);
                  resolve(performance.now() - start);
                };
                socket.addEventListener("message", receive, { once: true });
                const start = performance.now();
                terminal.input("x", true);
              }),
            );
          }
          terminal.input("\x15", true); // Discard the unsubmitted shell line.
          return samples;
        },
      };
      status.textContent = "Connected (80×24 PTY).";
    } catch (error) {
      status.textContent = `Could not attach: ${error.message}`;
    }
  });
  socket.addEventListener("close", () => {
    status.textContent = "Disconnected.";
    runtime.dispose();
  });
  window.addEventListener("pagehide", () => socket.close(), { once: true });
}
