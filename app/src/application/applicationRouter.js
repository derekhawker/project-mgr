import { createSignal } from "solid-js";

/** Owns the active destination and its route-generation token. */
export function createApplicationRouter(initialDestination) {
  let generation = 0;
  const listeners = new Set();
  const [location, setLocation] = createSignal({
    destination: initialDestination,
    context: null,
    generation,
  });

  return {
    location,
    navigate(destination, context = null) {
      const next = {
        destination,
        context,
        generation: ++generation,
      };
      setLocation(next);
      for (const listener of listeners) listener(next);
      return next;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isCurrent(candidate) {
      return (
        location().generation ===
        (typeof candidate === "number" ? candidate : candidate.generation)
      );
    },
  };
}
