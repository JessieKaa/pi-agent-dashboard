import { mdiCheck, mdiContentCopy } from "@mdi/js";
import { Icon } from "@mdi/react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopyButton } from "../primitives/CopyButton.js";

/** The rendered icon path (`d` attr) — distinguishes the base icon from mdiCheck. */
function iconPath(btn: HTMLElement): string | null {
  return btn.querySelector("svg path")?.getAttribute("d") ?? null;
}

describe("CopyButton", () => {
  let writeTextMock: ReturnType<typeof vi.fn>;
  let originalExecCommand: typeof document.execCommand | undefined;

  beforeEach(() => {
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });
    originalExecCommand = document.execCommand;
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.assign(navigator, { clipboard: undefined });
    if (originalExecCommand) {
      Object.assign(document, { execCommand: originalExecCommand });
    } else {
      Reflect.deleteProperty(document, "execCommand");
    }
  });

  it("renders the provided icon", () => {
    render(<CopyButton getText={() => "hello"} icon={<Icon path={mdiContentCopy} size={0.6} />} title="Copy" />);
    const btn = screen.getByTitle("Copy");
    expect(iconPath(btn)).toBe(mdiContentCopy);
  });

  it("copies text to clipboard on click", async () => {
    render(<CopyButton getText={() => "hello world"} icon={<Icon path={mdiContentCopy} size={0.6} />} title="Copy" />);

    await act(async () => {
      fireEvent.click(screen.getByTitle("Copy"));
    });

    expect(writeTextMock).toHaveBeenCalledWith("hello world");
  });

  it("shows checkmark feedback after click, then reverts", async () => {
    render(<CopyButton getText={() => "hello"} icon={<Icon path={mdiContentCopy} size={0.6} />} title="Copy" />);

    await act(async () => {
      fireEvent.click(screen.getByTitle("Copy"));
    });

    const btn = screen.getByTitle("Copy");
    expect(iconPath(btn)).toBe(mdiCheck);

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(iconPath(btn)).toBe(mdiContentCopy);
  });

  it("falls back to the textarea path and shows ✓ when writeText rejects", async () => {
    // fix-ux-degradation-long-session (D2): over a plain-http tunnel
    // `navigator.clipboard` is absent/rejected; the shared `copyText` helper
    // must recover via hidden textarea + execCommand instead of silently doing
    // nothing.
    writeTextMock.mockRejectedValue(new Error("not allowed"));
    const seen = { present: false, value: "" };
    const execCommand = vi.fn(() => {
      const ta = document.querySelector("textarea");
      seen.present = ta !== null;
      seen.value = ta?.value ?? "";
      return true;
    });
    Object.assign(document, { execCommand });

    render(<CopyButton getText={() => "hello"} icon={<Icon path={mdiContentCopy} size={0.6} />} title="Copy" />);

    await act(async () => {
      fireEvent.click(screen.getByTitle("Copy"));
    });

    expect(execCommand).toHaveBeenCalledWith("copy");
    // The hidden textarea existed at the moment execCommand ran...
    expect(seen.present).toBe(true);
    expect(seen.value).toBe("hello");
    // ...and did not leak into the DOM afterwards.
    expect(document.querySelector("textarea")).toBeNull();
    expect(iconPath(screen.getByTitle("Copy"))).toBe(mdiCheck);
  });

  it("handles a genuinely failed copy gracefully (no clipboard, execCommand false)", async () => {
    Object.assign(navigator, { clipboard: undefined });
    Object.assign(document, { execCommand: vi.fn(() => false) });

    render(<CopyButton getText={() => "hello"} icon={<Icon path={mdiContentCopy} size={0.6} />} title="Copy" />);

    // Should not throw, and must not claim success.
    await act(async () => {
      fireEvent.click(screen.getByTitle("Copy"));
    });
    expect(iconPath(screen.getByTitle("Copy"))).toBe(mdiContentCopy);
    expect(document.querySelector("textarea")).toBeNull();
  });
});
