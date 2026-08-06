import { useEffect, useState } from "react";
import {
  parseAgentTool,
  type AgentToolDef,
} from "~/lib/agents/contracts";

type ScopedProposal = {
  agentId: string;
  tool: AgentToolDef;
};

function parseScopedProposal(value: unknown): ScopedProposal | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }
  const detail = value as Record<string, unknown>;
  if (
    Object.keys(detail).length !== 2 ||
    typeof detail.agentId !== "string" ||
    !detail.agentId
  ) {
    return null;
  }
  const parsed = parseAgentTool(detail.tool);
  return parsed.error
    ? null
    : { agentId: detail.agentId, tool: parsed.value };
}

export function useScopedToolProposal(
  agentId: string,
  enabled: boolean,
): AgentToolDef | null {
  const [proposal, setProposal] = useState<ScopedProposal | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const applyTool = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const next = parseScopedProposal(event.detail);
      if (!next || next.agentId !== agentId) return;
      setProposal(next);
    };
    window.addEventListener("workbench:apply-tool", applyTool);
    return () => window.removeEventListener("workbench:apply-tool", applyTool);
  }, [agentId, enabled]);

  return proposal?.agentId === agentId ? proposal.tool : null;
}

export function useAgentContextScope(
  agentId: string,
  removeAgentContext?: (agentId: string) => void,
): void {
  useEffect(
    () => () => removeAgentContext?.(agentId),
    [agentId, removeAgentContext],
  );
}
