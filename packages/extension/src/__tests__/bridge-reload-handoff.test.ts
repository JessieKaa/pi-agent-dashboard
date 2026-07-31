import { describe, expect, it } from "vitest";
import { consumeSessionReplacementHandoff } from "../bridge-context.js";

type Owner = { id: string };

type State = {
  sessionReplacementHandoff?: { owner: Owner; expiresAt: number };
};

describe("consumeSessionReplacementHandoff", () => {
  it("allows the first bridge instance without a handoff", () => {
    const state: State = {};
    const owner = { id: "first" };

    expect(consumeSessionReplacementHandoff(state, undefined, owner, 1000)).toBe(true);
    expect(state.sessionReplacementHandoff).toBeUndefined();
  });

  it("keeps an unrelated extension instance from taking over", () => {
    const state: State = {};
    const ownerA = { id: "a" };
    const ownerB = { id: "b" };

    expect(consumeSessionReplacementHandoff(state, ownerA, ownerB, 1000)).toBe(false);
  });

  it("allows one replacement after a reload and consumes the handoff", () => {
    const previousOwner = { id: "a" };
    const state: State = {
      sessionReplacementHandoff: { owner: previousOwner, expiresAt: 6000 },
    };
    const replacement = { id: "b" };

    expect(consumeSessionReplacementHandoff(state, previousOwner, replacement, 5000)).toBe(true);
    expect(state.sessionReplacementHandoff).toBeUndefined();
    expect(consumeSessionReplacementHandoff(state, replacement, { id: "c" }, 5001)).toBe(false);
  });

  it("rejects a handoff from another owner", () => {
    const state: State = {
      sessionReplacementHandoff: { owner: { id: "a" }, expiresAt: 6000 },
    };

    expect(consumeSessionReplacementHandoff(state, { id: "other" }, { id: "next" }, 5000)).toBe(false);
    expect(state.sessionReplacementHandoff).toBeUndefined();
  });

  it("rejects and clears an expired handoff", () => {
    const previousOwner = { id: "a" };
    const state: State = {
      sessionReplacementHandoff: { owner: previousOwner, expiresAt: 5000 },
    };

    expect(consumeSessionReplacementHandoff(state, previousOwner, { id: "b" }, 5000)).toBe(false);
    expect(state.sessionReplacementHandoff).toBeUndefined();
  });

  it("clears a stale handoff when the same bridge instance initializes", () => {
    const owner = { id: "a" };
    const state: State = {
      sessionReplacementHandoff: { owner, expiresAt: 6000 },
    };

    expect(consumeSessionReplacementHandoff(state, owner, owner, 1000)).toBe(true);
    expect(state.sessionReplacementHandoff).toBeUndefined();
  });
});
