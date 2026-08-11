import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "~/lib/db.server";
import { emptyDefinition, type AgentDefinition } from "../contracts";
import {
  createAgent,
  deleteAgent,
  getAgentForUser,
  listAgents,
  remixAgent,
  saveAgentVersion,
  setAgentSharing,
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

  it("pins the latest version on share and moves the pin only on re-share", async () => {
    const db = getDb({ DB: env.DB } as Env);
    const created = await createAgent(db, ownerScope, {
      name: "Pinned helper",
      description: "Version one",
      definition: definition("Shared version one"),
    });

    const firstShare = await setAgentSharing(
      db,
      ownerScope,
      created.agent.id,
      true,
    );
    const draft = await saveAgentVersion(db, ownerScope, created.agent.id, {
      name: "Pinned helper",
      description: "Version two",
      definition: definition("Private version two"),
    });
    const afterDraft = await getAgentForUser(db, memberScope, created.agent.id);
    const secondShare = await setAgentSharing(
      db,
      ownerScope,
      created.agent.id,
      true,
    );
    const afterReshare = await getAgentForUser(
      db,
      memberScope,
      created.agent.id,
    );

    expect(firstShare).toMatchObject({
      visibility: "club",
      latestVersionId: created.version.id,
      sharedVersionId: created.version.id,
    });
    expect(afterDraft?.version.id).toBe(created.version.id);
    expect(afterDraft?.definition.systemPrompt).toBe("Shared version one");
    expect(secondShare).toMatchObject({
      visibility: "club",
      latestVersionId: draft.id,
      sharedVersionId: draft.id,
    });
    expect(afterReshare?.version.id).toBe(draft.id);
    expect(afterReshare?.definition.systemPrompt).toBe("Private version two");
  });

  it("allows only an owner with a saved version to change sharing", async () => {
    const db = getDb({ DB: env.DB } as Env);
    const created = await createAgent(db, ownerScope, {
      name: "Owner helper",
      description: "Owner controlled",
      definition: definition("Owner version"),
    });
    const versionlessAgentId = "agent_without-version";
    await env.DB.prepare(
      `INSERT INTO agents (
        id, club_id, owner_id, name, description, visibility,
        latest_version_id, shared_version_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'private', NULL, NULL, ?, ?)`,
    ).bind(
      versionlessAgentId,
      ownerScope.clubId,
      ownerScope.userId,
      "Versionless",
      "No saved version",
      1_784_880_000,
      1_784_880_000,
    ).run();

    await expect(
      setAgentSharing(db, memberScope, created.agent.id, true),
    ).resolves.toBeNull();
    const shared = await setAgentSharing(
      db,
      ownerScope,
      created.agent.id,
      true,
    );
    await expect(
      setAgentSharing(db, memberScope, created.agent.id, false),
    ).resolves.toBeNull();
    await expect(
      setAgentSharing(db, ownerScope, versionlessAgentId, true),
    ).resolves.toBeNull();

    const stored = await env.DB.prepare(
      "SELECT visibility, shared_version_id FROM agents WHERE id = ?",
    ).bind(created.agent.id).first<{
      visibility: string;
      shared_version_id: string | null;
    }>();
    const versionlessStored = await env.DB.prepare(
      "SELECT visibility, shared_version_id FROM agents WHERE id = ?",
    ).bind(versionlessAgentId).first<{
      visibility: string;
      shared_version_id: string | null;
    }>();
    expect(shared).not.toBeNull();
    expect(stored).toEqual({
      visibility: "club",
      shared_version_id: created.version.id,
    });
    expect(versionlessStored).toEqual({
      visibility: "private",
      shared_version_id: null,
    });
  });

  it("unshares an agent and immediately hides it from other club members", async () => {
    const db = getDb({ DB: env.DB } as Env);
    const created = await createAgent(db, ownerScope, {
      name: "Temporary share",
      description: "Shared briefly",
      definition: definition("Club version"),
    });
    await setAgentSharing(db, ownerScope, created.agent.id, true);

    expect((await listAgents(db, memberScope)).shared).toHaveLength(1);
    await expect(
      getAgentForUser(db, memberScope, created.agent.id),
    ).resolves.not.toBeNull();

    const unshared = await setAgentSharing(
      db,
      ownerScope,
      created.agent.id,
      false,
    );

    expect(unshared).toMatchObject({
      visibility: "private",
      sharedVersionId: null,
    });
    expect((await listAgents(db, memberScope)).shared).toEqual([]);
    await expect(
      getAgentForUser(db, memberScope, created.agent.id),
    ).resolves.toBeNull();
  });

  it("does not remix a private agent for another club member", async () => {
    const db = getDb({ DB: env.DB } as Env);
    const created = await createAgent(db, ownerScope, {
      name: "Private source",
      description: "Owner only",
      definition: definition("Private instructions"),
    });

    await expect(
      remixAgent(db, memberScope, created.agent.id),
    ).resolves.toBeNull();
    await expect(listAgents(db, memberScope)).resolves.toEqual({
      mine: [],
      shared: [],
    });
  });

  it("remixes the pinned shared definition instead of the latest owner draft", async () => {
    const db = getDb({ DB: env.DB } as Env);
    const sharedDefinition: AgentDefinition = {
      ...definition("Pinned shared instructions"),
      tools: [
        {
          name: "shared_tool",
          description: "Returns the pinned value.",
          parameters: { type: "object", properties: {} },
          source: 'return "shared";',
        },
      ],
    };
    const created = await createAgent(db, ownerScope, {
      name: "Source agent",
      description: "The source description",
      definition: sharedDefinition,
    });
    await setAgentSharing(db, ownerScope, created.agent.id, true);
    await saveAgentVersion(db, ownerScope, created.agent.id, {
      name: "Renamed private draft",
      description: "Private draft description",
      definition: definition("Unshared draft instructions"),
    });

    const remixed = await remixAgent(db, memberScope, created.agent.id);
    const loaded = remixed
      ? await getAgentForUser(db, memberScope, remixed.id)
      : null;

    expect(remixed).toMatchObject({
      clubId: memberScope.clubId,
      ownerId: memberScope.userId,
      name: "Remix of Renamed private draft",
      description: "Private draft description",
      visibility: "private",
      sharedVersionId: null,
    });
    expect(loaded?.definition).toEqual(sharedDefinition);
    expect(loaded?.version.createdBy).toBe(memberScope.userId);
    expect(loaded?.agent.latestVersionId).toBe(loaded?.version.id);
  });

  it("does not remix a shared agent into another club", async () => {
    const db = getDb({ DB: env.DB } as Env);
    const created = await createAgent(db, ownerScope, {
      name: "Club source",
      description: "Same club only",
      definition: definition("Club instructions"),
    });
    await setAgentSharing(db, ownerScope, created.agent.id, true);

    await expect(
      remixAgent(db, otherClubScope, created.agent.id),
    ).resolves.toBeNull();
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
