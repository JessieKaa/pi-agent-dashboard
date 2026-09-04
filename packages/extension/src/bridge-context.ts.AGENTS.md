# bridge-context.ts — index

Shared mutable bridge state + pure predicates. Exports `BridgeContext`, `DASHBOARD_NATIVE_COMMANDS`, `consumeSessionReplacementHandoff` (one-shot owner-bound session replacement guard), `filterHiddenCommands`, `isExtensionSlashCommand`, `hasDispatchCommand`, `isHeadlessRpcSession`, `extractFirstMessage`, `extractFirstAssistantReply`, `extractLatestTurnWindow`, and `getCurrentModelString`. `filterHiddenCommands` maps `sourceInfo.path` to `CommandInfo.path` without overwriting an existing path. Stops 14+ closure vars passing to every extracted fn.
