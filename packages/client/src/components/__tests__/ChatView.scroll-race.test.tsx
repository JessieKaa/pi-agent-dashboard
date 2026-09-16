import { act, fireEvent, render } from "@testing-library/react";
import React from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createInitialState } from "../../lib/chat/event-reducer.js";
import { ChatView } from "../chat/ChatView.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import type { ToolContext } from "../tool-renderers/index.js";

const defaultToolContext: ToolContext = {};

beforeAll(() => {
  // jsdom doesn't implement scrollTo
  Element.prototype.scrollTo = () => {};
  // jsdom doesn't implement matchMedia
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

/**
 * Model the container's scroll geometry. `scrollTop` is defined as a CLAMPING
 * accessor because the browser clamps every write to [0, scrollHeight −
 * clientHeight] — and that clamp is load-bearing for the bottom-pin tests: the
 * pin writes `scrollTop = scrollHeight` (an overshoot by clientHeight), and the
 * clamped value it actually lands on is what `handleScroll` later compares
 * against. A plain data property would let programmatic writes overshoot and
 * silently hide any defect about "where the pin really landed".
 */
function setScrollPosition(el: Element, scrollTop: number, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, writable: true, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, writable: true, configurable: true });
  const maxTop = () => Math.max((el as HTMLElement).scrollHeight - (el as HTMLElement).clientHeight, 0);
  let current = Math.min(Math.max(scrollTop, 0), maxTop());
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get() {
      return current;
    },
    set(v: number) {
      current = Math.min(Math.max(v, 0), maxTop());
    },
  });
}

function getScrollContainer(container: HTMLElement): HTMLElement {
  return container.querySelector("[class*='overflow-y-auto']")!;
}

function stateWith(n: number) {
  const s = createInitialState();
  for (let i = 0; i < n; i++) {
    s.messages.push({ id: String(i), role: "user", content: `m${i}`, timestamp: Date.now() });
  }
  return s;
}

/** Flush one animation frame — some React updates still flush through rAF in tests */
async function flushRaf() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

describe("ChatView sticky scroll", () => {
  it("keeps the scroll-to-bottom button hidden after programmatic auto-scroll", async () => {
    const { container, rerender } = render(
      <ThemeProvider>
        <ChatView state={createInitialState()} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    await flushRaf();

    // Simulate content streaming in while the user is already at the bottom
    const scrollEl = getScrollContainer(container);
    setScrollPosition(scrollEl, 950, 1000, 400);
    fireEvent.scroll(scrollEl); // sets stickToBottomRef = true

    setScrollPosition(scrollEl, 950, 1500, 400);
    rerender(
      <ThemeProvider>
        <ChatView state={stateWith(50)} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );

    // Programmatic auto-scroll must not surface the escape button
    expect(container.querySelector('[data-testid="scroll-to-bottom"]')).toBeNull();
  });

  it("lets the user escape sticky bottom immediately on scroll-up", async () => {
    const { container, rerender } = render(
      <ThemeProvider>
        <ChatView state={createInitialState()} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    await flushRaf();

    // Start at bottom, then scroll up
    const scrollEl = getScrollContainer(container);
    setScrollPosition(scrollEl, 0, 1000, 400);
    fireEvent.scroll(scrollEl);
    setScrollPosition(scrollEl, 0, 1000, 400);
    fireEvent.scroll(scrollEl);

    expect(container.querySelector('[data-testid="scroll-to-bottom"]')).not.toBeNull();

    // More content arrives; scroll must stay where the user left it
    const previousTop = scrollEl.scrollTop;
    rerender(
      <ThemeProvider>
        <ChatView state={stateWith(50)} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );

    expect(scrollEl.scrollTop).toBe(previousTop);
  });

  it("re-arms sticky bottom when the user scrolls back to the end", async () => {
    const { container, rerender } = render(
      <ThemeProvider>
        <ChatView state={createInitialState()} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    await flushRaf();

    const scrollEl = getScrollContainer(container);
    // Escape: a real gesture + position move. The wheel clears the
    // programmatic-write tag the mount pin left, so the position can release
    // the follow — exactly what a wheel-up in the browser does.
    fireEvent.wheel(scrollEl, { deltaY: -100 });
    setScrollPosition(scrollEl, 0, 1000, 400);
    fireEvent.scroll(scrollEl);
    expect(container.querySelector('[data-testid="scroll-to-bottom"]')).not.toBeNull();

    // Return to bottom
    setScrollPosition(scrollEl, 950, 1000, 400);
    fireEvent.scroll(scrollEl);
    expect(container.querySelector('[data-testid="scroll-to-bottom"]')).toBeNull();

    // New content should now be chased again (clamped max = 1500 − 400).
    setScrollPosition(scrollEl, 1100, 1500, 400);
    rerender(
      <ThemeProvider>
        <ChatView state={stateWith(50)} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );

    expect(scrollEl.scrollTop).toBe(1100);
  });

  it("one click on scroll-to-bottom survives mid-flight height growth (virtualized rows measuring in)", async () => {
    // Regression: under TanStack virtualization the rows below the viewport
    // are ESTIMATED; while the smooth scroll descends they mount + measure and
    // scrollHeight grows past the click-time target. The in-flight scroll
    // events see nearBottom=false and used to clear stickToBottomRef, so the
    // descent stalled short of the bottom and the button had to be clicked
    // repeatedly. One click must latch "descend to bottom" until arrival.
    const { container, rerender } = render(
      <ThemeProvider>
        <ChatView state={stateWith(50)} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    await flushRaf();

    const scrollEl = getScrollContainer(container);
    // User is far up the transcript — button visible. (Wheel first: a real
    // gesture, so the position is guaranteed to release any tag a pin left
    // behind instead of depending on wall-clock proximity to the mount window.)
    fireEvent.wheel(scrollEl, { deltaY: -100 });
    setScrollPosition(scrollEl, 0, 2000, 400);
    fireEvent.scroll(scrollEl);
    expect(container.querySelector('[data-testid="scroll-to-bottom"]')).not.toBeNull();

    // Click the button (scrollTo is stubbed in jsdom — the descent is
    // represented by the scroll events we fire below).
    fireEvent.click(container.querySelector('[data-testid="scroll-to-bottom"]')!);

    // Mid-flight: not yet at the bottom AND scrollHeight grew (rows measured).
    setScrollPosition(scrollEl, 900, 2600, 400);
    fireEvent.scroll(scrollEl);

    // The single click must keep the descent latched: button stays hidden…
    expect(container.querySelector('[data-testid="scroll-to-bottom"]')).toBeNull();

    // …and the sticky pin must still chase the (grown) bottom on next content
    // (clamped max = 3000 − 400).
    setScrollPosition(scrollEl, 900, 3000, 400);
    rerender(
      <ThemeProvider>
        <ChatView state={stateWith(51)} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    expect(scrollEl.scrollTop).toBe(2600);
  });

  it("user wheel input cancels an in-flight scroll-to-bottom descent", async () => {
    const { container } = render(
      <ThemeProvider>
        <ChatView state={stateWith(50)} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    await flushRaf();

    const scrollEl = getScrollContainer(container);
    fireEvent.wheel(scrollEl, { deltaY: -100 });
    setScrollPosition(scrollEl, 0, 2000, 400);
    fireEvent.scroll(scrollEl);
    fireEvent.click(container.querySelector('[data-testid="scroll-to-bottom"]')!);

    // The user grabs the wheel mid-descent — that must cancel the latch.
    fireEvent.wheel(scrollEl, { deltaY: -100 });
    setScrollPosition(scrollEl, 700, 2600, 400);
    fireEvent.scroll(scrollEl);

    // Escape respected: button re-appears, no forced pin.
    expect(container.querySelector('[data-testid="scroll-to-bottom"]')).not.toBeNull();
  });

  it("keeps following after a measurement clamps the bottom-pin (no gesture, scrollTop frozen)", async () => {
    // Trace shape from the live defect (session lands mid-conversation on
    // mobile): the stick effect pins el.scrollTop = el.scrollHeight, a row
    // below the viewport measures in before the induced scroll event
    // dispatches, so that event reads nearBottom=false while scrollTop still
    // equals the value our own write achieved. No user gesture is involved —
    // clearing the follow here stranded the view wherever growth stopped.
    // See change: fix-ux-degradation-long-session.
    const { container, rerender } = render(
      <ThemeProvider>
        <ChatView state={stateWith(50)} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    await flushRaf();

    const scrollEl = getScrollContainer(container);
    // User is at the bottom → follow armed (clamped max = 2400 − 400).
    setScrollPosition(scrollEl, 2000, 2400, 400);
    fireEvent.scroll(scrollEl);
    expect(container.querySelector('[data-testid="scroll-to-bottom"]')).toBeNull();

    // Content arrives: the stick effect pins to the bottom, landing clamped at
    // the max (2400 − 400 = 2000).
    rerender(
      <ThemeProvider>
        <ChatView state={stateWith(51)} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    expect(scrollEl.scrollTop).toBe(2000);

    // A measurement grows scrollHeight AFTER the pin wrote, WITHOUT moving the
    // view — then the pin's own scroll event dispatches: nearBottom is false
    // (2600 − 2000 − 400 = 200), scrollTop still equals the pinned value.
    setScrollPosition(scrollEl, 2000, 2600, 400);
    fireEvent.scroll(scrollEl);

    // The clamp must not surface the escape affordance nor clear the follow.
    expect(container.querySelector('[data-testid="scroll-to-bottom"]')).toBeNull();

    // …and the next growth is chased to the new bottom (clamped max = 3000 − 400).
    setScrollPosition(scrollEl, 2000, 3000, 400);
    rerender(
      <ThemeProvider>
        <ChatView state={stateWith(52)} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    expect(scrollEl.scrollTop).toBe(2600);
  });

  it("still releases the pin when the view moves above the pinned position without a wheel/touch gesture", async () => {
    // Mirror guard: a scrollbar drag or keyboard scroll moves scrollTop
    // directly — no wheel/touch listener fires, so only the position can
    // reveal that the user left the bottom. Landing below the value the pin
    // achieved must release the follow exactly like the else-branch always did.
    const { container, rerender } = render(
      <ThemeProvider>
        <ChatView state={stateWith(50)} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    await flushRaf();

    const scrollEl = getScrollContainer(container);
    setScrollPosition(scrollEl, 2000, 2400, 400);
    fireEvent.scroll(scrollEl);
    rerender(
      <ThemeProvider>
        <ChatView state={stateWith(51)} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    expect(scrollEl.scrollTop).toBe(2000); // pinned, clamped to max

    // The user drags the scrollbar up while the pin's window is still open.
    setScrollPosition(scrollEl, 1200, 2600, 400);
    fireEvent.scroll(scrollEl);
    expect(container.querySelector('[data-testid="scroll-to-bottom"]')).not.toBeNull();

    // Later growth must NOT yank the view back down.
    setScrollPosition(scrollEl, 1200, 3000, 400);
    rerender(
      <ThemeProvider>
        <ChatView state={stateWith(52)} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    expect(scrollEl.scrollTop).toBe(1200);
  });
});

// Scroll-to-top affordance (change: fix-chat-scroll-to-top-estimate-drift,
// Decision 3). These are LOGIC guards on the state machine — the browser-
// timing convergence guarantee (scrollTop lands on 0 through the bounded
// scrollToIndex retries + async image remeasure) is Playwright-gated; jsdom's
// virtualizer shim reports 0-height rows and a no-op ResizeObserver, so a
// scrollTop===0 assertion here would be vacuous.
describe("ChatView scroll-to-top", () => {
  it("shows the scroll-to-top button when scrolled away from the top, hides it at the top", async () => {
    const { container } = render(
      <ThemeProvider>
        <ChatView state={stateWith(50)} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    await flushRaf();
    const scrollEl = getScrollContainer(container);

    // Scrolled down (away from the top) → button appears.
    setScrollPosition(scrollEl, 900, 2000, 400);
    fireEvent.scroll(scrollEl);
    expect(container.querySelector('[data-testid="scroll-to-top"]')).not.toBeNull();

    // Back at the very top → button hidden.
    setScrollPosition(scrollEl, 0, 2000, 400);
    fireEvent.scroll(scrollEl);
    expect(container.querySelector('[data-testid="scroll-to-top"]')).toBeNull();
  });

  it("does not fight the bottom-pin: activating scroll-to-top from the bottom while streaming stays scroll-locked", async () => {
    // The re-arm race: starting the ascent from the bottom means handleScroll
    // fires with nearBottom=true during the scroll-to-top; without the
    // ascendingRef latch it would flip stickToBottomRef back to true and the
    // onChange/auto-scroll pin would yank the view back to the bottom.
    const streaming = stateWith(50);
    streaming.streamingText = "assistant is typing…";
    const { container, rerender } = render(
      <ThemeProvider>
        <ChatView state={streaming} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    await flushRaf();
    const scrollEl = getScrollContainer(container);

    // User is at the bottom (following).
    setScrollPosition(scrollEl, 950, 1000, 400);
    fireEvent.scroll(scrollEl);
    expect(container.querySelector('[data-testid="scroll-to-top"]')).not.toBeNull();

    // Activate scroll-to-top. scrollTo is stubbed, so the DOM position does not
    // move here — we assert the STATE MACHINE stays scroll-locked.
    fireEvent.click(container.querySelector('[data-testid="scroll-to-top"]')!);

    // A scroll event still reporting near-bottom must NOT re-arm the pin
    // (ascendingRef branch holds stickToBottomRef false).
    setScrollPosition(scrollEl, 600, 1000, 400);
    fireEvent.scroll(scrollEl);

    // More streaming content arrives with grown height. Because follow is
    // suspended, the view must NOT be pinned to the (grown) bottom.
    const before = scrollEl.scrollTop;
    const more = stateWith(60);
    more.streamingText = "still typing…";
    setScrollPosition(scrollEl, 600, 2000, 400);
    rerender(
      <ThemeProvider>
        <ChatView state={more} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    expect(scrollEl.scrollTop).toBe(before); // not yanked to the grown bottom (1600)
  });
});
