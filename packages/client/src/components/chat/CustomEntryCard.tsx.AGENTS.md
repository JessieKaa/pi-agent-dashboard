# CustomEntryCard.tsx — index

Bounded generic fallback card for non-`flow-event` custom content (pi.sendMessage custom messages + pi.appendEntry entries): `customType` label + PLAIN-TEXT `<pre>` body (never markdown — untrusted extension input), body visible by default in a `max-h-[240px]` region. Props `{customType, body, timestamp}`; the reducer truncates at row creation. Rendered from ChatView's `role:"custom"` branch, gated by `prefs.customEntryFallback`. See change: render-inline-reasoning-and-custom-entries.
