export function createWorkerPromptTool(workers, admitPrompt) {
  const byRepository = new Map(workers.map((worker) => [worker.repositoryId, worker]));
  if (byRepository.size !== workers.length || workers.some((worker) => !worker.sessionId)) {
    throw new Error("Workspace worker configuration must contain unique repositories and exact session IDs.");
  }

  return async function sendToWorker(input) {
    const worker = byRepository.get(input?.repositoryId);
    if (!worker) throw new Error("No tracked worker exists for that repository.");
    if (typeof input.prompt !== "string" || !input.prompt.trim()) {
      throw new Error("Worker prompts cannot be blank.");
    }

    await admitPrompt({ sessionID: worker.sessionId, text: input.prompt, delivery: "queue" });
    return {
      content: `Prompt admitted to the ${worker.repositoryName} worker. This does not mean the worker has completed it.`,
    };
  };
}
