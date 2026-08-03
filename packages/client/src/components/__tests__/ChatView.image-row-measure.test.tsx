import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createInitialState } from "../../lib/chat/event-reducer.js";
import { ChatView } from "../chat/ChatView.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import type { ToolContext } from "../tool-renderers/index.js";

const defaultToolContext: ToolContext = {};

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

describe("ChatView user attachment notice", () => {
  it("shows the attachment count without rendering or loading an image", () => {
    const state = createInitialState();
    state.messages.push({
      id: "u-img",
      role: "user",
      content: "here is an image",
      imageCount: 3,
      timestamp: Date.now(),
    });

    const { container } = render(
      <ThemeProvider>
        <ChatView sessionId="s1" state={state} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );

    expect(container.querySelectorAll('[data-testid="image-attachment-notice"]')).toHaveLength(1);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("Attached 3 image(s)");
  });
});
