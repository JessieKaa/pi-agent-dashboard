import { useEffect } from "react";

/**
 * Idle-FX settle window before card animations pause. A watched-but-untouched
 * dashboard must not drive continuous compositor frames: measured at ~1423 ms
 * of GPU-process main-thread activity per 14.6 s idle window with the selected
 * card's neon trio running (~10% of a core), and 3268 ms per 13.3 s with only
 * a BACKGROUND streaming card's stripes + status-dot pulses (~24.6%) —
 * switching away from a streaming session keeps its card animating at the
 * same cost. Paused, both windows collapse to ~8 ms. A single 8x8 px animation
 * costs the same as the three giant card layers — the cost is per-frame
 * pipeline overhead, not raster size. See change:
 * pause-decorative-fx-when-idle.
 */
export const IDLE_FX_DELAY_MS = 5000;

const IDLE_CLASS = "fx-idle";

/** Deliberate input gestures that count as "the user is here"; capture-phase
 *  on window so nested scroll containers and portals all count. `focus` also
 *  resumes after an alt-tab return (no click required).
 *  Deliberately NOT `pointermove` (a resting hand emits continuous micro-moves)
 *  and NOT `scroll` (streaming auto-scroll emits trusted scroll events, which
 *  would hold the FX alive for an entire stream). */
const ACTIVITY_EVENTS = [
  "pointerdown",
  "wheel",
  "keydown",
  "touchstart",
  "focusin",
  "focus",
] as const;

/**
 * Toggles `fx-idle` on the document root after IDLE_FX_DELAY_MS with no input;
 * the CSS for that class pauses ALL animations (same wildcard as `app-hidden`).
 * Frozen elements keep their static state colors (stripes/dots at rest), so
 * the idle UI still communicates running/unread/selected state — just without
 * motion. `app-hidden` and prefers-reduced-motion keep their independent,
 * stronger pauses.
 */
export function useIdleFx(): void {
  useEffect(() => {
    const root = document.documentElement;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const arm = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        root.classList.add(IDLE_CLASS);
      }, IDLE_FX_DELAY_MS);
    };

    const onActivity = () => {
      root.classList.remove(IDLE_CLASS);
      arm();
    };

    arm();
    for (const type of ACTIVITY_EVENTS) {
      window.addEventListener(type, onActivity, { capture: true, passive: true });
    }
    return () => {
      if (timer !== null) clearTimeout(timer);
      for (const type of ACTIVITY_EVENTS) {
        window.removeEventListener(type, onActivity, { capture: true });
      }
      root.classList.remove(IDLE_CLASS);
    };
  }, []);
}
