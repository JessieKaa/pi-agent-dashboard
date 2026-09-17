# MultiAskPanel.tsx — index

Grouped multi-ask panel (`data-testid="multi-ask-panel"`) for concurrently-pending free-floating asks. Vertical stack of independently-answerable cards; each reuses `getInteractiveRenderer(method)` and resolves its OWN `requestId` (no atomic submit). `method:"batch"` renders its BatchRenderer wizard in one slot. Renders null when empty. Fed by `derivePendingFreeFloating` from `ChatView`; hidden inline via `isRowVisible` while pending. See change: surface-concurrent-ask-user-prompts.
