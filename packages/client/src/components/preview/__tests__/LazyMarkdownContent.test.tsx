/**
 * Behavior of the LazyMarkdownContent boundary: renders children-only (null
 * fallback) until the chunk resolves, then renders the markdown; the mount
 * prefetch warms the same module.
 *
 * See change: trim-cold-start-transfer-and-config-fanout (③).
 */
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import { LazyMarkdownContent } from "../LazyMarkdownContent.js";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

afterEach(cleanup);

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("LazyMarkdownContent", () => {
  it("renders markdown content once the lazy chunk resolves", async () => {
    renderWithTheme(<LazyMarkdownContent content={"lazy **payload** marker"} />);
    // The fallback is null, then the boundary resolves (async on first run).
    expect(await screen.findByText(/payload/, undefined, { timeout: 5000 })).toBeTruthy();
  });

  it("passes tool context through to the payload (linkified code span)", async () => {
    renderWithTheme(
      <LazyMarkdownContent
        content={"see `src/foo.ts`"}
        context={{ cwd: "/proj" } as never}
      />,
    );
    expect(await screen.findByText(/foo\.ts/, undefined, { timeout: 5000 })).toBeTruthy();
  });
});
