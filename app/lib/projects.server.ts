import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./db.server";
import { isModuleName } from "./modules";
import { chatThreads, projects, type Project } from "~/db/schema";

export type ClubUserScope = { clubId: string; userId: string };

export function parseModules(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isModuleName) : [];
  } catch {
    return [];
  }
}

export async function listProjects(env: Env, scope: ClubUserScope) {
  const rows = await getDb(env)
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.clubId, scope.clubId),
        eq(projects.userId, scope.userId),
      ),
    )
    .orderBy(desc(projects.updatedAt));
  return rows.map((p) => ({ ...p, moduleList: parseModules(p.modules) }));
}

export async function getProject(env: Env, scope: ClubUserScope, id: string) {
  const rows = await getDb(env)
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.id, id),
        eq(projects.clubId, scope.clubId),
        eq(projects.userId, scope.userId),
      ),
    )
    .limit(1);
  const project = rows[0];
  return project
    ? { ...project, moduleList: parseModules(project.modules) }
    : null;
}

export async function createProject(
  env: Env,
  scope: ClubUserScope,
  input: {
    title: string;
    oneLiner?: string;
    modules?: string[];
    threadId?: string;
  },
): Promise<Project> {
  const now = Date.now();
  const db = getDb(env);
  const threadId = input.threadId
    ? (
        await db
          .select({ id: chatThreads.id })
          .from(chatThreads)
          .where(
            and(
              eq(chatThreads.id, input.threadId),
              eq(chatThreads.clubId, scope.clubId),
              eq(chatThreads.userId, scope.userId),
            ),
          )
          .limit(1)
      )[0]?.id ?? null
    : null;
  const project: Project = {
    id: crypto.randomUUID(),
    userId: scope.userId,
    clubId: scope.clubId,
    title: input.title.trim().slice(0, 120) || "Untitled idea",
    oneLiner: input.oneLiner?.trim().slice(0, 300) || null,
    modules: JSON.stringify((input.modules ?? []).filter(isModuleName)),
    status: "seed",
    threadId,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(projects).values(project);
  return project;
}

export async function updateProject(
  env: Env,
  scope: ClubUserScope,
  id: string,
  input: {
    title?: string;
    oneLiner?: string;
    modules?: string[];
    status?: string;
  },
) {
  const status = ["seed", "growing", "bloomed"].includes(input.status ?? "")
    ? (input.status as Project["status"])
    : undefined;
  await getDb(env)
    .update(projects)
    .set({
      ...(input.title !== undefined
        ? { title: input.title.trim().slice(0, 120) || "Untitled idea" }
        : {}),
      ...(input.oneLiner !== undefined
        ? { oneLiner: input.oneLiner.trim().slice(0, 300) || null }
        : {}),
      ...(input.modules !== undefined
        ? { modules: JSON.stringify(input.modules.filter(isModuleName)) }
        : {}),
      ...(status ? { status } : {}),
      updatedAt: Date.now(),
    })
    .where(
      and(
        eq(projects.id, id),
        eq(projects.clubId, scope.clubId),
        eq(projects.userId, scope.userId),
      ),
    );
}

export async function deleteProject(env: Env, scope: ClubUserScope, id: string) {
  await getDb(env)
    .delete(projects)
    .where(
      and(
        eq(projects.id, id),
        eq(projects.clubId, scope.clubId),
        eq(projects.userId, scope.userId),
      ),
    );
}
