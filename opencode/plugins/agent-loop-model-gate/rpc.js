import { Rpc } from "@opencode/plugin/rpc";

export const id = "project-mgr-agent-loop-model-gate";
const sessionID = { type: "string", minLength: 1, maxLength: 128 };
const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const preflight = object({
  state: { type: "string", enum: ["ready", "paused", "unavailable"] },
  reason: { type: "string", maxLength: 64 },
});
const result = object({
  checkedAt: { type: "number" },
  state: { type: "string", enum: ["ignored", "paused", "prompted", "unavailable"] },
  reason: { type: "string", maxLength: 64 },
  preflight,
}, ["state", "reason"]);

export const control = Rpc.define({
  id,
  events: {},
  methods: {
    status: {
      input: object({ sessionID }),
      output: result,
      errors: {},
    },
  },
});
