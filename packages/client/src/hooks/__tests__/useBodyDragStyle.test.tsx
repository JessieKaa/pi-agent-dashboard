/**
 * Regression coverage for change: fix-ux-degradation-long-session (D1).
 *
 * The resize surfaces used to set `document.body.style.cursor` +
 * `userSelect: none` on mousedown and clear them only in the mouseup handler.
 * Unmounting mid-drag (breakpoint flip, collapse, session switch) or losing the
 * mouseup (released outside the window) left the page permanently
 * `user-select: none` — text could no longer be selected or copied.
 *
 * The hook-scoped contract: styles clear on `endBodyDrag()` AND on unmount
 * (guarded by an active flag, so an idle instance never clears a concurrent
 * drag's styles).
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useBodyDragStyle } from "../useBodyDragStyle.js";

afterEach(() => {
  cleanup();
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

describe("useBodyDragStyle", () => {
  it("begin sets body styles, end clears them", () => {
    const { result } = renderHook(() => useBodyDragStyle());

    act(() => result.current.beginBodyDrag("col-resize"));
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");

    act(() => result.current.endBodyDrag());
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("endBodyDrag is idempotent", () => {
    const { result } = renderHook(() => useBodyDragStyle());
    act(() => result.current.beginBodyDrag("row-resize"));
    act(() => result.current.endBodyDrag());
    act(() => result.current.endBodyDrag());
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("REGRESSION: unmount mid-drag clears the body styles", () => {
    const { result, unmount } = renderHook(() => useBodyDragStyle());
    act(() => result.current.beginBodyDrag("col-resize"));
    expect(document.body.style.userSelect).toBe("none");

    unmount();

    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("unmount before any begin leaves body styles untouched", () => {
    // The second-mounted-instance / StrictMode-discarded-mount proxy: no drag
    // was ever started here, so it must not clear an active drag elsewhere.
    const { unmount } = renderHook(() => useBodyDragStyle());
    unmount();
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");

    // Now with an ACTIVE drag owned by another instance: the idle instance's
    // unmount must leave the active styles alone.
    const active = renderHook(() => useBodyDragStyle());
    act(() => active.result.current.beginBodyDrag("col-resize"));
    const idle = renderHook(() => useBodyDragStyle());
    idle.unmount();
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");

    act(() => active.result.current.endBodyDrag());
  });
});
