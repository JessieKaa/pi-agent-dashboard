import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { getSessionDisplayName } from "../session/session-display-name.js";

function makeSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "test-id",
    cwd: "/home/user/my-project",
    source: "tui",
    status: "active",
    startedAt: Date.now(),
    ...overrides,
  };
}

describe("getSessionDisplayName", () => {
  it("returns name when set", () => {
    expect(getSessionDisplayName(makeSession({ name: "My Session" }))).toBe("My Session");
  });

  it("returns cwd last segment with id suffix when name is undefined", () => {
    expect(getSessionDisplayName(makeSession({ name: undefined }))).toBe("my-project · test-id");
  });

  it("returns cwd last segment with id suffix when name is empty string", () => {
    expect(getSessionDisplayName(makeSession({ name: "" }))).toBe("my-project · test-id");
  });

  it("returns cwd last segment with id suffix when name is whitespace only", () => {
    expect(getSessionDisplayName(makeSession({ name: "   " }))).toBe("my-project · test-id");
  });

  it("trims name whitespace", () => {
    expect(getSessionDisplayName(makeSession({ name: "  Hello  " }))).toBe("Hello");
  });

  it("does not suffix a firstMessage-derived label", () => {
    expect(getSessionDisplayName(makeSession({ firstMessage: "Fix the build" }))).toBe("Fix the build");
  });

  it("distinguishes two unnamed sessions in the same folder", () => {
    const a = getSessionDisplayName(makeSession({ id: "01a0b293aaaaaaaa" }));
    const b = getSessionDisplayName(makeSession({ id: "01a08e74bbbbbbbb" }));
    expect(a).not.toBe(b);
  });

  it("falls back to session id when cwd has no slash", () => {
    expect(getSessionDisplayName(makeSession({ cwd: "" }))).toBe("test-id".slice(0, 8));
  });
});
