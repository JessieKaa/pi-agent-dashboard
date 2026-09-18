## REMOVED Requirements

### Requirement: Lazy session subscription
**Reason**: Superseded by the `session-subscription-lifecycle` capability. This requirement specified only the lazy half of the lifecycle (subscribe on selection, never auto-subscribe); the client release paths (deselect release, overlay hold, exhausted reconnect) had no requirement at all. The retired text also misstated the current scope: sidebar cards receive metadata from the on-connect `sessions_snapshot`, not from per-session `session_added` broadcasts, and an overlay's cold-open subscribe is the overlay claim's responsibility, not the selection effect's.
**Migration**: No code migration — the subscribe-on-selection behavior is unchanged. See the `session-subscription-lifecycle` delta (ADDED) for the full lifecycle requirements.
