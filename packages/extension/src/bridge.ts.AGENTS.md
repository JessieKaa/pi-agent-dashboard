# bridge.ts — index

Main bridge extension entry (default export). Connects to dashboard server, forwards pi events via `mapEventToProtocol`, and relays `ServerToExtensionMessage` commands. Wires `PromptBus`, dashboard adapters, provider/model and role registration, flow and EventBus forwarding, metrics, git/session trackers, autostart, migration verification, inbound-drop diagnostics, and transcript guards.

`initBridge()` maintains process-global ownership and accepts a one-shot owner-bound handoff for Pi `/reload`, `/resume`, `/new`, and `/fork` replacement instances. `session_shutdown` preserves reason-sensitive unregister behavior: `quit` sends `reason:"quit"`, replacement reasons defer unregister to session-change handling, and unknown legacy reasons send a terminal unregister.

`message_update` text snapshots use `MessageUpdateCoalescer` with a single-slot 50 ms window. Thinking/toolcall/unknown updates and lifecycle/EventBus boundaries flush first; generation plus stable message keys drop stale updates. Reconnect defers parked-update flush to a microtask so `ConnectionManager` drains buffered `message_start` frames first. Session switch, shutdown, and reload cleanup flush or clear the coalescer as appropriate. See changes: coalesce-message-update-text-snapshots, preserve-message-update-ordering.
