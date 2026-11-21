import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const unavailable = () => new Error("local OpenCode API unavailable");

// v2.1.4 lacks several read APIs in the server plugin context. These reads
// use the same server's public API, never a destination supplied by the TUI.
export function createLocalReader(location) {
  let connection;
  const request = async (path, signal) => {
    connection ??= await localConnection();
    const url = new URL(path, connection.url);
    if (url.origin !== connection.url.origin) throw unavailable();
    if (path.startsWith("/api/form"))
      url.searchParams.set("location[directory]", location.directory);
    const headers = {
      "x-opencode-directory": encodeURIComponent(location.directory),
    };
    if (connection.password)
      headers.authorization = `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString("base64")}`;
    const response = await fetch(url, { headers, signal, redirect: "error" });
    if (!response.ok) throw unavailable();
    return response;
  };
  const read = async (path, signal) => {
    const response = await request(path, signal);
    const envelope = await response.json();
    if (
      !envelope ||
      typeof envelope !== "object" ||
      !Object.hasOwn(envelope, "data")
    )
      throw unavailable();
    return envelope;
  };
  read.events = async function* (path, signal) {
    const response = await request(path, signal);
    yield* readSessionLog(response);
  };
  return read;
}

// Only a synced log can establish that no cancellation was committed. Bound
// the buffered frame, not the entire transcript; the caller bounds read time.
export async function* readSessionLog(response) {
  if (!response.headers.get("content-type")?.startsWith("text/event-stream") || !response.body)
    throw unavailable();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary;
    while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
      const frame = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      const lines = frame.split(/\r?\n/);
      const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
      if (event === "effect/http-api/stream/failure") throw unavailable();
      const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart());
      if (data.length) {
        const value = JSON.parse(data.join("\n"));
        yield typeof value === "string" ? JSON.parse(value) : value;
      }
    }
    if (buffer.length > 4 * 1024 * 1024) throw unavailable();
  }
  if (buffer.trim()) throw unavailable();
}

async function localConnection() {
  const [, , command, ...flags] = process.argv;
  if (command === "serve" && !flags.includes("--service")) {
    // Support explicit serve invocations with a known local port. A dynamic
    // port (including standalone) is not inferred or discovered by scanning.
    const port = flag(flags, "--port");
    const host = flag(flags, "--hostname") ?? "127.0.0.1";
    if (/^[1-9]\d{0,4}$/.test(port ?? "") && Number(port) <= 65535) {
      return {
        url: loopbackURL(`http://${host}:${port}`),
        username: process.env.OPENCODE_SERVER_USERNAME || "opencode",
        password: process.env.OPENCODE_SERVER_PASSWORD,
      };
    }
    throw unavailable();
  }

  const state =
    process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  const handle = await open(
    join(state, "opencode", "service.json"),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.size > 8192 ||
      (process.getuid && (stat.uid !== process.getuid() || stat.mode & 0o077))
    )
      throw unavailable();
    const buffer = Buffer.alloc(8193);
    const { bytesRead } = await handle.read(buffer);
    if (bytesRead > 8192) throw unavailable();
    const { pid, url, password } = JSON.parse(
      buffer.toString("utf8", 0, bytesRead),
    );
    if (pid !== process.pid || typeof password !== "string" || !password)
      throw unavailable();
    return { url: loopbackURL(url), password, username: "opencode" };
  } finally {
    await handle.close();
  }
}

function flag(flags, name) {
  const i = flags.findLastIndex(
    (arg) => arg === name || arg.startsWith(`${name}=`),
  );
  if (i < 0) return;
  return flags[i] === name ? flags[i + 1] : flags[i].slice(name.length + 1);
}

function loopbackURL(raw) {
  const url = new URL(raw);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw unavailable();
  return url;
}
