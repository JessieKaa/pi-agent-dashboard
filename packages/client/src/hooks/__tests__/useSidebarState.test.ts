import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useSidebarState,
  MIN_WIDTH,
  MAX_WIDTH,
  DEFAULT_WIDTH,
  WIDTH_KEY,
  COLLAPSED_KEY,
  COMPACT_KEY,
} from "../useSidebarState.js";

beforeEach(() => {
  localStorage.clear();
});

describe("useSidebarState", () => {
  it("returns default width and collapsed=false when localStorage is empty", () => {
    const { result } = renderHook(() => useSidebarState());
    expect(result.current.width).toBe(DEFAULT_WIDTH);
    expect(result.current.collapsed).toBe(false);
  });

  it("reads persisted width from localStorage", () => {
    localStorage.setItem(WIDTH_KEY, "350");
    const { result } = renderHook(() => useSidebarState());
    expect(result.current.width).toBe(350);
  });

  it("reads persisted collapsed state from localStorage", () => {
    localStorage.setItem(COLLAPSED_KEY, "true");
    const { result } = renderHook(() => useSidebarState());
    expect(result.current.collapsed).toBe(true);
  });

  it("clamps width to MIN_WIDTH", () => {
    localStorage.setItem(WIDTH_KEY, "50");
    const { result } = renderHook(() => useSidebarState());
    expect(result.current.width).toBe(MIN_WIDTH);
  });

  it("clamps width to MAX_WIDTH", () => {
    localStorage.setItem(WIDTH_KEY, "999");
    const { result } = renderHook(() => useSidebarState());
    expect(result.current.width).toBe(MAX_WIDTH);
  });

  it("setWidth updates state and persists to localStorage", () => {
    const { result } = renderHook(() => useSidebarState());
    act(() => result.current.setWidth(400));
    expect(result.current.width).toBe(400);
    expect(localStorage.getItem(WIDTH_KEY)).toBe("400");
  });

  it("setWidth clamps values", () => {
    const { result } = renderHook(() => useSidebarState());
    act(() => result.current.setWidth(100));
    expect(result.current.width).toBe(MIN_WIDTH);
    act(() => result.current.setWidth(800));
    expect(result.current.width).toBe(MAX_WIDTH);
  });

  it("toggleCollapse toggles and persists", () => {
    const { result } = renderHook(() => useSidebarState());
    expect(result.current.collapsed).toBe(false);

    act(() => result.current.toggleCollapse());
    expect(result.current.collapsed).toBe(true);
    expect(localStorage.getItem(COLLAPSED_KEY)).toBe("true");

    act(() => result.current.toggleCollapse());
    expect(result.current.collapsed).toBe(false);
    expect(localStorage.getItem(COLLAPSED_KEY)).toBe("false");
  });

  it("DEFAULT_WIDTH equals MAX_WIDTH", () => {
    expect(DEFAULT_WIDTH).toBe(MAX_WIDTH);
  });

  it("handles invalid localStorage values gracefully", () => {
    localStorage.setItem(WIDTH_KEY, "not-a-number");
    localStorage.setItem(COLLAPSED_KEY, "garbage");
    const { result } = renderHook(() => useSidebarState());
    expect(result.current.width).toBe(DEFAULT_WIDTH);
    expect(result.current.collapsed).toBe(false);
  });

  it("defaults compact=false when localStorage is empty", () => {
    const { result } = renderHook(() => useSidebarState());
    expect(result.current.compact).toBe(false);
  });

  it("reads persisted compact state from localStorage", () => {
    localStorage.setItem(COMPACT_KEY, "true");
    const { result } = renderHook(() => useSidebarState());
    expect(result.current.compact).toBe(true);
  });

  it("falls back to compact=false on invalid localStorage value", () => {
    localStorage.setItem(COMPACT_KEY, "garbage");
    const { result } = renderHook(() => useSidebarState());
    expect(result.current.compact).toBe(false);
  });

  it("setCompact updates state and persists to localStorage", () => {
    const { result } = renderHook(() => useSidebarState());
    expect(result.current.compact).toBe(false);

    act(() => result.current.setCompact(true));
    expect(result.current.compact).toBe(true);
    expect(localStorage.getItem(COMPACT_KEY)).toBe("true");

    act(() => result.current.setCompact(false));
    expect(result.current.compact).toBe(false);
    expect(localStorage.getItem(COMPACT_KEY)).toBe("false");
  });
});
