/**
 * Body-level drag affordance for resize drags (`cursor` + `user-select: none`).
 *
 * `beginBodyDrag(cursor)` sets both on `document.body`; `endBodyDrag()` clears
 * them (idempotent). The unmount cleanup clears them too when a drag was still
 * active — an unmount mid-drag (breakpoint flip, panel collapse, session
 * switch) or a lost `mouseup` (pointer released outside the window) would
 * otherwise leave the page permanently `user-select: none`, killing text
 * selection and copy.
 *
 * Converges the ad-hoc guarded cleanup `useTreeColumnWidth` carries (that hook
 * is not refactored onto this one — its effect also owns localStorage
 * persistence; future merge candidate).
 *
 * State lives in a ref, never setState: no re-render is needed, and the unmount
 * effect must not read render-time `document` styles.
 *
 * See change: fix-ux-degradation-long-session.
 */
import { useCallback, useEffect, useRef } from "react";

export interface BodyDragStyle {
  /** Sets `col-resize`/`row-resize` + `user-select: none` on the body. */
  beginBodyDrag: (cursor: string) => void;
  /** Clears the body drag styles. Idempotent. */
  endBodyDrag: () => void;
}

export function useBodyDragStyle(): BodyDragStyle {
  const commandRef = useRef({ active: false });

  const beginBodyDrag = useCallback((cursor: string) => {
    commandRef.current.active = true;
    document.body.style.cursor = cursor;
    document.body.style.userSelect = "none";
  }, []);

  const endBodyDrag = useCallback(() => {
    commandRef.current.active = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    return () => {
      // No-op when idle: a second mounted surface (or StrictMode's discarded
      // mount) must not clear a concurrently active drag's styles.
      if (!commandRef.current.active) return;
      commandRef.current.active = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  return { beginBodyDrag, endBodyDrag };
}
