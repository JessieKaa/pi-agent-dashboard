# event-reducer.ts — index

| File | Purpose |
|------|---------|
| `event-reducer.ts` | Event-sourced chat state reducer. `ChatMessage` supports `imageCount` for user prompts, rich `images` for rendered tool results, and `customType`/`groupId` for extension-authored custom rows; `historyGap` is a synthetic replay interstitial inserted by the message handler, never by `reduceEvent`. Assistant streaming text flushes before tool rows, assistant `message_end` reorders text/thinking/tool/interactive rows to match content order, and replay-safe deduplication preserves that ordering. Reasoning rows reconstruct from finalized content when no current-turn thinking row exists. Exports `createInitialState`, `reduceEvent`, `flushStreamingTextAsAssistantRow`, `addInteractiveRequest`, `resolveInteractiveRequest`, `dismissInteractiveRequest`, `deriveBannerState`, `isCleanAgentEnd`, `hasLaterAssistantInference`, and superseded-tool helpers. |
