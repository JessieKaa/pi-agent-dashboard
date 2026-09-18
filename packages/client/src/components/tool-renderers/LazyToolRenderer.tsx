import React, { lazy, Suspense, useEffect } from "react";
import type { ToolContext, ToolRendererProps } from "./types.js";

/**
 * Lazy host for the built-in tool-renderer registry. The registry statically
 * imports Read/Write/Ctx (syntax highlighter), Agent/AskUser (markdown), Edit
 * (diff/overlay) — reaching it eagerly would re-pin the markdown payload into
 * the landing graph. The host resolves the registry at mount; a bare chat
 * still fetches the chunk (tool rows are common) but after first paint.
 *
 * Plugin `tool-renderer` claims stay outside this boundary (their components
 * already arrive at runtime from plugin bundles).
 *
 * See change: trim-cold-start-transfer-and-config-fanout (③).
 */
const LazyRenderer = lazy(() =>
  import("./index.js").then((m) => ({
    default: function ResolvedToolRenderer(props: ToolRendererProps) {
      const Renderer = m.getToolRenderer(props.toolName);
      return <Renderer {...props} />;
    },
  })),
);

export function prefetchToolRenderers(): void {
  void import("./index.js");
}

export function LazyToolRenderer(
  props: Omit<ToolRendererProps, "context"> & { context: ToolContext },
) {
  useEffect(() => {
    prefetchToolRenderers();
  }, []);

  return (
    <Suspense fallback={null}>
      <LazyRenderer {...props} />
    </Suspense>
  );
}
