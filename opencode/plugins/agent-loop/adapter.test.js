import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";
import { MAX_AGE, TURN_LIMIT } from "./loop.js";
import { createScope, validateRecords } from "./scope.js";
import { createServerAPI } from "./server-api.js";

const hook = registerHooks({
  resolve(specifier, context, next) {
    if (!/^@opencode\/plugin(?:\/(?:rpc|tui))?$/.test(specifier))
      return next(specifier, context);
    return {
      url: "data:text/javascript,export const Plugin = { define: x => x }; export const Rpc = Plugin",
      shortCircuit: true,
    };
  },
});
const { setup } = await import("./index.js");
const { setup: setupTui } = await import("./tui.js");
hook.deregister();

const sessionID = "ses_target";
const location = { directory: "/some/target worktree", project: { id: "p" } };
const nativeSession = {
  id: sessionID,
  location,
  projectID: "p",
  time: { created: 1, updated: 1, idle: 1 },
};
const auth = { sessionID };
const field = (id = sessionID, status = "in_progress") =>
  `---\ntitle: Fixture\nstatus: ${status}\nwork_session_id: ${id}\n---\n[TODO](fixture.todo)\n`;
const entry = (ticket, directory = dirname(ticket)) => ({
  key: "workspace-ticket",
  value: `Work on ticket Fixture (fixture.md). Exact OpenCode session ID: ${sessionID}. Canonical ticket Markdown: ${ticket}. Current status: in_progress. Workspace ticket directory: ${directory}. Workspace repository root: /work.`,
});

async function records(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "agent-loop-test-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ticket = join(dir, "fixture.md");
  const todo = join(dir, "fixture.todo");
  await writeFile(ticket, field());
  await writeFile(todo, "# TODO\n- [ ] First\n\n## Explore later\n- Compare later\n");
  return { sessionID, ticket, todo };
}

async function eventually(read, predicate) {
  for (let i = 0; i < 100; i++) {
    const value = await read();
    if (predicate(value)) return value;
    await sleep(5);
  }
  assert.fail("Expected condition was not reached");
}

async function install(t, input) {
  const f = {
    active: {},
    entries: input ? [entry(input.ticket)] : [],
    prompts: [],
    inbox: [],
    permissions: [],
    forms: [],
    messages: [],
  };
  let emitEvent;
  const events = [];
  f.cleanup = await setup(
    {
      location,
      session: {
        get: async () => f.session ?? nativeSession,
        active: async () => {
          if (f.activityError) throw new Error();
          return f.active;
        },
        inbox: { list: async () => f.inbox },
        form: { list: async () => f.sessionForms ?? [] },
        instructions: {
          entry: {
            list: async (args) => {
              assert.deepEqual(args, auth);
              return f.entries;
            },
          },
        },
        prompt: async (request, { signal }) => {
          assert.equal(signal.aborted, false);
          f.prompts.push(request);
          f.active = { [sessionID]: { type: "running" } };
          return { data: request };
        },
      },
      message: {
        list: async () => ({ data: f.messages, cursor: { next: null } }),
      },
      permission: { list: async () => f.permissions },
      form: { list: async () => f.forms },
      event: {
        async *subscribe({ signal, types }) {
          assert.ok(types.includes("session.inbox.enqueued"));
          signal.addEventListener("abort", () => emitEvent?.(), { once: true });
          while (!signal.aborted) {
            if (!events.length)
              await new Promise((resolve) => {
                emitEvent = resolve;
              });
            if (!signal.aborted) yield events.shift();
          }
        },
      },
      rpc: {
        async register(definition, handlers) {
          assert.equal(definition.id, "project-mgr-agent-loop");
          assert.deepEqual(Object.keys(definition.methods), [
            "discover",
            "start",
            "status",
            "stop",
          ]);
          assert.equal(
            Object.hasOwn(definition.methods.start.input.properties, "limit"),
            false,
          );
          assert.equal(
            definition.methods.status.output.properties.limit.enum[0],
            TURN_LIMIT,
          );
          f.controls = handlers;
          return {
            dispose: async () => {
              f.disposed = true;
            },
          };
        },
      },
    },
    { delay: (signal) => sleep(5, undefined, { signal }) },
  );
  t.after(() => (f.disposed ? undefined : f.cleanup()));
  f.emit = (type, data) => {
    events.push({ type, data, location });
    emitEvent?.();
  };
  f.status = () => f.controls.status(auth);
  f.waitReason = (reason) =>
    eventually(f.status, (status) => status.reason === reason);
  return f;
}

function tui(f, { confirm = true, onConfirm } = {}) {
  let commands, toast, preview;
  let budgetPrompted = false;
  const methods = [];
  const cleanup = setupTui({
    client: {
      rpc: () =>
        Object.fromEntries(
          Object.entries(f.controls).map(([method, handler]) => [
            method,
            async (input, options) => {
              assert.deepEqual(options.location, location);
              methods.push(method);
              return handler(input, options);
            },
          ]),
        ),
    },
    keymap: {
      layer: (factory) => {
        commands = factory().commands;
      },
    },
    data: { session: { get: () => nativeSession } },
    ui: {
      router: { current: () => ({ type: "session", sessionID }) },
      toast: {
        show: ({ message }) => {
          toast = message;
        },
      },
      dialog: {
        prompt: async () => {
          budgetPrompted = true;
        },
        confirm: async ({ message }) => {
          preview = message;
          onConfirm?.();
          return confirm;
        },
      },
    },
  });
  return {
    cleanup,
    methods,
    run: (action) =>
      commands.find(({ slash }) => slash.name === `agent-loop-${action}`).run(),
    toast: () => toast,
    preview: () => preview,
    budgetPrompted: () => budgetPrompted,
  };
}

test("start requires confirmation; server waits for active-to-idle and keeps running after TUI teardown", async (t) => {
  const input = await records(t);
  const f = await install(t, input);
  const cancelled = tui(f, { confirm: false });
  await cancelled.run("start");
  assert.deepEqual(cancelled.methods, ["discover"]);
  assert.deepEqual(await f.status(), { state: "off", reason: "not-armed" });
  cancelled.cleanup();

  // v2.1.4 session.get may show a stale idle time while execution is active.
  f.active = { [sessionID]: { type: "running" } };
  const first = tui(f);
  await first.run("start");
  for (const value of [
    sessionID,
    location.directory,
    input.ticket,
    input.todo,
    `Up to ${TURN_LIMIT} prompts`,
  ])
    assert.ok(first.preview().includes(value));
  assert.deepEqual(first.methods, ["discover", "start"]);
  assert.equal(first.budgetPrompted(), false);
  await f.waitReason("waiting-for-session-idle");
  assert.equal(f.prompts.length, 0);
  first.cleanup();
  assert.deepEqual(first.methods, ["discover", "start"]);
  assert.equal((await f.status()).state, "active");
  f.active = {};
  await f.waitReason("waiting-for-turn");
  assert.equal(f.prompts.length, 1);
  const [prompt] = f.prompts;
  assert.equal(prompt.sessionID, sessionID);
  assert.equal(prompt.delivery, "queue");
  assert.match(prompt.id, /^msg_/);
  assert.deepEqual(prompt.skills, [{ id: "agent-loop" }]);
  assert.ok(
    prompt.text.includes(input.ticket) && prompt.text.includes(input.todo),
  );

  const signature = (await validateRecords(input)).signature;
  await writeFile(
    input.todo,
    "# TODO\n- [ ] First\n\n## Explore later\n- [ ] Explore a different topic\n",
  );
  assert.equal((await validateRecords(input)).signature, signature);
  await writeFile(
    input.todo,
    "# TODO\n- [ ] First\n- [ ] Second\n\n## Explore later\n- Explore a different topic\n",
  );
  assert.notEqual((await validateRecords(input)).signature, signature);
  f.messages = [
    { id: "idle-1", type: "idle", outcome: "succeeded" },
    {
      id: "assistant-1",
      type: "assistant",
      finish: "stop",
      time: { completed: 1 },
      content: [
        { type: "text", text: `Agent loop checkpoint: ${prompt.id} ready` },
      ],
    },
    { id: "compaction-1", type: "compaction" },
    { id: prompt.id, type: "user" },
  ];
  f.active = {};
  await eventually(
    f.status,
    ({ turns, reason }) => turns === 2 && reason === "waiting-for-turn",
  );
  const reattached = tui(f);
  t.after(reattached.cleanup);
  await reattached.run("status");
  assert.match(
    reattached.toast(),
    new RegExp(`active: waiting-for-turn \\(2/${TURN_LIMIT} turns\\)`),
  );

  f.emit("form.created", { form: { sessionID } });
  await f.waitReason("form-requested");
  await reattached.run("status");
  assert.match(
    reattached.toast(),
    new RegExp(`paused: form-requested \\(2/${TURN_LIMIT} turns\\)`),
  );
  assert.equal(f.prompts.length, 2);
});

test("stop revokes startup and preserves authoritative paused status, while teardown clears state", async (t) => {
  const input = await records(t);
  const f = await install(t, input);
  f.active = { [sessionID]: { type: "running" } };
  await f.controls.start(input);
  await f.waitReason("waiting-for-session-idle");
  assert.equal(
    (await f.controls.stop({ sessionID: "ses_other" })).state,
    "off",
  );
  assert.equal((await f.status()).state, "active");
  const client = tui(f);
  t.after(client.cleanup);
  await client.run("stop");
  assert.match(client.toast(), /paused: user-paused/);
  f.active = {};
  await sleep(25);
  assert.equal(f.prompts.length, 0);
  assert.equal((await f.status()).reason, "user-paused");
  assert.equal((await f.controls.start(input)).state, "active");
  await f.cleanup();
  assert.equal(f.disposed, true);
  const fresh = await install(t, input);
  assert.deepEqual(await fresh.status(), { state: "off", reason: "not-armed" });
});

test("confirmed paths are independently revalidated before any server prompt", async (t) => {
  const input = await records(t);
  const f = await install(t, input);
  const client = tui(f, {
    onConfirm: () => {
      f.entries = [entry(join(dirname(input.ticket), "lookalike.md"))];
    },
  });
  t.after(client.cleanup);
  await client.run("start");
  await f.waitReason("workspace-ticket-path-mismatch");
  assert.equal(f.prompts.length, 0);
  const original = await validateRecords(input);
  await writeFile(
    input.todo,
    "# TODO\n- [ ] First\n\n## Explore later\n- Different scratchpad only\n",
  );
  assert.equal((await validateRecords(input)).signature, original.signature);
  await writeFile(input.ticket, field("ses_other"));
  assert.equal(
    (await validateRecords(input)).reason,
    "ticket-not-active-for-session",
  );
  await writeFile(input.ticket, field(sessionID, "draft"));
  assert.equal(
    (await validateRecords(input)).reason,
    "ticket-not-active-for-session",
  );
  await writeFile(input.ticket, field());
  await writeFile(input.todo, "# TODO\n\n## Explore later\n- [ ] Future task\n");
  assert.equal(
    (await validateRecords(input)).reason,
    "todo-list-required",
  );
  await writeFile(input.todo, "Not a TODO list.");
  assert.equal((await validateRecords(input)).reason, "todo-list-required");
  await writeFile(input.todo, `# TODO\n- [ ] ${"x".repeat(32 * 1024)}\n`);
  assert.equal(
    (await validateRecords(input)).reason,
    "records-unreadable-or-noncanonical",
  );
  assert.equal(
    (await validateRecords({ ...input, todo: input.ticket })).reason,
    "invalid-record-paths-or-session",
  );
});

test("foreign stops, mismatched releases and stale tokens cannot revoke a lease", async () => {
  let now = 0;
  const scope = createScope({
    location,
    getSession: async () => nativeSession,
    validate: () => ({ ok: true }),
    now: () => now,
  });
  const input = { sessionID, ticket: "/tickets/fixture.md" };
  const [lease, duplicate] = await Promise.all([
    scope.arm(input),
    scope.arm(input),
  ]);
  assert.equal(duplicate.reason, "location-lease-in-use");
  const claim = { sessionID, token: lease.token };
  await scope.stop({ sessionID: "ses_other" });
  await scope.release({ ...claim, token: "wrong" });
  assert.equal((await scope.check(claim)).ok, true);
  now = MAX_AGE;
  assert.equal((await scope.check(claim)).reason, "authorization-lost");
  const next = { sessionID, token: (await scope.arm(input)).token };
  await scope.release(claim);
  assert.equal((await scope.check(next)).ok, true);
  await scope.stop({ sessionID });
  assert.equal((await scope.check(next)).reason, "authorization-lost");
});

test("v2.1.4 fallback uses read-only OpenAPI paths and fails closed on missing status or history", async () => {
  let active = { data: {} };
  let inbox = [];
  let sessionForms = [];
  let locationForms = [];
  let permissions = [];
  let history = {
    data: [{ id: "msg_own", type: "user" }],
    cursor: { next: "opaque" },
  };
  const calls = [];
  const api = createServerAPI(
    {
      location,
      session: { get: async () => nativeSession },
      permission: { list: async () => ({ data: permissions }) },
    },
    async (path, signal) => {
      assert.equal(signal.aborted, false);
      calls.push(path);
      return {
        [`/api/experimental/session/${sessionID}/instructions/entries`]: {
          data: [entry("/tickets/fixture.md")],
        },
        [`/api/session/${sessionID}/inbox`]: { data: inbox },
        [`/api/session/${sessionID}/form`]: { data: sessionForms },
        "/api/form": { data: locationForms },
        "/api/session/active": active,
        [`/api/session/${sessionID}/message?order=desc&limit=100`]: history,
        [`/api/session/${sessionID}/message?cursor=opaque&limit=100`]: {
          data: [],
          cursor: { next: null },
        },
      }[path];
    },
  );
  const run = { sessionID, turn: { id: "msg_own", baseline: null } };
  assert.equal((await api.discover(run)).ticket, "/tickets/fixture.md");
  assert.deepEqual(await api.snapshot(run), { busy: false, ownPending: false });
  active = { data: { [sessionID]: { type: "running" } } };
  assert.equal((await api.snapshot(run)).busy, true);
  inbox = [{ id: run.turn.id }];
  assert.equal((await api.snapshot(run)).ownPending, true);
  inbox.push({ id: "msg_other" });
  assert.equal((await api.snapshot(run)).reason, "other-input-pending");
  sessionForms = [{}];
  assert.equal((await api.snapshot(run)).reason, "form-requested");
  sessionForms = [];
  locationForms = [{}];
  assert.equal((await api.snapshot(run)).reason, "form-requested");
  permissions = [{}];
  assert.equal((await api.snapshot(run)).reason, "permission-requested");
  permissions = locationForms = inbox = [];
  active = { data: { [sessionID]: { type: "unknown" } } };
  assert.equal((await api.snapshot(run)).reason, "activity-status-unavailable");
  assert.equal((await api.history(run)).truncated, false);
  assert.ok(
    calls.includes(`/api/session/${sessionID}/message?cursor=opaque&limit=100`),
  );
  history = { data: [] };
  await assert.rejects(api.history(run), /history unavailable/);
});

test("activity failure pauses the actual server runner without submitting", async (t) => {
  const input = await records(t);
  const f = await install(t, input);
  f.activityError = true;
  await f.controls.start(input);
  assert.equal((await f.waitReason("reconciliation-error")).state, "paused");
  assert.deepEqual(f.prompts, []);
});
