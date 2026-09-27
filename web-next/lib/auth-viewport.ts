// Embedded Android browsers may not implement svh/dvh correctly. A form taller
// than the visible viewport still grows naturally and remains scrollable.
export function installAuthViewport() {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  let frame = 0;
  const measure = () => {
    if (viewport && viewport.scale !== 1) return; // Pinch zoom must not reflow the form.
    root.style.setProperty('--auth-viewport-height', `${Math.round(viewport?.height || innerHeight)}px`);
  };
  const schedule = () => {cancelAnimationFrame(frame); frame = requestAnimationFrame(measure);};
  measure();
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  viewport?.addEventListener('resize', schedule);
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
    viewport?.removeEventListener('resize', schedule);
    root.style.removeProperty('--auth-viewport-height');
  };
}
