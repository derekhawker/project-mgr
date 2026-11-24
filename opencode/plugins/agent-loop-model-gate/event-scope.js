export const sessionIDFromEvent = (event) =>
  event?.properties?.sessionID ?? event?.sessionID ?? event?.data?.sessionID;

export async function eventOwnerSessionIDs(ctx, sessionIDs) {
  const owned = new Set();
  await Promise.all(
    [...new Set(sessionIDs)].map(async (sessionID) => {
      try {
        const result = await ctx.session.get(
          { sessionID },
          { signal: AbortSignal.timeout(5_000) },
        );
        const session = result?.data ?? result;
        const sessionDirectory = session?.location?.directory;
        const contextDirectory = ctx.location?.directory;
        if (
          session?.id === sessionID &&
          typeof sessionDirectory === "string" &&
          sessionDirectory.length > 0 &&
          typeof contextDirectory === "string" &&
          contextDirectory.length > 0 &&
          sessionDirectory === contextDirectory
        )
          owned.add(sessionID);
      } catch {
        // Event ownership is fail-closed when exact location evidence is unavailable.
      }
    }),
  );
  return owned;
}
