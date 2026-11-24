import { createSignal, onCleanup, Show } from "solid-js";

/** A keyed route owner: changing location disposes the prior view subtree. */
export function RouteOutlet(props) {
  const [activeLocation, setActiveLocation] = createSignal(props.location());
  const unsubscribe = props.subscribe?.((location) => {
    setActiveLocation(location);
  });
  onCleanup(() => unsubscribe?.());
  return (
    <Show when={activeLocation()} keyed>
      {(location) => props.render(location)}
    </Show>
  );
}
