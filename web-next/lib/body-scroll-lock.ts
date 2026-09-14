const locks = new Set<symbol>();
let original: {body: HTMLElement; value: string; priority: string} | undefined;

// Nested dialogs may unmount parent-first after a native history jump. Restore
// the original style only after the last owner releases its lock.
export function lockBodyScroll() {
  const token = Symbol('body-scroll-lock');
  if (!locks.size) {
    const body = document.body;
    original = {body, value: body.style.getPropertyValue('overflow'), priority: body.style.getPropertyPriority('overflow')};
    body.style.setProperty('overflow', 'hidden');
  }
  locks.add(token);
  return () => {
    if (!locks.delete(token) || locks.size || !original) return;
    const {body, value, priority} = original;
    original = undefined;
    if (value) body.style.setProperty('overflow', value, priority);
    else body.style.removeProperty('overflow');
  };
}
