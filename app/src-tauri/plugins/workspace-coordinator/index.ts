import { Plugin } from "@opencode/plugin"
import { readFileSync } from "node:fs"
import { createWorkerPromptTool } from "./coordinator.mjs"

type Worker = {
  repositoryId: string
  repositoryName: string
  sessionId: string
}

const config = JSON.parse(
  readFileSync(new URL("./workers.json", import.meta.url), "utf8"),
) as { schemaVersion: 1; workspaceId: string; workers: Worker[] }

const workers = new Map(config.workers.map((worker) => [worker.repositoryId, worker]))

export default Plugin.define({
  id: "opencode-project-manager.workspace-coordinator",
  async setup(ctx) {
    const sendToWorker = createWorkerPromptTool(config.workers, (prompt) => ctx.session.prompt(prompt))
    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "workspace",
        description: "Coordinate this Workspace's existing repository worker sessions.",
      })
      editor.add({
        name: "send_to_repository_worker",
        description:
          "Queue a repository-specific prompt in one existing Workspace worker session. This confirms prompt admission only, not completion.",
        input: {
          type: "object",
          properties: {
            repositoryId: {
              type: "string",
              enum: [...workers.keys()],
              description: "The exact repository ID of the target worker.",
            },
            prompt: {
              type: "string",
              minLength: 1,
              description: "The repository-specific instructions to queue for that worker.",
            },
          },
          required: ["repositoryId", "prompt"],
          additionalProperties: false,
        },
        options: { namespace: "workspace" },
        execute: (input) => sendToWorker(input),
      })
    })
  },
})
