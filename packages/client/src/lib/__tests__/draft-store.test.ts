import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAFT_KEY_PREFIX } from "../state/draft-storage.js";
import {
  __resetDraftStoreForTests,
  clearDraft,
  getDraft,
  setDraft,
  subscribeDraft,
} from "../state/draft-store.js";

describe("draft store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    __resetDraftStoreForTests();
  });

  afterEach(() => {
    __resetDraftStoreForTests();
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it("hydrates per-session drafts from storage", () => {
    window.localStorage.setItem(`${DRAFT_KEY_PREFIX}a`, "draft a");
    window.localStorage.setItem(`${DRAFT_KEY_PREFIX}b`, "draft b");

    expect(getDraft("a")).toBe("draft a");
    expect(getDraft("b")).toBe("draft b");
    expect(getDraft("missing")).toBe("");
  });

  it("notifies only subscribers for the changed session", () => {
    const onA = vi.fn();
    const onB = vi.fn();
    subscribeDraft("a", onA);
    subscribeDraft("b", onB);

    setDraft("a", "one");
    setDraft("a", "one");

    expect(getDraft("a")).toBe("one");
    expect(getDraft("b")).toBe("");
    expect(onA).toHaveBeenCalledTimes(1);
    expect(onB).not.toHaveBeenCalled();
  });

  it("persists only the latest value after the debounce", () => {
    setDraft("a", "o");
    setDraft("a", "on");
    setDraft("a", "one");

    expect(window.localStorage.getItem(`${DRAFT_KEY_PREFIX}a`)).toBeNull();
    vi.advanceTimersByTime(300);
    expect(window.localStorage.getItem(`${DRAFT_KEY_PREFIX}a`)).toBe("one");
  });

  it("deletes storage when a draft becomes empty", () => {
    window.localStorage.setItem(`${DRAFT_KEY_PREFIX}a`, "old");
    expect(getDraft("a")).toBe("old");

    setDraft("a", "");
    vi.advanceTimersByTime(300);

    expect(getDraft("a")).toBe("");
    expect(window.localStorage.getItem(`${DRAFT_KEY_PREFIX}a`)).toBeNull();
  });

  it("clear cancels a pending write and deletes storage immediately", () => {
    const listener = vi.fn();
    subscribeDraft("a", listener);
    window.localStorage.setItem(`${DRAFT_KEY_PREFIX}a`, "persisted");

    setDraft("a", "pending");
    clearDraft("a");

    expect(getDraft("a")).toBe("");
    expect(window.localStorage.getItem(`${DRAFT_KEY_PREFIX}a`)).toBeNull();
    vi.advanceTimersByTime(300);
    expect(window.localStorage.getItem(`${DRAFT_KEY_PREFIX}a`)).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("ignores missing session ids", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDraft(undefined, listener);

    setDraft(undefined, "ignored");
    clearDraft(undefined);
    unsubscribe();

    expect(getDraft(undefined)).toBe("");
    expect(listener).not.toHaveBeenCalled();
  });
});
