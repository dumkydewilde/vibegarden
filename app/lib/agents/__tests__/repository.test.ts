import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "~/lib/db.server";
import { emptyDefinition, type AgentDefinition } from "../contracts";
import {
  createAgent,
  deleteAgent,
  getAgentForUser,
  listAgents,
  saveAgentVersion,
  type AgentScope,
} from "../repository.server";

const ownerScope: AgentScope = { clubId: "agents-club", userId: "agents-owner" };
const memberScope: AgentScope = { clubId: "agents-club", userId: "agents-member" };
const otherClubScope: AgentScope = { clubId: "agents-other-club", userId: "agents-member" };

function definition(systemPrompt: string): AgentDefinition {
  return { ...emptyDefinition(), systemPrompt };
}

async function seed(): Promise<void> {
  const now = 1_784_880_000;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)").bind(
      "agents-owner",
      "agents-owner@example.com",
      now,
    ),
    env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)").bind(
      "agents-member",
      "agents-member@example.com",
      now,
    ),
    env.DB.prepare(
      "INSERT INTO clubs (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).bind("agents-club", "Agents Club", "agents-club", now, now),
    env.DB.prepare(
      "INSERT INTO clubs (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).bind("agents-other-club", "Other Club", "agents-other-club", now, now),
    env.DB.prepare(
      "INSERT INTO club_memberships (club_id, user_id, role, joined_at, updated_at) VALUES (?, ?, 'member', ?, ?)",
    ).bind("agents-club", "agents-owner", now, now),
    env.DB.prepare(
      "INSERT INTO club_memberships (club_id, user_id, role, joined_at, updated_at) VALUES (?, ?, 'member', ?, ?)",
    ).bind("agents-club", "agents-member", now, now),
    env.DB.prepare(
      "INSERT INTO club_memberships (club_id, user_id, role, joined_at, updated_at) VALUES (?, ?, 'member', ?, ?)",
    ).bind("agents-other-club", "agents-member", now, now),
  ]);
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM agent_versions"),
    env.DB.prepare("DELETE FROM agents"),
    env.DB.prepare("DELETE FROM club_memberships WHERE user_id LIKE 'agents-%'"),
    env.DB.prepare("DELETE FROM clubs WHERE id LIKE 'agents-%'"),
    env.DB.prepare("DELETE FROM users WHERE id LIKE 'agents-%'"),
  ]);
  await seed();
});

describe("agents repository", () => {
  it("creates an agent and round-trips its definition through stored JSON", async () => {
    const db = getDb({ DB: env.DB } as Env);
    const inputDefinition = definition("Answer with practical examples.");

    const created = await createAgent(db, ownerScope, {
      name: "Docs helper",
      description: "Helps write docs",
      definition: inputDefinition,
    });
    const loaded = await getAgentForUser(db, ownerScope, created.agent.id);

    expect(created.agent.id).toMatch(/^agent_[0-9a-f-]+$/u);
    expect(created.version.id).toMatch(/^agentv_[0-9a-f-]+$/u);
    expect(created.agent.latestVersionId).toBe(created.version.id);
    expect(created.agent.createdAt).toBeLessThan(100_000_000_000);
    expect(loaded?.definition).toEqual(inputDefinition);
    expect(loaded?.version).toEqual(created.version);
  });

  it("does not let a non-owner save a version", async () => {
    const db = getDb({ DB: env.DB } as Env);
    const created = await createAgent(db, ownerScope, {
      name: "Private helper",
      description: "Owner only",
      definition: definition("Original"),
    });

    await expect(
      saveAgentVersion(db, memberScope, created.agent.id, {
        name: "Stolen helper",
        description: "Changed by someone else",
        definition: definition("Changed"),
      }),
    ).rejects.toThrow(/not authorized/i);

    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM agent_versions WHERE agent_id = ?",
    ).bind(created.agent.id).first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("separates owned and shared agents without exposing private or cross-club rows", async () => {
    const db = getDb({ DB: env.DB } as Env);
    const mine = await createAgent(db, memberScope, {
      name: "Mine",
      description: "Owned",
      definition: definition("Mine"),
    });
    const shared = await createAgent(db, ownerScope, {
      name: "Shared",
      description: "Visible to club",
      definition: definition("Shared"),
    });
    const hidden = await createAgent(db, ownerScope, {
      name: "Hidden",
      description: "Private",
      definition: definition("Hidden"),
    });
    const otherClub = await createAgent(db, otherClubScope, {
      name: "Other club",
      description: "Wrong club",
      definition: definition("Other"),
    });
    await env.DB.prepare(
      "UPDATE agents SET visibility = 'club', shared_version_id = latest_version_id WHERE id IN (?, ?)",
    ).bind(shared.agent.id, otherClub.agent.id).run();

    const listed = await listAgents(db, memberScope);

    expect(listed.mine.map((agent) => agent.id)).toEqual([mine.agent.id]);
    expect(listed.shared.map((agent) => agent.id)).toEqual([shared.agent.id]);
    expect([...listed.mine, ...listed.shared].map((agent) => agent.id)).not.toContain(
      hidden.agent.id,
    );
  });

  it("pins non-owners to the shared version after a newer owner draft", async () => {
    const db = getDb({ DB: env.DB } as Env);
    const created = await createAgent(db, ownerScope, {
      name: "Shared helper",
      description: "Version one",
      definition: definition("Shared version"),
    });
    await env.DB.prepare(
      "UPDATE agents SET visibility = 'club', shared_version_id = latest_version_id WHERE id = ?",
    ).bind(created.agent.id).run();
    const draft = await saveAgentVersion(db, ownerScope, created.agent.id, {
      name: "Shared helper",
      description: "Version two",
      definition: definition("Private draft"),
    });

    const memberLoad = await getAgentForUser(
      db,
      memberScope,
      created.agent.id,
      draft.id,
    );
    const ownerLatest = await getAgentForUser(db, ownerScope, created.agent.id);
    const ownerShared = await getAgentForUser(
      db,
      ownerScope,
      created.agent.id,
      created.version.id,
    );

    expect(memberLoad?.version.id).toBe(created.version.id);
    expect(memberLoad?.definition.systemPrompt).toBe("Shared version");
    expect(ownerLatest?.version.id).toBe(draft.id);
    expect(ownerLatest?.agent).toMatchObject({
      name: "Shared helper",
      description: "Version two",
      latestVersionId: draft.id,
    });
    expect(ownerShared?.version.id).toBe(created.version.id);
  });

  it("soft deletes only owned agents and hides them from reads and lists", async () => {
    const db = getDb({ DB: env.DB } as Env);
    const created = await createAgent(db, ownerScope, {
      name: "Disposable",
      description: "Delete me",
      definition: definition("Temporary"),
    });

    await expect(deleteAgent(db, memberScope, created.agent.id)).resolves.toBe(false);
    await expect(deleteAgent(db, ownerScope, created.agent.id)).resolves.toBe(true);
    await expect(deleteAgent(db, ownerScope, created.agent.id)).resolves.toBe(false);
    await expect(getAgentForUser(db, ownerScope, created.agent.id)).resolves.toBeNull();
    await expect(listAgents(db, ownerScope)).resolves.toEqual({ mine: [], shared: [] });
  });

  it("returns null and logs when a stored definition is invalid", async () => {
    const db = getDb({ DB: env.DB } as Env);
    const created = await createAgent(db, ownerScope, {
      name: "Historical",
      description: "Has a bad row",
      definition: definition("Valid"),
    });
    const badVersionId = "agentv_invalid-history";
    await env.DB.prepare(
      "INSERT INTO agent_versions (id, agent_id, definition, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(
      badVersionId,
      created.agent.id,
      JSON.stringify({ version: 2 }),
      ownerScope.userId,
      1_784_880_001,
    ).run();
    await env.DB.prepare("UPDATE agents SET latest_version_id = ? WHERE id = ?")
      .bind(badVersionId, created.agent.id)
      .run();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(getAgentForUser(db, ownerScope, created.agent.id)).resolves.toBeNull();
    expect(error).toHaveBeenCalledOnce();

    error.mockRestore();
  });
});
