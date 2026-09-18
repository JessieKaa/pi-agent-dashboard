import React, { lazy, Suspense, useEffect } from "react";
import type { ToolContext } from "../tool-renderers/types.js";

/**
 * Lazy boundary for the markdown payload. Every runtime surface that renders
 * markdown goes through this wrapper instead of importing `MarkdownContent`
 * directly — the payload (react-markdown + plugin stack + syntax highlighter,
 * ~1 MB) otherwise rides the landing preload graph. First-render surfaces pay
 * one chunk fetch (warmed by the mount-time prefetch right after landing);
 * after that the module is memoized by the dynamic-import cache.
 *
 * `context` re-types as a wider ToolContext so non-chat callers compile, and
 * is narrowed back at the boundary (`MarkdownContent` accepts any ToolContext
 * structurally). See change: trim-cold-start-transfer-and-config-fanout (③).
 */
const MarkdownContentLazy = lazy(() =>
  import("./MarkdownContent.js").then((m) => ({ default: m.MarkdownContent })),
);

/** Warm the markdown chunk right after the shell mounts (idempotent). */
export function prefetchMarkdownChunk(): void {
  void import("./MarkdownContent.js");
}

export type LazyMarkdownContentProps = Omit<
  React.ComponentProps<typeof MarkdownContentLazy>,
  "context"
> & {
  /** Wider than MarkdownContent's own prop so every call site compiles. */
  context?: ToolContext;
};

export function LazyMarkdownContent({ context, ...rest }: LazyMarkdownContentProps) {
  // Prefetch on mount so the boundary resolves in the same frame burst as the
  // host component, not one paint later.
  useEffect(() => {
    prefetchMarkdownChunk();
  }, []);

  return (
    <Suspense fallback={null}>
      <MarkdownContentLazy {...rest} context={context as never} />
    </Suspense>
  );
}
