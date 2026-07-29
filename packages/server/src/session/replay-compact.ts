import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { StoredEvent } from "../persistence/memory-event-store.js";

const DROPPABLE_UPDATE_TYPES = new Set(["toolcall_delta", "text_start", "text_delta", "text_end"]);

function messageKey(event: DashboardEvent): string | null {
  const message = (event.data as { message?: { role?: unknown; timestamp?: unknown } } | undefined)?.message;
  if (!message || typeof message.role !== "string" || typeof message.timestamp !== "number") return null;
  return `${message.role}:${message.timestamp}`;
}

export function compactReplayEvents(events: StoredEvent[]): StoredEvent[] {
  const completedCounts = new Map<string, number>();
  const compacted: StoredEvent[] = [];
  let dropped = false;

  for (let i = events.length - 1; i >= 0; i--) {
    const stored = events[i];
    const key = messageKey(stored.event);

    if (stored.event.eventType === "message_end" && key) {
      completedCounts.set(key, (completedCounts.get(key) ?? 0) + 1);
      compacted.push(stored);
      continue;
    }

    if (stored.event.eventType === "message_start" && key) {
      const count = completedCounts.get(key) ?? 0;
      if (count <= 1) completedCounts.delete(key);
      else completedCounts.set(key, count - 1);
      compacted.push(stored);
      continue;
    }

    if (stored.event.eventType === "message_update" && key && (completedCounts.get(key) ?? 0) > 0) {
      const updateType = (
        stored.event.data as { assistantMessageEvent?: { type?: unknown } } | undefined
      )?.assistantMessageEvent?.type;
      if (typeof updateType === "string" && DROPPABLE_UPDATE_TYPES.has(updateType)) {
        dropped = true;
        continue;
      }
    }

    compacted.push(stored);
  }

  if (!dropped) return events;
  compacted.reverse();
  return compacted;
}
