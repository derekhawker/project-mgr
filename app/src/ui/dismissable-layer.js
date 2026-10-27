import { onCleanup } from 'solid-js';

// The owner retains state; this only requests dismissal while it is open.
export function useDismissableLayer({ isOpen, contains, close, focusTrigger }) {
  const pointer = (event) => {
    if (isOpen() && !contains(event.target)) close();
  };
  const keyboard = (event) => {
    if (event.key !== 'Escape' || !isOpen() || event.defaultPrevented) return;
    event.preventDefault();
    close();
    focusTrigger();
  };
  document.addEventListener('pointerdown', pointer);
  document.addEventListener('keydown', keyboard);
  onCleanup(() => {
    document.removeEventListener('pointerdown', pointer);
    document.removeEventListener('keydown', keyboard);
  });
}
