import { describe, expect, it } from "vitest";
import { resolveSubscriptionTransition } from "../lib/session/subscription-transition.js";

// Coverage for change: fix-archive-feedback-and-sidebar-perf (C3).
//
// Before this change the client subscribed to a session's live stream on
// selection and NEVER unsubscribed — the server kept streaming every session
// the user ever opened for the lifetime of the tab (the server gates live
// frames on the subscription set). The transition releases on a genuine
// change; while a plugin overlay (which mounts its own subscribe for the
// session) is matched, BOTH the release and the ref advance hold, so the held
// subscription is still releasable once the overlay closes.
describe("resolveSubscriptionTransition", () => {
  it("releases the previous session on plain deselect", () => {
    expect(resolveSubscriptionTransition("A", undefined, false)).toEqual({
      release: "A",
      nextPrev: undefined,
    });
  });

  it("releases the previous session on a direct switch", () => {
    expect(resolveSubscriptionTransition("A", "B", false)).toEqual({
      release: "A",
      nextPrev: "B",
    });
  });

  it("releases nothing when no session was previously selected", () => {
    expect(resolveSubscriptionTransition(undefined, "B", false)).toEqual({
      release: undefined,
      nextPrev: "B",
    });
  });

  it("releases nothing when the selection is unchanged", () => {
    // The effect re-runs on `status`/`send` changes with the same selection;
    // a release here would cut the stream of the session still displayed.
    expect(resolveSubscriptionTransition("A", "A", false)).toEqual({
      release: undefined,
      nextPrev: "A",
    });
  });

  it("holds the release AND the ref while a plugin overlay is matched", () => {
    // The overlay's claim subscribes on its own; releasing the previous
    // selection's subscription would cut the overlay's stream. Freezing the
    // ref keeps the held session releasable when the overlay closes.
    expect(resolveSubscriptionTransition("A", undefined, true)).toEqual({
      release: undefined,
      nextPrev: "A",
    });
    expect(resolveSubscriptionTransition("A", "B", true)).toEqual({
      release: undefined,
      nextPrev: "A",
    });
  });

  it("releases the held subscription once the overlay closes", () => {
    const held = resolveSubscriptionTransition("A", "B", true);
    expect(resolveSubscriptionTransition(held.nextPrev, "B", false)).toEqual({
      release: "A",
      nextPrev: "B",
    });
  });
});
