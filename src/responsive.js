const MOBILE_MAX_WIDTH = 768;

/**
 * "mobile" → 2x3 zone grid + bottom tray. "desktop" → 3x2 grid + left
 * sidebar. A landscape phone still gets "desktop": there's enough width for
 * the wide layout, it just also gets the touch interaction tweaks (those are
 * driven separately by isTouchDevice(), not by this breakpoint).
 */
export function getBreakpoint() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const isPortrait = height > width;

  if (!isPortrait) return "desktop";
  return width < MOBILE_MAX_WIDTH ? "mobile" : "desktop";
}

/** Decided once (device class doesn't change on rotation) — drives perf tiering. */
export function isTouchDevice() {
  return window.matchMedia("(pointer: coarse)").matches;
}
