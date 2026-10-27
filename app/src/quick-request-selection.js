import { createSignal } from 'solid-js';

// One transient owner-selection source for controllers and persistent list rows.
// Record refreshes need not replace/recreate rows to publish a selection change.
export function createQuickRequestSelection() {
  const [selectedQuickRequest, setSelectedQuickRequest] = createSignal(null);
  const selectedId = () => selectedQuickRequest()?.id;
  return { selectedQuickRequest, setSelectedQuickRequest, selectedId };
}
