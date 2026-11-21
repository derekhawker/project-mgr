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

function durable(snapshot = []) {
  const records = new Map(snapshot);
  return {
    records,
    get: async (key) => structuredClone(records.get(key)),
    set: async (key, value) => { records.set(key, JSON.parse(JSON.stringify(value))); },
  };
}

async function install(t, input, { storage = durable(), where = location, before, ...options } = {}) {
  const f = {
    active: {},
    entries: input ? [entry(input.ticket)] : [],
    prompts: [],
    inbox: [],
    permissions: [],
    forms: [],
    messages: [],
    log: [],
  };
  before?.(f);
  let emitEvent;
  const events = [];
  f.cleanup = await setup(
    {
      location: where,
      storage,
      session: {
        get: async (args) => f.session ?? {
          ...nativeSession, id: args.sessionID, location: where, projectID: where.project.id,
        },
        active: async () => {
          if (f.activityError) throw new Error();
          if (f.readActive) await f.readActive();
          return f.active;
        },
        inbox: { list: async () => f.inbox },
        form: { list: async () => f.sessionForms ?? [] },
        instructions: {
          entry: {
            list: async (args) => {
              assert.equal(args.sessionID, input?.sessionID ?? sessionID);
              return f.entries;
            },
          },
        },
        prompt: async (request, { signal }) => {
          assert.equal(signal.aborted, false);
          f.prompts.push(request);
          if (f.admit) return f.admit(request);
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
    {
      delay: (signal) => sleep(5, undefined, { signal }),
      admissionGrace: 25,
      async *readLog(path) {
        const after = new URL(path, "http://fixture").searchParams.get("after");
        yield* f.log.filter((event) => after === null || event.durable.seq > Number(after));
        if (!f.logUnavailable) yield {
          type: "log.synced", aggregateID: input?.sessionID ?? sessionID,
          seq: f.log.at(-1)?.durable.seq,
        };
      },
      ...options,
    },
  );
  t.after(() => (f.disposed ? undefined : f.cleanup()));
  f.emit = (type, data, durable) => {
    events.push({ type, data, durable, location: where });
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

test("stop revokes startup and preserves the terminal reason after teardown", async (t) => {
  const input = await records(t);
  const storage = durable();
  const f = await install(t, input, { storage });
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
  await f.cleanup();
  assert.equal(f.disposed, true);
  const fresh = await install(t, input, { storage });
  assert.deepEqual(await fresh.status(), {
    state: "paused", reason: "user-paused", turns: 0, limit: TURN_LIMIT,
  });
  assert.deepEqual(fresh.prompts, []);
});

const completed = (id, checkpoint = "ready", baseline = []) => [
  { id: `idle-${id}`, type: "idle", outcome: "succeeded" },
  {
    id: `answer-${id}`, type: "assistant", finish: "stop", time: { completed: 1 },
    content: [{ type: "text", text: `Agent loop checkpoint: ${id} ${checkpoint}` }],
  },
  { id, type: "user" },
  ...baseline,
];

test("automatically adopts an admitted prompt across teardown before its receipt, then continues once", async (t) => {
  const input = await records(t);
  const storage = durable();
  let receipt;
  const f = await install(t, input, { storage });
  f.admit = (request) => {
    const [saved] = storage.records.values();
    assert.equal(saved.phase, "turn");
    assert.equal(saved.turn.id, request.id);
    assert.equal(saved.turns, 1);
    assert.equal(JSON.stringify(saved).includes("Continue the approved ticket"), false);
    assert.equal(JSON.stringify(saved).includes("First"), false);
    assert.equal(Object.hasOwn(saved, "token"), false);
    return new Promise((resolve) => { receipt = resolve; });
  };
  await f.controls.start(input);
  await eventually(() => f.prompts.length, (n) => n === 1);
  const [{ id }] = f.prompts;
  const [prior] = storage.records.values();
  await f.cleanup();

  const recovered = await install(t, input, {
    storage,
    before(f) { f.inbox = [{ id }]; },
  });
  await recovered.waitReason("waiting-for-pending-prompt");
  assert.deepEqual(recovered.prompts, []);
  receipt(f.prompts[0]);
  await writeFile(input.todo, "# TODO\n- [ ] Second\n");
  recovered.messages = completed(id);
  recovered.inbox = [];
  await eventually(recovered.status, (s) => s.turns === 2 && s.reason === "waiting-for-turn");
  assert.equal(recovered.prompts.length, 1);
  assert.notEqual(recovered.prompts[0].id, id);
  const [next] = storage.records.values();
  assert.equal(next.runID, prior.runID);
  assert.equal(next.deadline, prior.deadline);
  assert.equal(next.turn.baseline, recovered.messages[0].id);
});

test("teardown after journal reservation but before first call recovers the original ID", async (t) => {
  const input = await records(t);
  const storage = durable();
  const save = storage.set;
  let release;
  storage.set = async (key, value) => {
    await save(key, value);
    if (value.phase === "turn" && !value.turn.attempted) await new Promise((resolve) => { release = resolve; });
  };
  const f = await install(t, input, { storage });
  await f.controls.start(input);
  await eventually(() => release, Boolean);
  const closing = f.cleanup();
  release();
  await closing;
  const [reserved] = storage.records.values();
  assert.equal(f.prompts.length, 0);
  const recovered = await install(t, input, { storage });
  assert.equal((await recovered.waitReason("waiting-for-turn")).turns, 1);
  assert.deepEqual(recovered.prompts.map(({ id }) => id), [reserved.turn.id]);
  assert.deepEqual([...storage.records.values()], [{ ...reserved, turn: { ...reserved.turn, attempted: true } }]);
});

test("same-ID recovery fingerprints approved TODO notes but ignores Explore later", async (t) => {
  for (const { name, todo, reason, retries } of [
    {
      name: "blocker note vetoes",
      todo: "## Blockers\n- Wait for approval.\n",
      reason: "todo-changed-before-admission", retries: false,
    },
    {
      name: "unapproved scratchpad edit still retries",
      todo: "## Explore later\n- Compare a different approach later\n",
      reason: "waiting-for-turn", retries: true,
    },
  ]) await t.test(name, async (t) => {
    const input = await records(t);
    const storage = durable();
    const save = storage.set;
    let release;
    storage.set = async (key, value) => {
      await save(key, value);
      if (value.phase === "turn" && !value.turn.attempted) await new Promise((resolve) => { release = resolve; });
    };
    const original = await install(t, input, { storage });
    await original.controls.start(input);
    await eventually(() => release, Boolean);
    const closing = original.cleanup();
    release();
    await closing;
    const [reserved] = storage.records.values();
    await writeFile(input.todo, `# TODO\n- [ ] First\n\n${todo}`);
    const recovered = await install(t, input, { storage });
    const status = await recovered.waitReason(reason);
    assert.equal(status.state, retries ? "active" : "paused");
    assert.equal(status.turns, 1);
    assert.deepEqual(original.prompts, []);
    assert.deepEqual(recovered.prompts.map(({ id }) => id), retries ? [reserved.turn.id] : []);
  });
});

test("recovering replays foreign enqueue even if it was cancelled while unloaded", async (t) => {
  const input = await records(t);
  const storage = durable();
  const event = (type, seq, inboxID) => ({
    type, durable: { aggregateID: sessionID, seq }, data: { inboxID, text: "never stored" },
  });
  const past = event("session.inbox.enqueued", 8, "msg_past");
  const original = await install(t, input, { storage, before(f) { f.log = [past]; } });
  await original.controls.start(input);
  await original.waitReason("waiting-for-turn");
  const [saved] = storage.records.values();
  assert.equal(saved.turn.logAfter, 8);
  await original.cleanup();
  const recovered = await install(t, input, { storage, before(f) {
    f.log = [past, event("session.inbox.enqueued", 9, "msg_foreign"),
      event("session.inbox.cancelled", 10, "msg_foreign")];
    f.messages = completed(saved.turn.id);
  } });
  assert.equal((await recovered.waitReason("other-input")).state, "paused");
  assert.deepEqual(recovered.prompts, []);
  assert.ok(!JSON.stringify([...storage.records]).includes("never stored"));
});

test("initial recovery vetoes cancelled foreign input only after the persisted log watermark", async (t) => {
  for (const watermark of [null, 8]) await t.test(`watermark: ${watermark}`, async (t) => {
    const input = await records(t);
    const storage = durable();
    const event = (type, seq, inboxID) => ({
      type: `session.inbox.${type}`, durable: { aggregateID: sessionID, seq }, data: { inboxID },
    });
    const past = watermark === null ? [] : [event("enqueued", 8, "msg_past")];
    const original = await install(t, input, { storage, before(f) {
      f.log = past;
      f.active = { [sessionID]: { type: "running" } };
    } });
    await original.controls.start(input);
    await original.waitReason("waiting-for-session-idle");
    assert.equal([...storage.records.values()][0].initialLogAfter, watermark);
    await original.cleanup();
    // Restore against a separate copy of the same initial journal with no
    // later events. Prior, pre-arm work must not veto an otherwise safe start.
    const unchanged = await install(t, input, { storage: durable([...storage.records]), before(f) {
      f.log = past;
    } });
    assert.equal((await unchanged.waitReason("waiting-for-turn")).turns, 1);
    assert.equal(unchanged.prompts.length, 1);
    await unchanged.cleanup();

    const recovered = await install(t, input, { storage, before(f) {
      f.log = [...past, event("enqueued", 9, "msg_other"), event("cancelled", 10, "msg_other")];
    } });
    assert.equal((await recovered.waitReason("other-input")).turns, 0);
    assert.deepEqual(recovered.prompts, []);
  });
});

test("a stop while waiting to read recovery state survives repeated terminal write rejection and reload", async (t) => {
  const input = await records(t);
  const storage = durable();
  const original = await install(t, input, { storage });
  await original.controls.start(input);
  await original.waitReason("waiting-for-turn");
  await original.cleanup();
  const { get, set } = storage;
  let readFails = true;
  let writeFails = true;
  storage.get = async (key) => { if (readFails) throw Error(); return get(key); };
  storage.set = async (key, value) => { if (writeFails) throw Error(); return set(key, value); };
  const recovering = await install(t, input, { storage });
  assert.equal((await recovering.controls.stop(auth)).reason, "user-paused-not-saved");
  readFails = false;
  await recovering.waitReason("user-paused-not-saved");
  await eventually(() => recovering.status(), (s) => s.turns === 1 && s.reason === "user-paused-not-saved");
  await recovering.cleanup();
  assert.equal([...storage.records.values()][0].phase, "turn");
  writeFails = false;
  const next = await install(t, input, { storage });
  await next.waitReason("user-paused");
  assert.deepEqual(recovering.prompts.concat(next.prompts), []);
  await next.cleanup();
  assert.equal([...storage.records.values()][0].phase, "terminal");
});

test("stop from a non-owning instance vetoes the old owner and the next recovery", async (t) => {
  const input = await records(t);
  const storage = durable();
  const original = await install(t, input, { storage });
  original.active = { [sessionID]: { type: "running" } };
  await original.controls.start(input);
  await original.waitReason("waiting-for-session-idle");
  const next = await install(t, input, { storage });
  assert.equal((await next.controls.stop(auth)).reason, "user-paused-not-saved");
  await original.waitReason("user-paused");
  await original.cleanup();
  await next.waitReason("user-paused");
  assert.deepEqual(original.prompts.concat(next.prompts), []);
});

test("shutdown waits for a resumed exact turn; user interrupt is a durable veto", async (t) => {
  for (const [name, timeline] of [
    ["shutdown", ["shutdown"]],
    ["user", ["user"]],
    ["user vetoes after a shutdown and restart", ["shutdown", "started", "user"]],
  ]) await t.test(name, async (t) => {
    const input = await records(t);
    const storage = durable();
    const original = await install(t, input, { storage });
    await original.controls.start(input);
    await original.waitReason("waiting-for-turn");
    const [{ id }] = original.prompts;
    const reason = timeline.at(-1);
    for (const cause of timeline) {
      if (cause !== "started") original.emit("session.execution.interrupted", { sessionID, reason: cause });
    }
    await original.waitReason(reason === "shutdown" ? "waiting-for-server-resume" : "execution-interrupted");
    // Leave user interrupt to be independently replayed if the old process
    // died before its terminal write landed.
    const [key, armed] = [...storage.records][0];
    await original.cleanup();
    if (reason === "user") await storage.set(key, { ...armed, phase: "turn", reason: null });
    const interrupted = [{ id: "idle-interrupted", type: "idle", outcome: "interrupted" }, { id, type: "user" }];
    const resumed = await install(t, input, { storage, before(f) {
      f.messages = interrupted;
      f.log = timeline.map((cause, i) => ({
        type: cause === "started" ? "session.execution.started" : "session.execution.interrupted",
        durable: { aggregateID: sessionID, seq: i + 1 },
        data: cause === "started" ? { sessionID } : { sessionID, reason: cause },
      }));
    } });
    if (reason === "user") {
      await resumed.waitReason("execution-interrupted");
      assert.deepEqual(resumed.prompts, []);
      return;
    }
    await resumed.waitReason("waiting-for-server-resume");
    assert.deepEqual(resumed.prompts, []);
    await writeFile(input.todo, "# TODO\n- [ ] Next\n");
    resumed.log.push({ type: "session.execution.started", durable: { aggregateID: sessionID, seq: 2 }, data: { sessionID } });
    resumed.messages = [...completed(id).slice(0, 2), ...interrupted];
    await eventually(() => resumed.prompts.length, (n) => n === 1);
    assert.notEqual(resumed.prompts[0].id, id);
    assert.equal((await resumed.status()).turns, 2);
  });
});

test("interrupt during the final retry snapshot vetoes prompt admission", async (t) => {
  for (const reason of ["shutdown", "user"]) await t.test(reason, async (t) => {
    const input = await records(t);
    const storage = durable();
    const original = await install(t, input, { storage });
    await original.controls.start(input);
    await original.waitReason("waiting-for-turn");
    const [{ id }] = original.prompts;
    await original.cleanup();

    const finalSnapshot = Promise.withResolvers();
    let snapshots = 0;
    const recovered = await install(t, input, { storage, admissionGrace: 0, before(f) {
      f.readActive = () => ++snapshots === 3 ? finalSnapshot.promise : undefined;
    } });
    await eventually(() => snapshots, (count) => count === 3);
    recovered.emit("session.execution.interrupted", { sessionID, reason }, { aggregateID: sessionID, seq: 1 });
    await recovered.waitReason(reason === "shutdown" ? "waiting-for-server-resume" : "execution-interrupted");
    finalSnapshot.resolve();
    if (reason === "user") {
      await recovered.cleanup();
      assert.deepEqual(recovered.prompts, []);
      return;
    }

    // With the log projection still lagging the live event, another reconcile
    // cycle must run without admitting the retry even though its snapshot passed.
    await eventually(() => snapshots, (count) => count > 3);
    assert.deepEqual(recovered.prompts, []);
    recovered.log = [
      { type: "session.execution.interrupted", durable: { aggregateID: sessionID, seq: 1 }, data: { sessionID, reason } },
      { type: "session.execution.started", durable: { aggregateID: sessionID, seq: 2 }, data: { sessionID } },
    ];
    recovered.messages = [{ id, type: "user" }];
    const prior = snapshots;
    await eventually(() => snapshots, (count) => count > prior);
    assert.deepEqual(recovered.prompts, []);
    await writeFile(input.todo, "# TODO\n- [ ] Next\n");
    recovered.messages = completed(id);
    await eventually(() => recovered.prompts.length, (count) => count === 1);
    assert.notEqual(recovered.prompts[0].id, id);
    assert.equal((await recovered.status()).turns, 2);
  });
});

test("Stop retries an unsaved terminal intent once storage recovers", async (t) => {
  const input = await records(t);
  const storage = durable();
  const write = storage.set;
  let failures = 0;
  storage.set = async (key, value) => {
    if (value.phase === "terminal" && failures < 2) {
      failures++;
      throw new Error("storage unavailable");
    }
    await write(key, value);
  };
  const original = await install(t, input, { storage });
  await original.controls.start(input);
  await original.waitReason("waiting-for-turn");
  assert.equal((await original.controls.stop(auth)).reason, "user-paused-not-saved");
  assert.equal((await original.controls.stop(auth)).reason, "user-paused-not-saved");
  assert.equal([...storage.records.values()][0].phase, "turn");
  assert.equal((await original.controls.stop(auth)).reason, "user-paused");
  assert.equal([...storage.records.values()][0].phase, "terminal");
  await original.cleanup();
  const recovered = await install(t, input, { storage });
  assert.equal((await recovered.status()).reason, "user-paused");
  assert.deepEqual(recovered.prompts, []);
});

const execution = (action, seq, reason) => ({
  type: `session.execution.${action}`, durable: { aggregateID: sessionID, seq },
  data: { sessionID, ...(reason && { reason }) },
});

test("shutdown found only by the continuation read never advances the previous watermark", async (t) => {
  const input = await records(t);
  const storage = durable();
  const original = await install(t, input, { storage });
  await original.controls.start(input);
  await original.waitReason("waiting-for-turn");
  const [{ id }] = original.prompts;
  const [before] = storage.records.values();
  await writeFile(input.todo, "# TODO\n- [ ] Next\n");
  let snapshots = 0;
  original.readActive = () => {
    if (++snapshots === 2) original.log.push(execution("interrupted", 1, "shutdown"));
  };
  original.messages = completed(id);
  original.active = {};
  await original.waitReason("waiting-for-server-resume");
  assert.deepEqual([...storage.records.values()], [before]);
  assert.equal(original.prompts.length, 1);
  await original.cleanup();

  const recovered = await install(t, input, { storage, before(f) {
    f.messages = completed(id);
    f.log = original.log;
  } });
  await recovered.waitReason("waiting-for-server-resume");
  assert.deepEqual(recovered.prompts, []);
  recovered.log.push(execution("started", 2));
  await eventually(() => recovered.prompts.length, (n) => n === 1);
  assert.notEqual(recovered.prompts[0].id, id);
  assert.equal((await recovered.status()).turns, 2);
});

test("shutdown in the post-reservation snapshot resumes an unsubmitted ID after reload", async (t) => {
  const input = await records(t);
  const storage = durable();
  const set = storage.set;
  const snapshot = Promise.withResolvers();
  const reached = Promise.withResolvers();
  const original = await install(t, input, { storage });
  storage.set = async (key, value) => {
    await set(key, value);
    if (value.turns === 2 && value.turn.attempted === false) {
      original.readActive = () => { reached.resolve(); return snapshot.promise; };
    }
  };
  await original.controls.start(input);
  await original.waitReason("waiting-for-turn");
  const [{ id }] = original.prompts;
  await writeFile(input.todo, "# TODO\n- [ ] Next\n");
  original.messages = completed(id);
  original.active = {};
  await reached.promise;
  const [saved] = storage.records.values();
  assert.equal(saved.turn.previousID, id);
  assert.equal(saved.turn.attempted, false);
  const event = execution("interrupted", 1, "shutdown");
  original.emit(event.type, event.data, event.durable);
  await original.waitReason("waiting-for-server-resume");
  snapshot.resolve();
  await original.cleanup();
  assert.equal(original.prompts.length, 1);
  const recovered = await install(t, input, { storage, before(f) {
    f.messages = [{ id: "resumed-idle", type: "idle", outcome: "succeeded" }, ...completed(id).slice(1)];
    f.log = [event];
  } });
  await eventually(() => recovered.prompts.length, (n) => n === 1);
  assert.equal(recovered.prompts[0].id, saved.turn.id);
  assert.equal((await recovered.status()).turns, 2);
});

test("interrupted idle waits for shutdown evidence; a user interrupt first stays terminal", async (t) => {
  for (const userFirst of [false, true]) await t.test(userFirst ? "user first" : "idle first", async (t) => {
    const input = await records(t);
    const f = await install(t, input, { admissionGrace: 150 });
    await f.controls.start(input);
    await f.waitReason("waiting-for-turn");
    const [{ id }] = f.prompts;
    if (userFirst) {
      f.emit("session.execution.interrupted", { sessionID, reason: "user" });
      await f.waitReason("execution-interrupted");
    }
    const paused = [{ id: "interrupted", type: "idle", outcome: "interrupted" }, { id, type: "user" }];
    f.messages = paused;
    f.active = {};
    if (!userFirst) {
      await f.waitReason("waiting-for-interruption-evidence");
      // A resumed success can appear in history before the durable log catches
      // up with the shutdown cause for the earlier interrupted idle.
      f.messages = [...completed(id).slice(0, 2), ...paused];
      assert.equal((await f.waitReason("waiting-for-interruption-evidence")).state, "active");
    }
    assert.equal(f.prompts.length, 1);
    f.log = [execution("interrupted", 1, "shutdown"), execution("started", 2)];
    await writeFile(input.todo, "# TODO\n- [ ] Next\n");
    f.messages = [...completed(id).slice(0, 2), ...paused];
    if (userFirst) {
      assert.equal((await f.status()).reason, "execution-interrupted");
      assert.equal(f.prompts.length, 1);
    } else {
      await eventually(() => f.prompts.length, (n) => n === 2);
      assert.notEqual(f.prompts[1].id, id);
    }
  });
});

test("an idle pending prompt is retried by exact ID and remains bounded if deduplication does not wake it", async (t) => {
  const input = await records(t);
  const storage = durable();
  let time = 10_000;
  const now = () => time;
  const original = await install(t, input, { storage, now });
  await original.controls.start(input);
  await original.waitReason("waiting-for-turn");
  const [prompt] = original.prompts;
  await original.cleanup();
  const recovered = await install(t, input, {
    storage, now, before(f) {
      f.inbox = [prompt];
      f.admit = async (request) => {
        assert.equal(request.id, prompt.id);
        return prompt; // Deduplication returns the receipt, but does not wake the runner.
      };
    },
  });
  await recovered.waitReason("waiting-for-pending-prompt");
  time += 30;
  assert.equal((await recovered.waitReason("pending-prompt-not-running")).turns, 1);
  assert.deepEqual(recovered.inbox, [prompt]);
  assert.deepEqual(recovered.prompts, [prompt]);
  time = 10_000 + MAX_AGE;
  assert.equal((await recovered.waitReason("time-limit")).turns, 1);
  assert.deepEqual(recovered.prompts, [prompt]);
});

test("a hanging storage write cannot block cleanup or allow the replacement to write past its fence", async (t) => {
  const input = await records(t);
  const storage = durable();
  const save = storage.set;
  let release;
  storage.set = async (key, value) => {
    if (value.phase === "turn") await new Promise((resolve) => { release = resolve; });
    await save(key, value);
  };
  const original = await install(t, input, { storage, writeTimeout: 15 });
  await original.controls.start(input);
  await original.waitReason("recovery-storage-write-pending");
  const stop = original.controls.stop(auth);
  assert.equal((await Promise.race([stop, sleep(100, { reason: "timeout" })])).reason,
    "recovery-storage-write-pending");
  assert.equal(await Promise.race([original.cleanup().then(() => true), sleep(100, false)]), true);
  const recovered = await install(t, input, { storage });
  assert.equal((await recovered.status()).reason, "user-paused-not-saved");
  assert.equal((await recovered.controls.start(input)).reason, "recovery-storage-write-pending");
  assert.deepEqual(recovered.prompts, []);
  release();
  assert.equal((await recovered.waitReason("user-paused")).turns, 1);
  assert.equal(original.prompts.length + recovered.prompts.length, 0);
});

test("after a restart with a lost receipt, the runner retries the exact reserved request without spending a turn", async (t) => {
  const input = await records(t);
  const storage = durable();
  const admitted = new Map();
  const f = await install(t, input, { storage });
  f.admit = async (request) => {
    admitted.set(request.id, request);
    throw new Error("admitted, but response lost");
  };
  await f.controls.start(input);
  await f.waitReason("admission-uncertain");
  // Capture only durable state at interruption, before cleanup. Cleanup just
  // retires the old test instance; the replacement gets a new storage handle.
  const snapshot = JSON.stringify([...storage.records]);
  const serverSnapshot = JSON.stringify([...admitted]);
  await f.cleanup();
  const restartedStorage = durable(JSON.parse(snapshot));
  const restartedAdmissions = new Map(JSON.parse(serverSnapshot));
  const recovered = await install(t, input, {
    storage: restartedStorage,
    before(next) {
      // Simulate stale inbox/history. Admission still knows the original ID.
      next.admit = async (request) => {
        const original = restartedAdmissions.get(request.id);
        if (!original) restartedAdmissions.set(request.id, request);
        next.inbox = [...restartedAdmissions.values()];
        return original ?? request;
      };
    },
  });
  await eventually(() => recovered.prompts.length, (n) => n === 1);
  assert.equal((await recovered.waitReason("waiting-for-pending-prompt")).turns, 1);
  assert.deepEqual(recovered.prompts, f.prompts);
  assert.equal(restartedAdmissions.size, 1);
  assert.deepEqual([...restartedStorage.records], JSON.parse(snapshot));
});

test("recovery does not resend a durably delivered ID while its history is still catching up", async (t) => {
  const input = await records(t);
  const storage = durable();
  const original = await install(t, input, { storage });
  await original.controls.start(input);
  await original.waitReason("waiting-for-turn");
  const [{ id }] = original.prompts;
  await original.cleanup();

  let logReads = 0;
  const recovered = await install(t, input, {
    storage,
    admissionGrace: 0,
    async *readLog(path) {
      logReads++;
      if (!path.endsWith("after=1")) yield {
        type: "session.inbox.delivered", durable: { aggregateID: sessionID, seq: 1 },
        data: { inboxID: id },
      };
      yield { type: "log.synced", aggregateID: sessionID, seq: 1 };
    },
  });
  // At least one full retry check must have finished without a resend.
  await eventually(() => logReads, (n) => n >= 2);
  assert.deepEqual(recovered.prompts, []);
  assert.equal((await recovered.status()).turns, 1);

  await writeFile(input.todo, "# TODO\n- [ ] Next\n");
  recovered.messages = completed(id);
  await eventually(() => recovered.prompts.length, (n) => n === 1);
  assert.notEqual(recovered.prompts[0].id, id);
  assert.equal((await recovered.waitReason("waiting-for-turn")).turns, 2);
});

test("retry waits for durable log availability and honors a cancellation during unload", async (t) => {
  const input = await records(t);
  const storage = durable();
  const f = await install(t, input, { storage });
  await f.controls.start(input);
  await f.waitReason("waiting-for-turn");
  const [{ id }] = f.prompts;
  await f.cleanup();
  const recovered = await install(t, input, {
    storage, before(next) { next.logUnavailable = true; },
  });
  assert.equal((await recovered.waitReason("recovery-log-unavailable")).state, "active");
  assert.equal(recovered.prompts.length, 0);
  recovered.log = [{
    type: "session.inbox.cancelled", durable: { aggregateID: sessionID, seq: 1 },
    data: { inboxID: id },
  }];
  recovered.logUnavailable = false;
  assert.equal((await recovered.waitReason("prompt-cancelled")).state, "paused");
  assert.equal(recovered.prompts.length, 0);
});

test("permission, form, and foreign inbox gates still veto a same-ID retry after log reconciliation begins", async (t) => {
  for (const [reason, gate] of [
    ["permission-requested", { permissions: [{}] }],
    ["form-requested", { forms: [{}] }],
    ["other-input-pending", { inbox: [{ id: "msg_foreign" }] }],
  ]) {
    await t.test(reason, async (t) => {
      const input = await records(t);
      const storage = durable();
      const original = await install(t, input, { storage });
      await original.controls.start(input);
      await original.waitReason("waiting-for-turn");
      await original.cleanup();
      let logRead = false;
      const recovered = await install(t, input, {
        storage,
        async *readLog() {
          logRead = true;
          Object.assign(recovered, gate);
          yield { type: "log.synced", aggregateID: sessionID };
        },
      });
      assert.equal((await recovered.waitReason(reason)).state, "paused");
      assert.equal(logRead, true);
      assert.deepEqual(recovered.prompts, []);
    });
  }
});

test("lost receipt while still loaded reconciles durable history rather than pausing or replaying", async (t) => {
  const input = await records(t);
  const f = await install(t, input);
  f.admit = async (request) => {
    f.messages = completed(request.id, "complete");
    throw new Error("lost receipt");
  };
  await f.controls.start(input);
  assert.equal((await f.waitReason("agent-reported-complete")).state, "paused");
  assert.equal(f.prompts.length, 1);
});

test("recovery preserves exact session/location, canonical binding, TODO, and safety gates", async (t) => {
  for (const [reason, mutate] of [
    ["session-not-eligible", (f) => { f.session = { ...nativeSession, location: { ...location, workspaceID: "moved" } }; }],
    ["workspace-ticket-path-mismatch", (f, input) => { f.entries = [entry(join(dirname(input.ticket), "wrong.md"))]; }],
    ["ticket-not-active-for-session", (_f, input) => writeFile(input.ticket, field("ses_other"))],
    ["todo-list-required", (_f, input) => writeFile(input.todo, "# Invalid\n")],
    ["permission-requested", (f) => { f.permissions = [{}]; }],
    ["form-requested", (f) => { f.forms = [{}]; }],
    ["other-input-pending", (f) => { f.inbox = [{ id: "msg_other" }]; }],
    ["execution-not-successful", (f) => { f.messages[0].outcome = "interrupted"; }],
    ["turn-boundary-ambiguous", (f) => { f.messages.unshift({ id: "msg_other", type: "user" }); }],
  ]) {
    await t.test(reason, async (t) => {
      const input = await records(t);
      const storage = durable();
      const original = await install(t, input, { storage });
      await original.controls.start(input);
      await original.waitReason("waiting-for-turn");
      const [{ id }] = original.prompts;
      await original.cleanup();
      // Hold reads until the fixture has installed the changed durable facts.
      const recovered = await install(t, input, {
        storage,
        before(f) { f.activityError = true; f.messages = completed(id); },
      });
      await mutate(recovered, input);
      recovered.activityError = false;
      assert.equal((await recovered.waitReason(reason)).state, "paused");
      assert.deepEqual(recovered.prompts, []);
      await recovered.cleanup();
      const reloaded = await install(t, input, { storage });
      assert.equal((await reloaded.status()).reason, reason);
      assert.deepEqual(reloaded.prompts, []);
    });
  }
});

test("recovery keeps the original time and turn limits", async (t) => {
  const input = await records(t);
  const storage = durable();
  let time = 10_000;
  const now = () => time;
  const original = await install(t, input, { storage, now });
  await original.controls.start(input);
  await original.waitReason("waiting-for-turn");
  const [{ id }] = original.prompts;
  await original.cleanup();
  const [key, first] = [...storage.records][0];
  await storage.set(key, { ...first, turns: TURN_LIMIT });
  const exhausted = await install(t, input, {
    storage, now, before(f) { f.messages = completed(id); },
  });
  assert.equal((await exhausted.waitReason("turn-limit")).turns, TURN_LIMIT);
  assert.deepEqual(exhausted.prompts, []);
  await exhausted.cleanup();
  await storage.set(key, first);
  time += MAX_AGE;
  const expired = await install(t, input, { storage, now });
  assert.equal((await expired.waitReason("time-limit")).turns, 1);
  assert.deepEqual(expired.prompts, []);
});

test("recovery does not renew an armed run's original wait for an idle session", async (t) => {
  const input = await records(t);
  const storage = durable();
  let time = 10_000;
  const options = {
    storage,
    now: () => time,
    startupIdleGrace: 1000,
    before: (f) => { f.active = { [sessionID]: { type: "running" } }; },
  };
  const original = await install(t, input, options);
  await original.controls.start(input);
  await original.waitReason("waiting-for-session-idle");
  await original.cleanup();

  time += 1000;
  const recovered = await install(t, input, options);
  assert.deepEqual(await recovered.waitReason("session-not-idle"), {
    state: "paused", reason: "session-not-idle", turns: 0, limit: TURN_LIMIT,
  });
  assert.deepEqual(original.prompts, []);
  assert.deepEqual(recovered.prompts, []);
});

test("recovery counts pre-reload stalls and recognizes previously seen progress", async (t) => {
  const input = await records(t);
  const storage = durable();
  const original = await install(t, input, { storage });
  await original.controls.start(input);
  await original.waitReason("waiting-for-turn");
  const [{ id: first }] = original.prompts;
  const originalTodo = "# TODO\n- [ ] First\n\n## Explore later\n- Compare later\n";
  await writeFile(input.todo, "# TODO\n- [ ] Second\n");
  original.messages = completed(first);
  original.active = {};
  await eventually(original.status, (s) => s.turns === 2 && s.reason === "waiting-for-turn");

  const [, { id: second }] = original.prompts;
  // One no-progress turn before unload. The journal must retain both the
  // streak and fingerprints, so reverting to First counts as a second stall.
  original.messages = completed(second, "ready", original.messages);
  original.active = {};
  await eventually(original.status, (s) => s.turns === 3 && s.reason === "waiting-for-turn");
  const [, , { id: third }] = original.prompts;
  await original.cleanup();
  await writeFile(input.todo, originalTodo);

  const recovered = await install(t, input, {
    storage,
    before(f) { f.messages = completed(third, "ready", original.messages); },
  });
  assert.equal((await recovered.waitReason("no-progress")).turns, 3);
  assert.deepEqual(recovered.prompts, []);
});

test("same-location overlap hands off automatically; other locations do not claim its record", async (t) => {
  const input = await records(t);
  const storage = durable();
  const original = await install(t, input, { storage });
  original.active = { [sessionID]: { type: "running" } };
  await original.controls.start(input);
  await original.waitReason("waiting-for-session-idle");
  const [armed] = storage.records.values();
  assert.equal(armed.phase, "initial");
  const overlapping = await install(t, input, { storage });
  assert.equal((await overlapping.status()).reason, "waiting-for-location-lease");
  const other = await install(t, input, {
    storage, where: { ...location, directory: "/another/worktree" },
    before(f) { f.session = nativeSession; },
  });
  assert.equal((await other.status()).reason, "not-armed");
  assert.equal((await other.controls.start(input)).reason, "session-lease-in-use");
  assert.deepEqual(other.prompts, []);
  await original.cleanup();
  await overlapping.waitReason("waiting-for-turn");
  assert.equal(overlapping.prompts.length, 1);
  assert.equal(original.prompts.length, 0);
});

test("recovery retries a temporarily unavailable snapshot without dropping armed intent", async (t) => {
  const input = await records(t);
  const storage = durable();
  const original = await install(t, input, { storage });
  await original.controls.start(input);
  await original.waitReason("waiting-for-turn");
  const [{ id }] = original.prompts;
  await original.cleanup();
  const restarting = await install(t, input, {
    storage,
    before(f) { f.activityError = true; f.messages = completed(id, "blocked"); },
  });
  assert.equal((await restarting.waitReason("recovery-read-unavailable")).state, "active");
  restarting.activityError = false;
  assert.equal((await restarting.waitReason("agent-reported-blocked")).state, "paused");
  assert.deepEqual(restarting.prompts, []);
});

test("a veto during a write-ahead reservation wins over that write and prevents admission", async (t) => {
  const input = await records(t);
  const storage = durable();
  const write = storage.set;
  let unblock;
  storage.set = async (key, value) => {
    if (value.phase === "turn") {
      await new Promise((resolve) => { unblock = resolve; });
    }
    await write(key, value);
  };
  const f = await install(t, input, { storage });
  await f.controls.start(input);
  await eventually(() => unblock, Boolean);
  f.emit("permission.asked", auth);
  await f.waitReason("permission-requested-not-saved");
  unblock();
  await f.cleanup();
  const recovered = await install(t, input, { storage });
  assert.equal((await recovered.status()).reason, "permission-requested");
  assert.equal(f.prompts.length + recovered.prompts.length, 0);
});

test("storage read failures are watched and malformed records are retained, never replaced", async (t) => {
  const input = await records(t);
  const storage = durable();
  const original = await install(t, input, { storage });
  await original.controls.start(input);
  await original.waitReason("waiting-for-turn");
  await original.cleanup();
  const [key, saved] = [...storage.records][0];
  const invalid = { ...saved, version: -1 };
  await storage.set(key, invalid);
  const read = storage.get;
  let available = false;
  storage.get = async (key) => {
    if (!available) throw new Error("unavailable");
    return read(key);
  };
  const recovering = await install(t, input, { storage });
  assert.equal((await recovering.status()).reason, "recovery-storage-unavailable");
  available = true;
  await recovering.waitReason("recovery-record-invalid");
  assert.equal((await recovering.controls.start(input)).reason, "recovery-record-invalid");
  assert.deepEqual(await storage.get(key), invalid);
  assert.deepEqual(recovering.prompts, []);
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
