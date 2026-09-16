# SplitDivider.tsx — index

Draggable divider (outer chat/editor + inner rail). Reports pointer coord; orientation-aware cursor. Optional `‹`/`›` collapse chevrons (`onCollapseChat`→full, `onCollapseEditor`→closed; `stopPropagation` drag-vs-click guard, testids `split-fold-chat`/`split-fold-editor`). Body cursor/`userSelect` via `useBodyDragStyle` (unmount-mid-drag clears). See change: split-editor-workspace. See change: editor-layout-modes. See change: fix-ux-degradation-long-session.
