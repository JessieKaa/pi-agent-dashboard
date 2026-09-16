import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_FX_DELAY_MS, useIdleFx } from "../useIdleFx.js";

const IDLE_CLASS = "fx-idle";

describe("useIdleFx", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.documentElement.classList.remove(IDLE_CLASS);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.classList.remove(IDLE_CLASS);
  });

  it("sets fx-idle after the settle window with no input", () => {
    renderHook(() => useIdleFx());
    expect(document.documentElement.classList.contains(IDLE_CLASS)).toBe(false);
    vi.advanceTimersByTime(IDLE_FX_DELAY_MS);
    expect(document.documentElement.classList.contains(IDLE_CLASS)).toBe(true);
  });

  it("clears fx-idle on the first pointer input", () => {
    renderHook(() => useIdleFx());
    vi.advanceTimersByTime(IDLE_FX_DELAY_MS);
    expect(document.documentElement.classList.contains(IDLE_CLASS)).toBe(true);
    window.dispatchEvent(new Event("pointerdown"));
    expect(document.documentElement.classList.contains(IDLE_CLASS)).toBe(false);
  });

  it("re-arms the timer when input arrives mid-window", () => {
    renderHook(() => useIdleFx());
    vi.advanceTimersByTime(IDLE_FX_DELAY_MS - 1);
    window.dispatchEvent(new Event("keydown"));
    vi.advanceTimersByTime(IDLE_FX_DELAY_MS - 1);
    expect(document.documentElement.classList.contains(IDLE_CLASS)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(document.documentElement.classList.contains(IDLE_CLASS)).toBe(true);
  });

  it("does not treat pointermove or scroll as activity", () => {
    // A resting hand emits micro pointermoves, and streaming auto-scroll emits
    // trusted scroll events — counting either would keep the FX alive for an
    // entire 24h stream.
    renderHook(() => useIdleFx());
    vi.advanceTimersByTime(IDLE_FX_DELAY_MS - 100);
    window.dispatchEvent(new Event("pointermove"));
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(100);
    expect(document.documentElement.classList.contains(IDLE_CLASS)).toBe(true);
  });

  it("cleans up class, timer, and listeners on unmount", () => {
    const { unmount } = renderHook(() => useIdleFx());
    vi.advanceTimersByTime(IDLE_FX_DELAY_MS);
    expect(document.documentElement.classList.contains(IDLE_CLASS)).toBe(true);
    unmount();
    expect(document.documentElement.classList.contains(IDLE_CLASS)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    // No listener left behind: a post-unmount input must not throw or re-touch the class.
    window.dispatchEvent(new Event("pointermove"));
    vi.advanceTimersByTime(IDLE_FX_DELAY_MS);
    expect(document.documentElement.classList.contains(IDLE_CLASS)).toBe(false);
  });
});
