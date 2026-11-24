import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createModelGateAPI } from "./api.js";

const sessionID = "ses_fixture";
const location = {
  directory: "/fixture/worktree",
  workspaceID: "workspace-fixture",
  project: { id: "project-fixture" },
};
const session = (overrides = {}) => ({
  id: sessionID,
  location: { directory: location.directory, workspaceID: location.workspaceID },
  projectID: location.project.id,
  outcome: "succeeded",
  ...overrides,
});
const idle = (id = "idle-fixture", outcome = "succeeded") => ({
  id,
  type: "idle",
  outcome,
});
const assistant = (text = "The scoped task is complete.", overrides = {}) => ({
  id: "assistant-fixture",
  type: "assistant",
  finish: "stop",
  time: { completed: 123 },
  content: [{ type: "text", text }],
  ...overrides,
});
const entry = (ticketPath) => ({
  key: "workspace-ticket",
  value: `Work on ticket Fixture (${ticketPath.split("/").at(-1)}). Exact OpenCode session ID: ${sessionID}. Canonical ticket Markdown: ${ticketPath}. Current status: in_progress. Workspace ticket directory: ${ticketPath.slice(0, ticketPath.lastIndexOf("/"))}. Workspace repository root: /fixture.`,
});

async function ticketRecords(t, { status = "in_progress", bindSession = sessionID } = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "model-gate-api-test-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const ticket = join(directory, "fixture-ticket.md");
  await writeFile(
    ticket,
    `---\ntitle: Fixture ticket\nstatus: ${status}\nwork_session_id: ${bindSession}\n---\n## Tasks\n- [ ] Continue scoped work\n`,
  );
  return { ticket };
}

function context(overrides = {}) {
  const calls = [];
  const state = {
    session: session(),
    entries: [],
    active: {},
    inbox: [],
    permissions: [],
    forms: [],
    locationForms: [],
    history: [idle(), assistant()],
    historyCursorNext: null,
    ...overrides.state,
  };
  const ctx = {
    location: overrides.location ?? location,
    session: {
      get: async (args) => {
        calls.push(["get", args]);
        return { data: state.session };
      },
      list: async (args) => {
        calls.push(["list", args]);
        return overrides.list?.(args);
      },
      instructions: {
        entry: {
          list: async (args) => {
            calls.push(["entries", args]);
            return { data: state.entries };
          },
        },
      },
      inbox: {
        list: async (args) => {
          calls.push(["inbox", args]);
          return { data: state.inbox };
        },
      },
      active: async () => {
        calls.push(["active"]);
        return { data: state.active };
      },
      form: {
        list: async (args) => {
          calls.push(["sessionForms", args]);
          return { data: state.forms };
        },
      },
      generate: async (args) => {
        calls.push(["generate", args]);
        return overrides.generate?.(args) ?? { data: { text: '{"decision":"continue","reason":"Ready."}' } };
      },
      prompt: async (args) => {
        calls.push(["prompt", args]);
        return { data: args };
      },
    },
    permission: {
      list: async (args) => {
        calls.push(["permissions", args]);
        return { data: state.permissions };
      },
    },
    form: {
      list: async (args) => {
        calls.push(["locationForms", args]);
        return { data: state.locationForms };
      },
    },
    message: {
      list: async (args) => {
        calls.push(["messages", args]);
        return {
          data: state.history,
          cursor: { next: state.historyCursorNext },
        };
      },
    },
  };
  return { api: createModelGateAPI(ctx), calls, ctx, state };
}

test("sessions paginates in the current directory and deduplicates valid IDs", async () => {
  const pages = [];
  const f = context({
    list: async (args) => {
      pages.push(args);
      return pages.length === 1
        ? { data: [{ id: "ses_one" }, { id: "ses_repeat" }, {}, { id: 7 }], cursor: { next: "page-2" } }
        : { data: [{ id: "ses_repeat" }, { id: "ses_two" }], cursor: { next: null } };
    },
  });

  assert.deepEqual(await f.api.sessions(), ["ses_one", "ses_repeat", "ses_two"]);
  assert.deepEqual(pages, [
    { directory: location.directory, limit: 100 },
    { directory: location.directory, limit: 100, cursor: "page-2" },
  ]);
});

test("binding permits a session in another worktree of the same project", async (t) => {
  const records = await ticketRecords(t);
  const f = context({ state: { session: session({ location: { directory: "/elsewhere", workspaceID: location.workspaceID } }), entries: [entry(records.ticket)] } });
  assert.equal((await f.api.binding(sessionID)).ok, true);
});

test("worktree sessions still require the current project and exact ticket binding", async (t) => {
  const records = await ticketRecords(t);
  const f = context({
    location: { ...location, workspaceID: undefined },
    state: {
      session: session({ location: { directory: "/fixture/go-gui-worktree", workspaceID: null } }),
      entries: [entry(records.ticket)],
    },
  });
  const allowedAPI = createModelGateAPI(f.ctx);
  const allowed = await allowedAPI.binding(sessionID);
  assert.equal(allowed.ok, true);

  const otherSession = await allowedAPI.binding("ses_other");
  assert.deepEqual(otherSession, { ok: false, reason: "session-not-eligible" });

  f.state.session = session({
    location: { directory: "/fixture/go-gui-worktree", workspaceID: location.workspaceID },
    projectID: "other-project",
  });
  assert.deepEqual(await allowedAPI.binding(sessionID), { ok: false, reason: "session-not-eligible" });
});

test("binding rejects absent exact ticket evidence and invalid records", async (t) => {
  const records = await ticketRecords(t);
  const noEntry = context();
  noEntry.state.entries = [];
  const missing = await noEntry.api.binding(sessionID);
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "workspace-ticket-entry-required");

  const wrongSessionEntry = context();
  wrongSessionEntry.state.entries = [{
    ...entry(records.ticket),
    value: entry(records.ticket).value.replace(`Exact OpenCode session ID: ${sessionID}`, "Exact OpenCode session ID: ses_other"),
  }];
  assert.deepEqual(await wrongSessionEntry.api.binding(sessionID), {
    ok: false,
    reason: "workspace-ticket-entry-malformed",
  });

  const invalidRecords = context();
  invalidRecords.state.entries = [entry(records.ticket)];
  await writeFile(records.ticket, "---\ntitle: Fixture ticket\nstatus: complete\nwork_session_id: ses_other\n---\n## Tasks\n- [ ] Continue scoped work\n");
  const invalid = await invalidRecords.api.binding(sessionID);
  assert.equal(invalid.ok, false);
  assert.equal(invalidRecords.calls.some(([name]) => name === "generate"), false);
});

test("binding supplies the current ticket content with a content fingerprint", async (t) => {
  const records = await ticketRecords(t);
  const f = context({ state: { entries: [entry(records.ticket)] } });

  const first = await f.api.binding(sessionID);
  assert.equal(first.ok, true);
  assert.match(first.ticketContent, /Fixture ticket/);
  assert.match(first.signature, /^[a-f0-9]{64}$/);

  await writeFile(records.ticket, `---\ntitle: Changed ticket\nstatus: in_progress\nwork_session_id: ${sessionID}\n---\n## Tasks\n- [ ] Continue scoped work\n`);
  const changed = await f.api.binding(sessionID);
  assert.equal(changed.ok, true);
  assert.notEqual(changed.signature, first.signature);
});

test("hardCheck rejects active sessions, pending inbox, permission, and forms", async () => {
  const cases = [
    [{ active: { [sessionID]: { type: "running" } } }, "session-not-idle"],
    [{ inbox: [{ id: "msg_pending" }] }, "other-input-pending"],
    [{ permissions: [{ id: "permission_pending" }] }, "permission-requested"],
    [{ forms: [{ id: "form_pending" }] }, "form-requested"],
    [{ locationForms: [{ id: "location-form" }] }, "form-requested"],
  ];
  for (const [state, reason] of cases) {
    const f = context({ state });
    assert.deepEqual(await f.api.hardCheck(sessionID), { ok: false, reason });
    assert.equal(f.calls.some(([name]) => name === "messages"), false);
  }

  for (const [state, reason] of [
    [{ inbox: undefined }, "inbox-status-unavailable"],
    [{ permissions: undefined }, "permission-status-unavailable"],
    [{ forms: undefined }, "session-form-status-unavailable"],
    [{ locationForms: undefined }, "location-form-status-unavailable"],
  ]) {
    const f = context({ state });
    assert.deepEqual(await f.api.hardCheck(sessionID), { ok: false, reason });
    assert.equal(f.calls.some(([name]) => name === "messages"), false);
  }
});

test("hardCheck rejects unsuccessful execution and unconfirmed or ambiguous latest history", async () => {
  const unsuccessful = context({ state: { session: session({ outcome: "failed" }) } });
  assert.deepEqual(await unsuccessful.api.hardCheck(sessionID), {
    ok: false,
    reason: "execution-not-successful",
  });

  for (const state of [
    { history: [idle("idle-failed", "failed"), assistant()] },
    { history: [assistant(), idle()] },
    { history: [], historyCursorNext: "older-history" },
    { history: [idle(), assistant("   ")] },
  ]) {
    const f = context({ state });
    const result = await f.api.hardCheck(sessionID);
    assert.equal(result.ok, false);
  }
});

test("hardCheck accepts a successful idle followed by a completed assistant response", async () => {
  const f = context({ state: { history: [idle("idle-current"), assistant("Verified the approved task.")] } });

  assert.deepEqual(await f.api.hardCheck(sessionID), {
    ok: true,
    idleID: "idle-current",
    lastMessage: "Verified the approved task.",
  });
});

test("hardCheck permits cross-worktree sessions and checks that location's forms", async () => {
  const f = context({
    location: { ...location, workspaceID: undefined },
    state: {
      session: session({ location: { directory: "/fixture/go-gui-worktree", workspaceID: null } }),
    },
  });
  const api = createModelGateAPI(f.ctx);
  assert.deepEqual(await api.hardCheck(sessionID), {
    ok: true,
    idleID: "idle-fixture",
    lastMessage: "The scoped task is complete.",
  });
  const forms = f.calls.find(([name]) => name === "locationForms")[1];
  assert.equal(forms.location.directory, "/fixture/go-gui-worktree");
});

test("hardCheck fails closed when cross-worktree location forms cannot be checked", async () => {
  const f = context({
    location: { ...location, workspaceID: undefined },
    state: {
      session: session({ location: { directory: "/fixture/go-gui-worktree", workspaceID: null } }),
    },
  });
  f.ctx.form.list = undefined;
  const api = createModelGateAPI(f.ctx);
  assert.deepEqual(await api.hardCheck(sessionID), {
    ok: false,
    reason: "location-form-status-unavailable",
  });
});

test("diagnose identifies the unavailable pending-state surface without reading history", async () => {
  const f = context({ state: { locationForms: undefined } });
  const api = createModelGateAPI(f.ctx);

  assert.deepEqual(await api.diagnose(sessionID), {
    state: "unavailable",
    reason: "location-form-status-unavailable",
  });
  assert.equal(f.calls.some(([name]) => name === "messages"), false);

  f.state.locationForms = [];
  assert.deepEqual(await api.diagnose(sessionID), {
    state: "ready",
    reason: "pending-status-clear",
  });
  assert.equal(f.calls.some(([name]) => name === "messages"), false);
});

test("decide uses session.generate and returns generated text without prompting", async () => {
  const f = context({
    generate: async (args) => ({ data: { text: '{"decision":"continue","reason":"One task remains."}' } }),
  });
  const result = await f.api.decide({
    sessionID,
    ticket: "/tickets/fixture.md",
    ticketContent: "# Current ticket\nStatus: in_progress\n## Tasks\n- [ ] Continue",
    lastMessage: "Current response.",
  });

  assert.equal(result, '{"decision":"continue","reason":"One task remains."}');
  assert.deepEqual(f.calls.map(([name]) => name), ["generate"]);
  const request = f.calls[0][1];
  assert.equal(request.sessionID, sessionID);
  assert.match(request.prompt, /decision, task, and reason/);
  assert.match(request.prompt, /exactly copy one unchecked task/);
  assert.match(request.prompt, /Current response\./);
  assert.match(request.prompt, /Current ticket Markdown/);
  assert.doesNotMatch(request.prompt, /Current linked TODO/);
  assert.match(request.prompt, /Current ticket/);
  assert.match(request.prompt, /Continue/);
});

test("prompt queues a continuation message through session.prompt", async () => {
  const f = context();
  const request = {
    sessionID,
    id: "msg_continuation",
    ticket: "/tickets/fixture.md",
    task: "Continue scoped work",
    reason: "Ticket task is ready.",
  };

  const result = await f.api.prompt(request);
  assert.deepEqual(f.calls.map(([name]) => name), ["prompt"]);
  assert.deepEqual(result, { data: f.calls[0][1] });
  assert.equal(f.calls[0][1].sessionID, sessionID);
  assert.equal(f.calls[0][1].id, request.id);
  assert.equal(f.calls[0][1].delivery, "queue");
  assert.match(f.calls[0][1].text, /Continue the approved ticket/);
  assert.match(f.calls[0][1].text, /fixture\.md/);
  assert.doesNotMatch(f.calls[0][1].text, /fixture\.todo/);
  assert.match(f.calls[0][1].text, /Ticket task is ready/);
  assert.match(f.calls[0][1].text, /exact unchecked task: "Continue scoped work"/);
});
