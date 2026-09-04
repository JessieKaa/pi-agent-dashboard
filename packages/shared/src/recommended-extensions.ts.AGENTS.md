# recommended-extensions.ts — index

Curated manifest of recommended pi extensions. `RecommendedExtension` (id, source, displayName, status, unlocks, requires, dashboardPlugin), `EnrichedRecommendedExtension`, `RECOMMENDED_EXTENSIONS` const (required/strongly-suggested/optional), `BUNDLED_EXTENSION_IDS` (git-only Electron pre-bundle set), `getRecommendedExtension(id)`, `getRecommendedByStatus(status)`. pi-dashboard-subagents floor >= 0.2.3 (emits `agentSessionId`); graceful-degrade to single-key on older producer. See change: resolve-subagent-inspector-by-session-id.
