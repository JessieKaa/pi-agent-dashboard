import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import React from "react";

interface Props {
  id: string;
  children: React.ReactNode;
}

/**
 * Ref-stable channel for the dnd-kit drag handle props (attributes +
 * listeners). `useSortable` returns a NEW `listeners` object on every call, so
 * a plain context value would change identity on every sidebar render — and a
 * context value change re-renders ALL consumers, straight through the
 * `React.memo` boundary on `SessionCard` (memo cannot skip context-driven
 * renders). The box object here never changes identity; SortableSessionCard
 * refreshes its `.current` in place each render, and the card reads the latest
 * value at its own render time (bottom-anchored reads: the wrapper renders
 * first in the same pass). Skipped cards keep the previous DOM props — safe
 * because the listener closures read live dnd state (registered nodes, latest
 * sensor config) at activation, and `attributes` is identity-stable per id.
 * Using a box (instead of cloneElement) also lets `SortableSessionCard` accept
 * arbitrary children (e.g. a SessionCard plus a resume-error banner sibling).
 * See change: fix-archive-feedback-and-sidebar-perf (C1).
 */
interface DragHandleBox {
  current: React.HTMLAttributes<HTMLDivElement> | null;
}

const DragHandleCtx = React.createContext<DragHandleBox | null>(null);

export function useSessionCardDragHandle() {
  return React.useContext(DragHandleCtx)?.current ?? null;
}

/**
 * Wraps a SessionCard with dnd-kit sortable behavior. The drag zone used to be
 * the card's 20px left gutter; that gutter is gone, so the props now land on
 * the card's hover-revealed grip bead in the directory-rail band (still via
 * DragHandleCtx). See change: session-card-directory-rail.
 */
export function SortableSessionCard({ id, children }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, data: { type: "session" } });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: "relative",
  };

  const dragHandleProps = React.useMemo(
    () => ({ ...attributes, ...listeners }) as React.HTMLAttributes<HTMLDivElement>,
    [attributes, listeners],
  );

  // Single identity-stable box per card (see DragHandleCtx). Refresh the value
  // in place — the object identity never changes, so consumers' memo
  // boundaries survive dnd's per-render `listeners` churn.
  const dragHandleBoxRef = React.useRef<DragHandleBox>({ current: null });
  dragHandleBoxRef.current.current = dragHandleProps;

  return (
    <div ref={setNodeRef} style={style}>
      <DragHandleCtx.Provider value={dragHandleBoxRef.current}>{children}</DragHandleCtx.Provider>
    </div>
  );
}
