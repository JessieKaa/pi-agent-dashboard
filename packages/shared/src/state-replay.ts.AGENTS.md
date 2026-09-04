# state-replay.ts — index

Synthesizes dashboard `event_forward` messages from persisted pi session entries for post-reconnect chat… → see `state-replay.ts.AGENTS.md` New replay arms: `custom_message` (display!==false) synthesizes `message_end` role=custom; generic `custom` entries (non-flow-event, checked AFTER the flow-event arm) synthesize `custom_entry` {customType,data,entryId}. See change: render-inline-reasoning-and-custom-entries.
