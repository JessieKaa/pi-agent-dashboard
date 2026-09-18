/**
 * C1 (change: fix-archive-feedback-and-sidebar-perf): the sidebar's render-path
 * memo boundary.
 *
 * The sidebar re-renders on every broadcast. Without a boundary, ONE session
 * changing re-rendered EVERY mounted card. These tests render the REAL card and
 * count body executions via a counting spy on the drag-handle hook — SessionCard
 * is its ONLY consumer, and it is called unconditionally near the top of the
 * card body, so each mounted-card render is exactly one increment (a mocked
 * SessionCard would sit ABOVE the React.memo boundary and could never observe
 * it).
 *
 *   1. identical props: a rerender from the top re-renders zero cards;
 *   2. one session updated: only that card re-renders (per-key comparator);
 *   3. `now` compares by its 30s relative-label bucket: a same-bucket jump
 *      re-renders nothing (label unchanged), a flipped bucket re-renders and
 *      the badge text advances — coarsened, never frozen.
 */

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { SessionList } from "../session/SessionList.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

/** Card body renders — reset right before the action under test. */
let cardRenders = 0;

vi.mock("../session/SortableSessionCard.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session/SortableSessionCard.js")>();
  return {
    ...actual,
    useSessionCardDragHandle: () => {
      cardRenders += 1;
      return actual.useSessionCardDragHandle();
    },
  };
});

function TestRouter({ children }: { children: React.ReactNode }) {
  const { hook } = memoryLocation({ path: "/", static: true });
  return <Router hook={hook}>{children}</Router>;
}

beforeEach(() => {
  cardRenders = 0;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k in store) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeSession(id: string, cwd: string, overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id,
    cwd,
    source: "tui",
    status: "active",
    startedAt: Date.now() - 60_000,
    lastActivityAt: Date.now() - 10_000,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    ...overrides,
  };
}

const noop = () => {};

async function renderHarness(initial: DashboardSession[]) {
  const tree = (sessions: DashboardSession[]) => (
    <TestRouter>
      <ThemeProvider>
        <SessionList sessions={sessions} onSelect={noop} />
      </ThemeProvider>
    </TestRouter>
  );
  const view = render(tree(initial));
  // Settle the mount-time state sync (collapsed-groups prune effect) before
  // measuring — these tests assert the STEADY-STATE re-render cost.
  await act(async () => {});
  function rerender(sessions: DashboardSession[]) {
    act(() => {
      view.rerender(tree(sessions));
    });
  }
  return { view, rerender };
}

describe("SessionList render-path memo (C1)", () => {
  it("identical props: a rerender from the top re-renders zero cards", async () => {
    const a = makeSession("a", "/proj/one");
    const b = makeSession("b", "/proj/two");
    const sessions = [a, b];
    const { view, rerender } = await renderHarness(sessions);
    expect(
      view.container.querySelector('[data-session-id="a"]') &&
        view.container.querySelector('[data-session-id="b"]'),
    ).toBeTruthy();

    cardRenders = 0;
    rerender(sessions);
    expect(cardRenders).toBe(0);
  });

  it("one session updated: only its card re-renders", async () => {
    const a = makeSession("a", "/proj/one");
    const b = makeSession("b", "/proj/two");
    const c = makeSession("c", "/proj/three");
    const { rerender } = await renderHarness([a, b, c]);

    const a2: DashboardSession = { ...a, status: "idle" };
    cardRenders = 0;
    rerender([a2, b, c]);
    expect(cardRenders).toBe(1);
  });

  it("now bucket: a same-bucket clock jump skips cards; a flipped bucket re-renders", async () => {
    const SECOND = 1000;
    // Controlled clock: T0 is exactly a 30s-bucket boundary, so the label math
    // below is deterministic (no dependence on the real clock's remainder).
    const T0 = Math.floor(Date.now() / 30_000) * 30_000;
    let fakeNow = T0;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => fakeNow);
    try {
      const x = makeSession("x", "/proj/one", {
        startedAt: T0 - 60 * SECOND,
        lastActivityAt: T0 - 10 * SECOND,
      });
      const sessions = [x];
      const { rerender } = await renderHarness(sessions);
      expect(screen.getByText("10s")).toBeTruthy();

      // +29s: same 30s bucket → no card re-render. The rendered label is now
      // stale by design (bound: one bucket), never frozen — the next bullet
      // proves the flip lands.
      fakeNow = T0 + 29 * SECOND;
      cardRenders = 0;
      rerender(sessions);
      expect(cardRenders).toBe(0);
      expect(screen.getByText("10s")).toBeTruthy();

      // Next bucket: the card re-renders and the label advances.
      fakeNow = T0 + 30 * SECOND;
      cardRenders = 0;
      rerender(sessions);
      expect(cardRenders).toBe(1);
      expect(screen.getByText("40s")).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });
});
