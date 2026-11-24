import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { basename } from "node:path";
import { MAX_AGE } from "./loop.js";
import { companionPath } from "./workspace.js";

const MAX_RECORD_BYTES = 256 * 1024;
const MAX_TODO_BYTES = 32 * 1024;
async function readRecord(path, maxBytes = MAX_RECORD_BYTES) {
  if ((await realpath(path)) !== path) throw new Error("noncanonical-path");
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes)
      throw new Error("invalid-record");
    const buffer = Buffer.alloc(maxBytes + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        total,
        buffer.length - total,
        null,
      );
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > maxBytes) throw new Error("invalid-record");
    return new TextDecoder("utf-8", { fatal: true }).decode(
      buffer.subarray(0, total),
    );
  } finally {
    await handle.close();
  }
}

export async function validateRecords({ sessionID, ticket, todo }) {
  const companion = companionPath(ticket);
  if (
    !companion ||
    companion !== todo ||
    !/^ses[_a-zA-Z0-9-]+$/.test(sessionID)
  )
    return { ok: false, reason: "invalid-record-paths-or-session" };
  try {
    const markdown = await readRecord(ticket);
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
    const field = (key) => {
      const lines = frontmatter?.[1]
        .split(/\r?\n/)
        .filter((line) => line.startsWith(`${key}:`));
      if (lines?.length !== 1) return;
      const value = lines[0].slice(key.length + 1).trim();
      return /^("|').*\1$/.test(value) ? value.slice(1, -1) : value;
    };
    if (
      !field("title") ||
      field("status") !== "in_progress" ||
      field("work_session_id") !== sessionID
    )
      return { ok: false, reason: "ticket-not-active-for-session" };
    if (!markdown.slice(frontmatter[0].length).includes(basename(todo)))
      return { ok: false, reason: "todo-not-linked" };
    const todoText = await readRecord(todo, MAX_TODO_BYTES);
    const lines = todoText.replace(/\r\n/g, "\n").split("\n");
    const todoHeading = lines.findIndex((line) => /^# TODO\s*$/i.test(line));
    const exploreSection =
      todoHeading < 0
        ? -1
        : lines.findIndex(
            (line, index) => index > todoHeading && /^##\s+Explore later\s*$/i.test(line),
          );
    const exploreEnd = exploreSection < 0 ? -1 : lines.findIndex(
      (line, index) => index > exploreSection && /^#{1,2}\s/.test(line),
    );
    const todoSection =
      todoHeading < 0
        ? []
        : lines.slice(todoHeading + 1, exploreSection < 0 ? undefined : exploreSection);
    if (exploreEnd >= 0) todoSection.push(...lines.slice(exploreEnd));
    const checklist = todoSection
      .map((line) =>
        /^\s*(?:[-+*]|\d+\.)\s+\[([ xX])\]\s+([^\r\n]+)$/.exec(line),
      )
      .filter(Boolean);
    if (!checklist.length) return { ok: false, reason: "todo-list-required" };
    // Include ordering, dependencies, blockers, subheadings and checklist
    // state. Only the explicitly unapproved scratchpad is excluded.
    const tasks = todoSection.join("\n").trimEnd();
    return {
      ok: true,
      signature: createHash("sha256").update(JSON.stringify(tasks)).digest("hex"),
    };
  } catch {
    return { ok: false, reason: "records-unreadable-or-noncanonical" };
  }
}

export function createScope({
  location,
  getSession,
  verify = () => ({ ok: true }),
  validate = validateRecords,
  now = Date.now,
}) {
  let lease;
  let arming;
  let closed = false;
  const current = () => (lease && lease.expires > now() ? lease : undefined);
  const denied = (reason) => ({ ok: false, reason });
  const eligible = async (sessionID, signal) => {
    const s = await getSession(sessionID, signal);
    return (
      s?.id === sessionID &&
      s.location?.directory === location.directory &&
      s.location?.workspaceID === location.workspaceID &&
      s.projectID === location.project.id &&
      !s.parentID &&
      s.time?.archived === undefined
    );
  };
  return {
    eligible,
    async arm(input, signal) {
      if (closed) return denied("scope-unavailable");
      if (current() || arming) return denied("location-lease-in-use");
      const claim = { sessionID: input.sessionID, revoked: false };
      arming = claim;
      try {
        if (!(await eligible(input.sessionID, signal)))
          return denied("session-not-eligible");
        const binding = await verify(input, signal);
        if (!binding.ok) return binding;
        const result = await validate(input);
        if (!result.ok) return result;
        if (closed || claim.revoked || signal?.aborted)
          return denied("authorization-lost");
        lease = { ...input, token: randomUUID(), expires: Math.min(input.deadline ?? Infinity, now() + MAX_AGE) };
        return { ok: true, token: lease.token };
      } finally {
        arming = undefined;
      }
    },
    async check({ sessionID, token }, signal) {
      const authorized = current();
      if (authorized?.sessionID !== sessionID || authorized?.token !== token)
        return denied("authorization-lost");
      if (!(await eligible(sessionID, signal)))
        return denied("session-not-eligible");
      const binding = await verify(authorized, signal);
      if (!binding.ok) return binding;
      const result = await validate(authorized);
      return current() === authorized && !signal?.aborted
        ? result
        : denied("authorization-lost");
    },
    async release({ sessionID, token }) {
      if (lease?.sessionID === sessionID && lease?.token === token)
        lease = undefined;
      return { ok: true };
    },
    async stop({ sessionID }) {
      if (lease?.sessionID === sessionID) lease = undefined;
      if (arming?.sessionID === sessionID) arming.revoked = true;
      return { ok: true };
    },
    close() {
      closed = true;
      lease = undefined;
    },
  };
}
