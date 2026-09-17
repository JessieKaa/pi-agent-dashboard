/**
 * Editor-pane terminal layer — lazy gate + keep-alive contract.
 *
 * The `TerminalPaneLayer` dynamic boundary (P1) must not disturb the
 * single-mount-per-id keep-alive: the layer is not even loaded until a
 * `term:<id>` tab exists, switching to a file tab HIDES (not unmounts) the
 * terminal, switching back reuses the same instance, and closing the tab is
 * the only teardown path. `TerminalView` is mocked — it owns xterm + the WS
 * and would not render in jsdom.
 *
 * See change: optimize-client-bootstrap-and-bundle-coherence (P1),
 * terminals-in-tabbed-panes.
 */

import type { TerminalSession } from "@blackbelt-technology/pi-dashboard-shared/terminal-types.js";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

const mockState = vi.hoisted(() => ({
  mounts: [] as string[],
  unmounts: [] as string[],
  lastVisible: new Map<string, boolean>(),
}));

vi.mock("../../terminal/TerminalView.js", () => ({
  TerminalView: ({ terminalId, visible }: { terminalId: string; visible: boolean }) => {
    mockState.lastVisible.set(terminalId, visible);
    useEffect(() => {
      mockState.mounts.push(terminalId);
      return () => {
        mockState.unmounts.push(terminalId);
      };
    }, [terminalId]);
    return null;
  },
}));

import { SplitWorkspaceProvider, useSplitWorkspace } from "../../split/SplitWorkspaceContext.js";
import { EditorPane } from "../EditorPane.js";

function FileOpenProbe() {
  const { openInSplit } = useSplitWorkspace();
  return (
    <button type="button" data-testid="open-file" onClick={() => openInSplit("pic.png")}>
      open file
    </button>
  );
}

function Harness({ sessionId }: { sessionId: string }) {
  const [terminals, setTerminals] = useState<TerminalSession[]>([]);
  return (
    <SplitWorkspaceProvider
      sessionId={sessionId}
      cwd="/proj"
      orientation="h"
      terminals={terminals}
      onCreateTerminal={(cwd) =>
        setTerminals((prev) => [
          ...prev,
          { id: "term-1", cwd, shell: "/bin/bash", status: "active", createdAt: Date.now() },
        ])
      }
      onKillTerminal={(id) => setTerminals((prev) => prev.filter((t) => t.id !== id))}
    >
      <EditorPane />
      <FileOpenProbe />
    </SplitWorkspaceProvider>
  );
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  mockState.mounts.length = 0;
  mockState.unmounts.length = 0;
  mockState.lastVisible.clear();
  localStorage.clear();
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ json: () => Promise.resolve({ success: true, data: { entries: [] } }) }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("EditorPane — lazy terminal layer keep-alive", () => {
  it("stays unloaded with no terminal tab, then mounts the terminal exactly once", async () => {
    render(<Harness sessionId="sT1" />);
    // A file tab alone does not pull in the layer.
    fireEvent.click(screen.getByTestId("open-file"));
    expect(mockState.mounts).toEqual([]);

    fireEvent.click(screen.getByTestId("new-terminal-launch"));
    await screen.findByTestId("new-terminal-launch");
    await waitFor(() => expect(mockState.mounts).toEqual(["term-1"]));
    expect(mockState.unmounts).toEqual([]);
  });

  it("hides rather than unmounts when switching to a file tab, and reuses the instance on switch back", async () => {
    render(<Harness sessionId="sT2" />);
    fireEvent.click(screen.getByTestId("new-terminal-launch"));
    await waitFor(() => expect(mockState.mounts).toEqual(["term-1"]));
    expect(mockState.lastVisible.get("term-1")).toBe(true);

    // Switch to a file tab → terminal hidden, not torn down.
    fireEvent.click(screen.getByTestId("open-file"));
    await screen.findByAltText("pic.png");
    expect(mockState.lastVisible.get("term-1")).toBe(false);
    expect(mockState.mounts).toEqual(["term-1"]);
    expect(mockState.unmounts).toEqual([]);

    // Switch back to the terminal tab → same instance, visible again.
    fireEvent.click(screen.getByTitle("term:term-1"));
    await waitFor(() => expect(mockState.lastVisible.get("term-1")).toBe(true));
    expect(mockState.mounts).toEqual(["term-1"]);
    expect(mockState.unmounts).toEqual([]);
  });

  it("unmounts only when the terminal tab is closed", async () => {
    render(<Harness sessionId="sT3" />);
    fireEvent.click(screen.getByTestId("new-terminal-launch"));
    await waitFor(() => expect(mockState.mounts).toEqual(["term-1"]));

    const tab = screen.getByTitle("term:term-1");
    fireEvent.click(within(tab).getByRole("button"));

    await waitFor(() => expect(mockState.unmounts).toEqual(["term-1"]));
    expect(screen.queryByTitle("term:term-1")).toBeNull();
  });
});
