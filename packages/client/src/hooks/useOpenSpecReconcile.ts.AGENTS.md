# useOpenSpecReconcile.ts — index

New. Reconciliation pull (D7): sends one `openspec_get` per rendered cwd with no settled OpenSpec entry and no in-flight request; 15 s per-cwd timeout; clears in-flight on socket open. See change: fix-connect-snapshot-frame-loss.
