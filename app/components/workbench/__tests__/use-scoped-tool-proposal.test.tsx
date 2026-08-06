import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  useAgentContextScope,
  useScopedToolProposal,
} from "../use-scoped-tool-proposal";

const tool = {
  name: "extract_article_text",
  description: "Extract article text.",
  parameters: { type: "object", properties: {} },
  source: "return String(args.html ?? '');",
};

function apply(agentId: string) {
  window.dispatchEvent(
    new CustomEvent("workbench:apply-tool", {
      detail: { agentId, tool },
    }),
  );
}

describe("useScopedToolProposal", () => {
  it("never carries a persisted proposal card into another agent", () => {
    const { result, rerender } = renderHook(
      ({ agentId }) => useScopedToolProposal(agentId, true),
      { initialProps: { agentId: "agent-a" } },
    );

    act(() => apply("agent-a"));
    expect(result.current).toEqual(tool);

    rerender({ agentId: "agent-b" });
    expect(result.current).toBeNull();

    act(() => apply("agent-a"));
    expect(result.current).toBeNull();

    act(() => apply("agent-b"));
    expect(result.current).toEqual(tool);
  });

  it("clears the departed agent context on navigation and unmount", () => {
    const removeAgentContext = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ agentId }) => useAgentContextScope(agentId, removeAgentContext),
      { initialProps: { agentId: "agent-a" } },
    );

    rerender({ agentId: "agent-b" });
    expect(removeAgentContext).toHaveBeenCalledWith("agent-a");

    unmount();
    expect(removeAgentContext).toHaveBeenLastCalledWith("agent-b");
  });
});
