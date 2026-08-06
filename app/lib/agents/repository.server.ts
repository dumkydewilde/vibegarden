import { and, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";

import {
  agents,
  agentVersions,
  type Agent,
  type AgentVersion,
} from "~/db/schema";
import type { Db } from "~/lib/db.server";
import { parseAgentDefinition, type AgentDefinition } from "./contracts";

export type AgentScope = { clubId: string; userId: string };

type AgentInput = {
  name: string;
  description: string;
  definition: AgentDefinition;
};

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function newAgentId(): string {
  return `agent_${crypto.randomUUID()}`;
}

function newVersionId(): string {
  return `agentv_${crypto.randomUUID()}`;
}

export async function createAgent(
  db: Db,
  scope: AgentScope,
  input: AgentInput,
): Promise<{ agent: Agent; version: AgentVersion }> {
  const now = nowSeconds();
  const agentId = newAgentId();
  const versionId = newVersionId();
  const pendingAgent: Agent = {
    id: agentId,
    clubId: scope.clubId,
    ownerId: scope.userId,
    name: input.name,
    description: input.description,
    visibility: "private",
    latestVersionId: null,
    sharedVersionId: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const version: AgentVersion = {
    id: versionId,
    agentId,
    definition: JSON.stringify(input.definition),
    createdBy: scope.userId,
    createdAt: now,
  };

  await db.insert(agents).values(pendingAgent);
  await db.insert(agentVersions).values(version);
  await db
    .update(agents)
    .set({ latestVersionId: versionId })
    .where(
      and(
        eq(agents.id, agentId),
        eq(agents.clubId, scope.clubId),
        eq(agents.ownerId, scope.userId),
        isNull(agents.deletedAt),
      ),
    );

  return {
    agent: { ...pendingAgent, latestVersionId: versionId },
    version,
  };
}

export async function saveAgentVersion(
  db: Db,
  scope: AgentScope,
  agentId: string,
  input: AgentInput,
): Promise<AgentVersion> {
  const owned = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        eq(agents.id, agentId),
        eq(agents.clubId, scope.clubId),
        eq(agents.ownerId, scope.userId),
        isNull(agents.deletedAt),
      ),
    )
    .limit(1);
  if (!owned[0]) throw new Error("Agent not found or not authorized.");

  const now = nowSeconds();
  const version: AgentVersion = {
    id: newVersionId(),
    agentId,
    definition: JSON.stringify(input.definition),
    createdBy: scope.userId,
    createdAt: now,
  };
  await db.insert(agentVersions).values(version);
  await db
    .update(agents)
    .set({
      name: input.name,
      description: input.description,
      latestVersionId: version.id,
      updatedAt: now,
    })
    .where(
      and(
        eq(agents.id, agentId),
        eq(agents.clubId, scope.clubId),
        eq(agents.ownerId, scope.userId),
        isNull(agents.deletedAt),
      ),
    );
  return version;
}

export async function listAgents(
  db: Db,
  scope: AgentScope,
): Promise<{ mine: Agent[]; shared: Agent[] }> {
  const mine = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.clubId, scope.clubId),
        eq(agents.ownerId, scope.userId),
        isNull(agents.deletedAt),
      ),
    )
    .orderBy(desc(agents.updatedAt), desc(agents.id));
  const shared = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.clubId, scope.clubId),
        ne(agents.ownerId, scope.userId),
        eq(agents.visibility, "club"),
        isNull(agents.deletedAt),
      ),
    )
    .orderBy(desc(agents.updatedAt), desc(agents.id));

  return { mine, shared };
}

export async function getAgentForUser(
  db: Db,
  scope: AgentScope,
  agentId: string,
  versionId?: string,
): Promise<{
  agent: Agent;
  version: AgentVersion;
  definition: AgentDefinition;
} | null> {
  const rows = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.id, agentId),
        eq(agents.clubId, scope.clubId),
        isNull(agents.deletedAt),
      ),
    )
    .limit(1);
  const agent = rows[0];
  if (!agent) return null;

  const isOwner = agent.ownerId === scope.userId;
  if (!isOwner && agent.visibility !== "club") return null;
  const selectedVersionId = isOwner
    ? versionId ?? agent.latestVersionId
    : agent.sharedVersionId;
  if (!selectedVersionId) return null;

  const versions = await db
    .select()
    .from(agentVersions)
    .where(
      and(
        eq(agentVersions.id, selectedVersionId),
        eq(agentVersions.agentId, agent.id),
      ),
    )
    .limit(1);
  const version = versions[0];
  if (!version) return null;

  let stored: unknown;
  try {
    stored = JSON.parse(version.definition);
  } catch (error) {
    console.error("Invalid stored agent definition JSON.", {
      agentId: agent.id,
      versionId: version.id,
      error,
    });
    return null;
  }
  const parsed = parseAgentDefinition(stored);
  if (parsed.error) {
    console.error("Invalid stored agent definition.", {
      agentId: agent.id,
      versionId: version.id,
      error: parsed.error,
    });
    return null;
  }

  return { agent, version, definition: parsed.value };
}

export async function setAgentSharing(
  db: Db,
  scope: AgentScope,
  agentId: string,
  share: boolean,
): Promise<Agent | null> {
  const result = await db
    .update(agents)
    .set(
      share
        ? {
            visibility: "club",
            sharedVersionId: sql`${agents.latestVersionId}`,
            updatedAt: nowSeconds(),
          }
        : {
            visibility: "private",
            sharedVersionId: null,
            updatedAt: nowSeconds(),
          },
    )
    .where(
      and(
        eq(agents.id, agentId),
        eq(agents.clubId, scope.clubId),
        eq(agents.ownerId, scope.userId),
        isNull(agents.deletedAt),
        ...(share ? [isNotNull(agents.latestVersionId)] : []),
      ),
    )
    .run();
  if (result.meta.changes === 0) return null;

  const rows = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.id, agentId),
        eq(agents.clubId, scope.clubId),
        eq(agents.ownerId, scope.userId),
        isNull(agents.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteAgent(
  db: Db,
  scope: AgentScope,
  agentId: string,
): Promise<boolean> {
  const result = await db
    .update(agents)
    .set({ deletedAt: nowSeconds() })
    .where(
      and(
        eq(agents.id, agentId),
        eq(agents.clubId, scope.clubId),
        eq(agents.ownerId, scope.userId),
        isNull(agents.deletedAt),
      ),
    )
    .run();
  return result.meta.changes > 0;
}
