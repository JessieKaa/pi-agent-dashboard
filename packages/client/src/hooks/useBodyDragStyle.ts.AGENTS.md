# useBodyDragStyle.ts — index

NEW. `useBodyDragStyle(): { beginBodyDrag(cursor), endBodyDrag() }` — sets/clears `document.body.style.cursor` + `userSelect:none` for resize drags; ref-held active flag, no setState. Unmount cleanup clears styles ONLY if a drag was active (idle unmount no-op → a second instance / StrictMode mount cannot clobber a live drag). Consumed by `ResizableSidebar`, `SplitDivider`, `FileDiffView`'s `ResizableTreePanel`; `useTreeColumnWidth` keeps its own equivalent guarded cleanup (not refactored). See change: fix-ux-degradation-long-session.
