/**
 * Scroll-diagnosis logging for the chat transcript.
 *
 * Zero-cost when off: every exported fn early-returns unless the flag below is
 * enabled in localStorage, so call sites can log unconditionally. Turn on with
 * `localStorage.setItem("pi-debug-scroll", "1")` and reload; entries land in the
 * browser console as `[scroll-debug]` lines carrying `performance.now()` stamps,
 * which interleave with the server's WS frames for correlation.
 */
export const SCROLL_DEBUG_KEY = "pi-debug-scroll";

export function scrollDebugEnabled(): boolean {
  try {
    return localStorage.getItem(SCROLL_DEBUG_KEY) === "1";
  } catch {
    return false;
  }
}

export function scrollDebugLog(event: string, data?: Record<string, unknown>): void {
  if (!scrollDebugEnabled()) return;
  if (data) console.log(`[scroll-debug] ${event}`, { t: Math.round(performance.now()), ...data });
  else console.log(`[scroll-debug] ${event}`, { t: Math.round(performance.now()) });
}
