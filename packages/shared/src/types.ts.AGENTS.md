# types.ts — index

Core dashboard shared type surface. Exports `DashboardSession`, `DashboardEvent`, `FlowInfo`, `CommandInfo`,… → see `types.ts.AGENTS.md` Adds `OpenSpecData.hasOpenSpecSkills?: boolean` + `readiness?: OpenSpecReadiness` (`{state, reason?}`; 7-state precedence, reasons `missing-changes-dir|cli-failed|missing-skills|profile-stale`). Optional — undefined degrades clients to the legacy gate. See change: add-openspec-init-affordances.
