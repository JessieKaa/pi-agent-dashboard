import type { HistoryWindowMetadata } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { StoredEvent } from "../persistence/memory-event-store.js";

export interface ReplayWindowSelection {
  events: StoredEvent[];
  metadata: HistoryWindowMetadata;
}

function messageRole(event: DashboardEvent): unknown {
  return (event.data as { message?: { role?: unknown } } | undefined)?.message?.role;
}

function isLogicalItem(event: DashboardEvent): boolean {
  if (event.eventType === "message_start") return messageRole(event) === "user";
  if (event.eventType === "message_end") return messageRole(event) === "assistant";
  if (event.eventType === "tool_execution_start") return true;
  return [
    "bash_output",
    "command_feedback",
    "session_compact",
    "extension_ui_request",
    "interactive_ui_request",
  ].includes(event.eventType);
}

function isUserBoundary(event: DashboardEvent): boolean {
  return event.eventType === "message_start" && messageRole(event) === "user";
}

function countLogicalItems(events: readonly StoredEvent[]): number {
  let count = 0;
  for (const stored of events) {
    if (isLogicalItem(stored.event)) count++;
  }
  return count;
}

export function selectReplayWindow(
  stored: readonly StoredEvent[],
  requestedMessages: number,
): ReplayWindowSelection {
  const requested = Number.isFinite(requestedMessages)
    ? Math.max(1, Math.floor(requestedMessages))
    : 1;
  if (stored.length === 0) {
    return {
      events: [],
      metadata: {
        requestedMessages: requested,
        effectiveMessages: 0,
        startSeq: null,
        endSeq: 0,
        hasOlder: false,
      },
    };
  }

  let startIndex = stored.length - 1;
  let logicalItems = 0;
  for (let i = stored.length - 1; i >= 0; i--) {
    startIndex = i;
    if (isLogicalItem(stored[i].event)) logicalItems++;
    if (logicalItems >= requested) break;
  }

  if (startIndex > 0) {
    for (let i = startIndex; i >= 0; i--) {
      if (isUserBoundary(stored[i].event)) {
        startIndex = i;
        while (
          startIndex > 0 &&
          (stored[startIndex - 1].event.eventType === "agent_start" ||
            stored[startIndex - 1].event.eventType === "turn_start")
        ) {
          startIndex--;
        }
        break;
      }
      if (i === 0) startIndex = 0;
    }
  }

  const events = stored.slice(startIndex);
  return {
    events,
    metadata: {
      requestedMessages: requested,
      effectiveMessages: countLogicalItems(events),
      startSeq: events[0]?.seq ?? null,
      endSeq: events[events.length - 1]?.seq ?? 0,
      hasOlder: startIndex > 0,
    },
  };
}
