import { useState } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionCommandInput } from "../components/chat/SessionCommandInput.js";
import { DRAFT_KEY_PREFIX } from "../lib/state/draft-storage.js";
import {
  __resetDraftStoreForTests,
  clearDraft,
} from "../lib/state/draft-store.js";

let parentRenderCount = 0;

function Harness({ initialSessionId = "A" }: { initialSessionId?: string }) {
  parentRenderCount++;
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [chatVisible, setChatVisible] = useState(true);

  return (
    <div>
      <button data-testid="toggle-chat" onClick={() => setChatVisible((value) => !value)}>
        toggle chat
      </button>
      <button data-testid="switch-A" onClick={() => setSessionId("A")}>A</button>
      <button data-testid="switch-B" onClick={() => setSessionId("B")}>B</button>
      <button data-testid="clear" onClick={() => clearDraft(sessionId)}>clear</button>
      {chatVisible && (
        <SessionCommandInput
          commands={[]}
          onSend={() => {}}
          sessionId={sessionId}
        />
      )}
    </div>
  );
}

function getTextarea(container: HTMLElement): HTMLTextAreaElement | null {
  return container.querySelector("textarea");
}

describe("chat-input draft integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    parentRenderCount = 0;
    window.localStorage.clear();
    __resetDraftStoreForTests();
  });

  afterEach(() => {
    cleanup();
    __resetDraftStoreForTests();
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it("draft survives unmount/remount of the chat view", () => {
    const { container, getByTestId } = render(<Harness />);
    fireEvent.change(getTextarea(container)!, { target: { value: "half-typed thought" } });

    fireEvent.click(getByTestId("toggle-chat"));
    expect(getTextarea(container)).toBeNull();
    fireEvent.click(getByTestId("toggle-chat"));

    expect(getTextarea(container)!.value).toBe("half-typed thought");
  });

  it("drafts do not leak between sessions", () => {
    const { container, getByTestId } = render(<Harness />);
    fireEvent.change(getTextarea(container)!, { target: { value: "text for A" } });

    fireEvent.click(getByTestId("switch-B"));
    expect(getTextarea(container)!.value).toBe("");
    fireEvent.change(getTextarea(container)!, { target: { value: "text for B" } });

    fireEvent.click(getByTestId("switch-A"));
    expect(getTextarea(container)!.value).toBe("text for A");
    fireEvent.click(getByTestId("switch-B"));
    expect(getTextarea(container)!.value).toBe("text for B");
  });

  it("hydrates drafts from localStorage", () => {
    window.localStorage.setItem(`${DRAFT_KEY_PREFIX}abc`, "hi from storage");
    const { container } = render(<Harness initialSessionId="abc" />);
    expect(getTextarea(container)!.value).toBe("hi from storage");
  });

  it("persists drafts after the debounce", () => {
    const { container } = render(<Harness initialSessionId="persisting" />);
    fireEvent.change(getTextarea(container)!, { target: { value: "please save me" } });

    act(() => vi.advanceTimersByTime(300));

    expect(window.localStorage.getItem(`${DRAFT_KEY_PREFIX}persisting`)).toBe("please save me");
  });

  it("clear updates a mounted composer and removes storage", () => {
    const { container, getByTestId } = render(<Harness initialSessionId="xyz" />);
    fireEvent.change(getTextarea(container)!, { target: { value: "to be cleared" } });
    act(() => vi.advanceTimersByTime(300));

    fireEvent.click(getByTestId("clear"));

    expect(getTextarea(container)!.value).toBe("");
    expect(window.localStorage.getItem(`${DRAFT_KEY_PREFIX}xyz`)).toBeNull();
  });

  it("typing does not rerender the parent shell", () => {
    const { container } = render(<Harness />);
    const initialRenders = parentRenderCount;

    fireEvent.change(getTextarea(container)!, { target: { value: "a" } });
    fireEvent.change(getTextarea(container)!, { target: { value: "ab" } });
    fireEvent.change(getTextarea(container)!, { target: { value: "abc" } });

    expect(parentRenderCount).toBe(initialRenders);
    expect(getTextarea(container)!.value).toBe("abc");
  });
});
