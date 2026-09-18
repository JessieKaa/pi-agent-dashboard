import React, { lazy, Suspense, useEffect } from "react";
import type { InteractiveRendererProps } from "./types.js";

/**
 * Lazy host for the interactive-renderer registry. The registry (and its eight
 * renderers) statically imports react-markdown via InlineMarkdown, so reaching
 * it from the eager graph would re-pin the markdown payload; this host loads
 * the whole family on demand — which is fine, interactive cards only exist in
 * response to a live `ask_user`/UI request.
 *
 * See change: trim-cold-start-transfer-and-config-fanout (③).
 */
const LazyRenderer = lazy(() =>
  import("./registry.js").then((m) => ({
    default: function ResolvedRenderer(props: InteractiveRendererProps) {
      const Renderer = m.getInteractiveRenderer(props.method);
      return <Renderer {...props} />;
    },
  })),
);

export function prefetchInteractiveRenderers(): void {
  void import("./registry.js");
}

export function LazyInteractiveRenderer(props: InteractiveRendererProps) {
  useEffect(() => {
    prefetchInteractiveRenderers();
  }, []);

  return (
    <Suspense fallback={null}>
      <LazyRenderer {...props} />
    </Suspense>
  );
}
