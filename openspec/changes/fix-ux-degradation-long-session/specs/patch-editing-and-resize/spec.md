# patch-editing-and-resize Specification

## ADDED Requirements

### Requirement: Body drag styles are scoped to a drag lifecycle

A mouse-drag resize surface (sidebar seam, split divider, tree-panel gutter) that
sets a global drag affordance on `document.body` — the resize `cursor` and
`user-select: none` — SHALL clear both when the drag ends AND when the surface
unmounts. The unmount path is mandatory because a drag can be interrupted (layout
breakpoint flip, panel collapse, session switch) or ended outside the document
(pointer released outside the window leaves no `mouseup` on the page), and a
leftover `user-select: none` permanently prevents text selection and copying
across the whole dashboard.

The contract SHALL be owned by one shared hook (`useBodyDragStyle`) exposing
`beginBodyDrag(cursor)` / `endBodyDrag()`; unmount cleanup SHALL be a no-op when
no drag is active, so multiple mounted surfaces (and StrictMode's double-invoke)
cannot clear each other's styles.

#### Scenario: Drag end clears the styles

- **WHEN** a drag begins on a resize surface and the `mouseup` is received
- **THEN** `document.body.style.cursor` and `userSelect` SHALL be cleared
- **AND** the drag surface's own `dragging` state SHALL stop gating move/up handling

#### Scenario: Unmount mid-drag clears the styles

- **WHEN** a resize surface is unmounted while its drag is still active (breakpoint
  flip, collapse, or session switch during the drag)
- **THEN** `document.body.style.cursor` and `userSelect` SHALL be cleared
- **AND** the page SHALL remain text-selectable and copyable without a refresh

#### Scenario: Unmount while idle does not touch body styles

- **WHEN** an idle resize surface unmounts (no drag in progress, e.g. a second
  mounted instance or StrictMode's discarded first mount)
- **THEN** it SHALL NOT clear the styles of a concurrently active drag elsewhere

#### Scenario: Mouse released outside the window

- **WHEN** a drag begins and the pointer is released outside the window (no
  `mouseup` received) and the surface is subsequently unmounted
- **THEN** the body styles SHALL be cleared by the unmount path
