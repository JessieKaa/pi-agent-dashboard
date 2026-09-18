import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** Get display name for a session: name → firstMessage (truncated) → cwd last segment → ID prefix.
 *  The basename fallback carries an id suffix so unnamed sessions in one folder
 *  stay distinguishable ("rpa-dispatcher · 01a0b293" vs "… · 01a08e74").
 *  See change: fix-archive-feedback-and-sidebar-perf (A1). */
export function getSessionDisplayName(session: DashboardSession): string {
  if (session.name && session.name.trim()) {
    return session.name.trim();
  }
  if (session.firstMessage && session.firstMessage.trim()) {
    const msg = session.firstMessage.trim();
    return msg.length > 50 ? msg.slice(0, 50) + "..." : msg;
  }
  const basename = session.cwd.split("/").pop() || "";
  if (!basename) return session.id.slice(0, 8);
  return `${basename} · ${session.id.slice(0, 8)}`;
}
