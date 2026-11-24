import { Rpc } from "@opencode/plugin/rpc";
import { TURN_LIMIT } from "./loop.js";

export const id = "project-mgr-agent-loop";
const sessionID = { type: "string", minLength: 1, maxLength: 128 };
const path = { type: "string", minLength: 1, maxLength: 4096 };
const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const binding = object(
  {
    ok: { type: "boolean" },
    reason: { type: "string" },
    ticket: path,
    todo: path,
  },
  ["ok"],
);
const limit = { type: "integer", enum: [TURN_LIMIT] };
const status = object(
  {
    state: { type: "string", enum: ["off", "active", "paused"] },
    reason: { type: "string" },
    turns: { type: "integer", minimum: 0, maximum: TURN_LIMIT },
    limit,
  },
  ["state", "reason"],
);
const method = (input, output = status) => ({
  input,
  output,
  errors: {},
});
export const control = Rpc.define({
  id,
  events: {},
  methods: {
    discover: method(object({ sessionID }), binding),
    start: method(
      object({ sessionID, ticket: path, todo: path }, [
        "sessionID",
        "ticket",
        "todo",
      ]),
    ),
    status: method(object({ sessionID })),
    stop: method(object({ sessionID })),
  },
});
