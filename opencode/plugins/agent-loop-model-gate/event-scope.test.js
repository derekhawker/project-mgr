import assert from "node:assert/strict";
import test from "node:test";
import { eventOwnerSessionIDs, sessionIDFromEvent } from "./event-scope.js";

test("session event routing uses one consistent SDK envelope precedence", () => {
  assert.equal(
    sessionIDFromEvent({
      properties: { sessionID: "ses_properties" },
      sessionID: "ses_root",
      data: { sessionID: "ses_data" },
    }),
    "ses_properties",
  );
  assert.equal(sessionIDFromEvent({ sessionID: "ses_root", data: { sessionID: "ses_data" } }), "ses_root");
  assert.equal(sessionIDFromEvent({ data: { sessionID: "ses_data" } }), "ses_data");
  assert.equal(sessionIDFromEvent({}), undefined);
});

test("event ownership is restricted to requested sessions in the current directory", async () => {
  const calls = [];
  const ctx = {
    location: { directory: "/work/go-gui" },
    session: {
      get: async ({ sessionID }) => {
        calls.push(sessionID);
        return {
          data: {
            id: sessionID,
            location: { directory: sessionID === "ses_target" ? "/work/go-gui" : "/work/other" },
          },
        };
      },
    },
  };

  assert.deepEqual(
    [...(await eventOwnerSessionIDs(ctx, ["ses_target", "ses_other", "ses_target"]))],
    ["ses_target"],
  );
  assert.deepEqual(calls.sort(), ["ses_other", "ses_target"]);
});

test("event ownership fails closed when exact session location is unavailable", async () => {
  const ctx = {
    location: { directory: "/work/go-gui" },
    session: { get: async () => { throw new Error("unavailable"); } },
  };

  assert.deepEqual([...(await eventOwnerSessionIDs(ctx, ["ses_target"]))], []);
});

test("event ownership fails closed when both locations are missing", async () => {
  const ctx = {
    location: {},
    session: { get: async ({ sessionID }) => ({ id: sessionID, location: {} }) },
  };

  assert.deepEqual([...(await eventOwnerSessionIDs(ctx, ["ses_target"]))], []);
});

test("a session has exactly one event owner across four directory contexts", async () => {
  const session = {
    id: "ses_target",
    location: { directory: "/work/go-gui" },
  };
  const context = (directory) => ({
    location: { directory },
    session: { get: async () => ({ data: session }) },
  });

  const directories = [
    "/work/go-gui",
    "/work/other",
    "/work/go-gui/subproject",
    "/tmp/go-gui",
  ];
  const owners = await Promise.all(
    directories.map((directory) => eventOwnerSessionIDs(context(directory), ["ses_target"])),
  );

  assert.deepEqual(owners.map((owned) => owned.has("ses_target")), [true, false, false, false]);
  assert.equal(owners.filter((owned) => owned.has("ses_target")).length, 1);
});
