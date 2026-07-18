import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Club, ClubMembership, User } from "../../app/db/schema";
import { createSessionCookie } from "../../app/lib/auth.server";
import type { ClubContext } from "../../app/lib/clubs.server";

vi.mock("../../app/lib/modules", () => ({
  isModuleName: () => true,
}));
import { getDb } from "../../app/lib/db.server";
import {
  deleteComment,
  listComments,
} from "../../app/lib/comments.server";
import {
  listFeedback,
  setFeedbackStatus,
} from "../../app/lib/feedback.server";
import {
  createProject,
  deleteProject,
  getProject,
  updateProject,
  type ClubUserScope,
} from "../../app/lib/projects.server";
import {
  appendToLastAssistantMessage,
  getAdminThread,
  getThread,
  newThread,
  saveMessage,
  tagThreadWithProject,
  touchThread,
} from "../../app/lib/threads.server";
import { action as completeOnboarding } from "../../app/routes/welcome";

const testEnv = { DB: env.DB, SESSION_SECRET: "tenant-boundary-test" } as Env;

const now = 1_721_372_800_000;
const member: User = {
  id: "tenant-member",
  email: "tenant-member@example.com",
  name: "Tenant member",
  role: "user",
  stage: "exploring",
  modelPref: null,
  platformRole: "user",
  themePref: null,
  lastClubId: null,
  createdAt: now,
};

const moderator: User = {
  ...member,
  id: "tenant-moderator",
  email: "tenant-moderator@example.com",
  name: "Tenant moderator",
};

function club(id: string, slug: string): Club {
  return {
    id,
    name: slug,
    slug,
    modelPolicy: "all_models",
    status: "active",
    spendingLimitUsd: null,
    spendingLimitReset: null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}

function membership(clubId: string, userId: string, role: "admin" | "member"): ClubMembership {
  return {
    clubId,
    userId,
    role,
    onboardingStage: "exploring",
    modelPref: null,
    joinedAt: now,
    updatedAt: now,
  };
}

function clubContext(club: Club, member: ClubMembership): ClubContext {
  return {
    club,
    membership: member,
    effectiveRole: member.role,
    isSuperAdmin: false,
  };
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE user_id LIKE 'tenant-%'"),
    env.DB.prepare("DELETE FROM chat_messages WHERE id LIKE 'tenant-%'"),
    env.DB.prepare("DELETE FROM site_feedback WHERE id LIKE 'tenant-%'"),
    env.DB.prepare("DELETE FROM comments WHERE id LIKE 'tenant-%'"),
    env.DB.prepare("DELETE FROM projects WHERE user_id LIKE 'tenant-%'"),
    env.DB.prepare("DELETE FROM chat_threads WHERE user_id LIKE 'tenant-%'"),
    env.DB.prepare("DELETE FROM questionnaire_responses WHERE user_id LIKE 'tenant-%'"),
    env.DB.prepare("DELETE FROM club_memberships WHERE user_id LIKE 'tenant-%'"),
    env.DB.prepare("DELETE FROM clubs WHERE id LIKE 'tenant-%'"),
    env.DB.prepare("DELETE FROM users WHERE id LIKE 'tenant-%'"),
  ]);
});

async function insertFixture() {
  const firstClub = club("tenant-club-a", "tenant-club-a");
  const secondClub = club("tenant-club-b", "tenant-club-b");
  const firstScope: ClubUserScope = { clubId: firstClub.id, userId: member.id };
  const secondScope: ClubUserScope = { clubId: secondClub.id, userId: member.id };
  const firstModerator = membership(firstClub.id, moderator.id, "admin");

  await env.DB.batch([
    env.DB
      .prepare(
        "INSERT INTO users (id, email, name, role, stage, platform_role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(member.id, member.email, member.name, member.role, member.stage, member.platformRole, now),
    env.DB
      .prepare(
        "INSERT INTO users (id, email, name, role, stage, platform_role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(moderator.id, moderator.email, moderator.name, moderator.role, moderator.stage, moderator.platformRole, now),
    ...[firstClub, secondClub].map((value) =>
      env.DB
        .prepare(
          "INSERT INTO clubs (id, name, slug, model_policy, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(value.id, value.name, value.slug, value.modelPolicy, value.status, now, now),
    ),
    ...[
      membership(firstClub.id, member.id, "member"),
      membership(secondClub.id, member.id, "member"),
      firstModerator,
      membership(secondClub.id, moderator.id, "admin"),
    ].map((value) =>
      env.DB
        .prepare(
          "INSERT INTO club_memberships (club_id, user_id, role, onboarding_stage, joined_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(value.clubId, value.userId, value.role, value.onboardingStage, now, now),
    ),
    env.DB
      .prepare(
        "INSERT INTO projects (id, user_id, club_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind("tenant-project-a", member.id, firstClub.id, "First project", "seed", now, now),
    env.DB
      .prepare(
        "INSERT INTO projects (id, user_id, club_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind("tenant-project-b", member.id, secondClub.id, "Second project", "seed", now, now),
    env.DB
      .prepare(
        "INSERT INTO chat_threads (id, user_id, club_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind("tenant-thread-a", member.id, firstClub.id, "First thread", now, now),
    env.DB
      .prepare(
        "INSERT INTO chat_threads (id, user_id, club_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind("tenant-thread-b", member.id, secondClub.id, "Second thread", now, now),
    env.DB
      .prepare(
        "INSERT INTO chat_messages (id, thread_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind("tenant-message-a", "tenant-thread-a", "assistant", "First answer", now),
    env.DB
      .prepare(
        "INSERT INTO chat_messages (id, thread_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind("tenant-message-b", "tenant-thread-b", "assistant", "Second answer", now),
    env.DB
      .prepare(
        "INSERT INTO questionnaire_responses (club_id, user_id, answers, created_at) VALUES (?, ?, ?, ?)",
      )
      .bind(firstClub.id, member.id, '{"club":"first"}', now),
    env.DB
      .prepare(
        "INSERT INTO questionnaire_responses (club_id, user_id, answers, created_at) VALUES (?, ?, ?, ?)",
      )
      .bind(secondClub.id, member.id, '{"club":"second"}', now),
    env.DB
      .prepare(
        "INSERT INTO comments (id, target_type, target_id, user_id, club_id, body, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind("tenant-comment-a", "article", "shared-target", member.id, firstClub.id, "First comment", "visible", now, now),
    env.DB
      .prepare(
        "INSERT INTO comments (id, target_type, target_id, user_id, club_id, body, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind("tenant-comment-b", "article", "shared-target", member.id, secondClub.id, "Second comment", "visible", now, now),
    env.DB
      .prepare(
        "INSERT INTO site_feedback (id, user_id, club_id, body, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind("tenant-feedback-a", member.id, firstClub.id, "First feedback", "new", now),
    env.DB
      .prepare(
        "INSERT INTO site_feedback (id, user_id, club_id, body, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind("tenant-feedback-b", member.id, secondClub.id, "Second feedback", "new", now),
  ]);

  return {
    firstClub,
    secondClub,
    firstScope,
    secondScope,
    firstModerator: clubContext(firstClub, firstModerator),
  };
}

describe("tenant-explicit data services", () => {
  it("does not read or mutate another club's data for the same participant", async () => {
    const fixture = await insertFixture();
    const db = getDb(testEnv);

    await expect(getProject(testEnv, fixture.firstScope, "tenant-project-b")).resolves.toBeNull();
    await updateProject(testEnv, fixture.firstScope, "tenant-project-b", { title: "Leaked project" });
    await deleteProject(testEnv, fixture.firstScope, "tenant-project-b");
    expect(await getProject(testEnv, fixture.secondScope, "tenant-project-b")).toMatchObject({ title: "Second project" });

    await expect(getThread(testEnv, fixture.firstScope, "tenant-thread-b")).resolves.toBeNull();
    await touchThread(testEnv, fixture.firstScope, "tenant-thread-b");
    await expect(
      tagThreadWithProject(testEnv, fixture.firstScope, "tenant-thread-a", "tenant-project-b"),
    ).resolves.toBe(false);
    await expect(
      tagThreadWithProject(testEnv, fixture.firstScope, "tenant-thread-b", "tenant-project-a"),
    ).resolves.toBe(false);
    const foreignThread = (await getThread(testEnv, fixture.secondScope, "tenant-thread-b"))!;
    await saveMessage(db, fixture.firstScope, foreignThread.thread, "user", "Leaked message");
    await appendToLastAssistantMessage(db, fixture.firstScope, foreignThread.thread, " leaked");
    expect(await getThread(testEnv, fixture.secondScope, "tenant-thread-b")).toMatchObject({
      thread: { projectId: null },
      messages: [{ content: "Second answer" }],
    });
    expect(await getThread(testEnv, fixture.firstScope, "tenant-thread-a")).toMatchObject({
      thread: { projectId: null },
    });
    await expect(newThread(testEnv, fixture.firstScope, "tenant-project-b")).resolves.toMatchObject({
      clubId: fixture.firstClub.id,
      projectId: null,
    });
    await expect(
      createProject(testEnv, fixture.firstScope, {
        title: "Scoped project",
        threadId: "tenant-thread-b",
      }),
    ).resolves.toMatchObject({ clubId: fixture.firstClub.id, threadId: null });

    await env.DB
      .prepare("UPDATE questionnaire_responses SET answers = ? WHERE club_id = ? AND user_id = ?")
      .bind('{"club":"leaked"}', fixture.firstClub.id, member.id)
      .run();
    expect(
      await env.DB
        .prepare("SELECT answers FROM questionnaire_responses WHERE club_id = ? AND user_id = ?")
        .bind(fixture.secondClub.id, member.id)
        .first(),
    ).toEqual({ answers: '{"club":"second"}' });

    expect(await listComments(testEnv, fixture.firstClub.id, "article", "shared-target", member.id)).toEqual([
      expect.objectContaining({ id: "tenant-comment-a" }),
    ]);
    await deleteComment(testEnv, { user: moderator, club: fixture.firstModerator }, "tenant-comment-b");
    expect(
      await env.DB.prepare("SELECT id FROM comments WHERE id = ?").bind("tenant-comment-b").first(),
    ).toEqual({ id: "tenant-comment-b" });

    expect(await listFeedback(testEnv, fixture.firstClub.id)).toEqual([
      expect.objectContaining({ id: "tenant-feedback-a" }),
    ]);
    await setFeedbackStatus(testEnv, fixture.firstClub.id, "tenant-feedback-b", "resolved");
    expect(
      await env.DB.prepare("SELECT status FROM site_feedback WHERE id = ?").bind("tenant-feedback-b").first(),
    ).toEqual({ status: "new" });

    await expect(getAdminThread(testEnv, fixture.firstClub.id, "tenant-thread-b")).resolves.toBeNull();
  });

  it("stores questionnaire answers and onboarding state on only the current membership", async () => {
    const fixture = await insertFixture();
    await env.DB
      .prepare(
        "UPDATE club_memberships SET onboarding_stage = 'invited' WHERE user_id = ?",
      )
      .bind(member.id)
      .run();
    const request = new Request(
      `https://vibegarden.test/clubs/${fixture.firstClub.slug}/welcome`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: (await createSessionCookie(
            testEnv,
            new Request("https://vibegarden.test"),
            member.id,
          )).split(";", 1)[0],
        },
        body: new URLSearchParams({
          subscription: "chatgpt",
          budget: "",
          devices: "laptop",
          expectations: "A club-scoped answer",
        }),
      },
    );

    const response = await completeOnboarding({
      request,
      context: { get: () => ({ env: testEnv, ctx: {} }) },
      params: { clubSlug: fixture.firstClub.slug },
    } as never);

    expect(response.headers.get("Location")).toBe(`/clubs/${fixture.firstClub.slug}`);
    expect(
      await env.DB
        .prepare("SELECT answers FROM questionnaire_responses WHERE club_id = ? AND user_id = ?")
        .bind(fixture.firstClub.id, member.id)
        .first(),
    ).toMatchObject({ answers: expect.stringContaining("A club-scoped answer") });
    expect(
      await env.DB
        .prepare("SELECT onboarding_stage FROM club_memberships WHERE club_id = ? AND user_id = ?")
        .bind(fixture.firstClub.id, member.id)
        .first(),
    ).toEqual({ onboarding_stage: "exploring" });
    expect(
      await env.DB
        .prepare("SELECT answers FROM questionnaire_responses WHERE club_id = ? AND user_id = ?")
        .bind(fixture.secondClub.id, member.id)
        .first(),
    ).toEqual({ answers: '{"club":"second"}' });
    expect(
      await env.DB
        .prepare("SELECT onboarding_stage FROM club_memberships WHERE club_id = ? AND user_id = ?")
        .bind(fixture.secondClub.id, member.id)
        .first(),
    ).toEqual({ onboarding_stage: "invited" });
  });

  it("does not reopen onboarding after the membership has progressed", async () => {
    const fixture = await insertFixture();
    const request = new Request(
      `https://vibegarden.test/clubs/${fixture.firstClub.slug}/welcome`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: (await createSessionCookie(
            testEnv,
            new Request("https://vibegarden.test"),
            member.id,
          )).split(";", 1)[0],
        },
        body: new URLSearchParams({
          subscription: "chatgpt",
          budget: "",
          devices: "laptop",
          expectations: "This must not overwrite the answer",
        }),
      },
    );

    await expect(
      completeOnboarding({
        request,
        context: { get: () => ({ env: testEnv, ctx: {} }) },
        params: { clubSlug: fixture.firstClub.slug },
      } as never),
    ).rejects.toMatchObject({ status: 302 });
    expect(
      await env.DB
        .prepare("SELECT answers FROM questionnaire_responses WHERE club_id = ? AND user_id = ?")
        .bind(fixture.firstClub.id, member.id)
        .first(),
    ).toEqual({ answers: '{"club":"first"}' });
  });
});
