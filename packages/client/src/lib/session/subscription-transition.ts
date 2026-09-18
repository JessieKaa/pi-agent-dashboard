/**
 * Session-subscription transition (change: fix-archive-feedback-and-sidebar-perf C3).
 *
 * The client subscribes to a session's live stream on selection and, before
 * this change, NEVER unsubscribed — the server kept streaming every session
 * the user ever opened for the lifetime of the tab. This pure transition
 * decides, for one selection change, which subscription (if any) must be
 * released and what the caller's prev-selection ref should become next.
 *
 * The overlay carve-out: a plugin overlay route (e.g. the subagent popout)
 * carries its own session param and its claim mounts its OWN subscribe for a
 * session the selection effect never selected. Releasing the previous
 * selection's subscription while that overlay is open would cut the overlay's
 * stream (the server gates live frames on the subscription set), so BOTH the
 * release and the ref advance hold until the overlay closes — freezing the
 * ref is what lets the held subscription still be released afterwards.
 *
 * See change: fix-archive-feedback-and-sidebar-perf (C3).
 */
export interface SubscriptionTransition {
  /** Session id whose live subscription must be released, or undefined. */
  release: string | undefined;
  /** Next value for the caller's prev-selection ref. */
  nextPrev: string | undefined;
}

export function resolveSubscriptionTransition(
  prevSelectedId: string | undefined,
  selectedId: string | undefined,
  overlayMatched: boolean,
): SubscriptionTransition {
  if (overlayMatched) return { release: undefined, nextPrev: prevSelectedId };
  const release =
    prevSelectedId !== undefined && prevSelectedId !== selectedId ? prevSelectedId : undefined;
  return { release, nextPrev: selectedId };
}
