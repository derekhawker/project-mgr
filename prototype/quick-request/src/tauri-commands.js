export function createQuickRequestCommands(invoke) {
  return {
    prototypeInfo: () => invoke('prototype_info'),
    startQuickRequest: (prompt, model) => invoke('start_quick_request', { prompt, model }),
    sendInitialPrompt: (sessionId, prompt, model) =>
      invoke('send_initial_prompt', { sessionId, prompt, model }),
    restoreLatestQuickRequest: () => invoke('restore_latest_quick_request'),
  };
}
