import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createModelGateAPI } from "./api.js";
import { parseDecision } from "./engine.js";

const sessionID = "ses_replacement";
const location = { directory: "/fixture", workspaceID: "workspace", project: { id: "project" } };
const task = "Verify the approved change";
const decision = (selected = task) => JSON.stringify({ decision: "continue", task: selected, reason: "Ready." });

async function fixture(t, markdown) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "model-gate-ticket-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ticket = join(dir, "fixture.md");
  await writeFile(ticket, markdown);
  const ctx = {
    location,
    session: {
      get: async () => ({ data: { id: sessionID, projectID: "project", location } }),
      instructions: { entry: { list: async () => ({ data: [{
        key: "workspace-ticket",
        value: `Work on ticket Fixture (fixture.md). Exact OpenCode session ID: ${sessionID}. Canonical ticket Markdown: ${ticket}. Current status: in_progress. Workspace ticket directory: ${dir}. Workspace repository root: /fixture.`,
      }] }) } },
    },
  };
  return { api: createModelGateAPI(ctx), ticket };
}

test("ticket tasks do not require a companion", async (t) => {
  const markdown = `---\ntitle: Fixture\nstatus: in_progress\nwork_session_id: ${sessionID}\n---\n## Tasks\n- [ ] ${task}\n`;
  const { api } = await fixture(t, markdown);
  const result = await api.binding(sessionID);
  assert.equal(result.ok, true);
  assert.equal(result.ticketContent, markdown);
});

test("ticket changes alter the binding fingerprint without a companion", async (t) => {
  const markdown = `---\ntitle: Fixture\nstatus: in_progress\nwork_session_id: ${sessionID}\n---\n## Tasks\n- [ ] ${task}\n`;
  const { api, ticket } = await fixture(t, markdown);
  const first = await api.binding(sessionID);
  assert.equal(first.ok, true);
  await writeFile(ticket, `${markdown}\nAdditional approved scope.\n`);
  const second = await api.binding(sessionID);
  assert.equal(second.ok, true);
  assert.notEqual(first.signature, second.signature);
});

test("ticket assigned to another session is rejected", async (t) => {
  const { api } = await fixture(t, `---\ntitle: Fixture\nstatus: in_progress\nwork_session_id: ses_original\n---\n## Tasks\n- [ ] ${task}\n`);
  assert.equal((await api.binding(sessionID)).ok, false);
});

test("continuation selection accepts only an unchecked task in the ticket", () => {
  const ticket = `# Fixture\n\n## Tasks\n- [ ] ${task}\n- [x] Already done\n`;
  assert.equal(parseDecision(decision(), ticket)?.task, task);
  assert.equal(parseDecision(decision("Already done"), ticket), undefined);
  assert.equal(parseDecision(decision("Not approved"), ticket), undefined);
  assert.equal(parseDecision(decision(), "# Fixture\n## Tasks\n"), undefined);
});

test("examples and deferred subsections cannot supply continuation tasks", () => {
  const ticket = `## Tasks\n- [ ] ${task}\n\`\`\`md\n- [ ] Example\n\`\`\`\n### Explore later\n- [ ] Unapproved\n### Ready\n- [ ] Another task\n`;
  assert.equal(parseDecision(decision("Example"), ticket), undefined);
  assert.equal(parseDecision(decision("Unapproved"), ticket), undefined);
  assert.equal(parseDecision(decision("Another task"), ticket)?.task, "Another task");
});
