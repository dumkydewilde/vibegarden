import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./db.server";
import { isModuleName } from "./modules";
import { projects, type Project } from "~/db/schema";

export function parseModules(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isModuleName) : [];
  } catch {
    return [];
  }
}

export async function listProjects(env: Env, userId: string) {
  const rows = await getDb(env)
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.updatedAt));
  return rows.map((p) => ({ ...p, moduleList: parseModules(p.modules) }));
}

export async function getProject(env: Env, userId: string, id: string) {
  const rows = await getDb(env)
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)))
    .limit(1);
  const project = rows[0];
  return project
    ? { ...project, moduleList: parseModules(project.modules) }
    : null;
}

export async function createProject(
  env: Env,
  userId: string,
  input: {
    title: string;
    oneLiner?: string;
    modules?: string[];
    threadId?: string;
  },
): Promise<Project> {
  const now = Date.now();
  const project: Project = {
    id: crypto.randomUUID(),
    userId,
    title: input.title.trim().slice(0, 120) || "Untitled idea",
    oneLiner: input.oneLiner?.trim().slice(0, 300) || null,
    modules: JSON.stringify((input.modules ?? []).filter(isModuleName)),
    status: "seed",
    threadId: input.threadId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await getDb(env).insert(projects).values(project);
  return project;
}

export async function updateProject(
  env: Env,
  userId: string,
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
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));
}

export async function deleteProject(env: Env, userId: string, id: string) {
  await getDb(env)
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));
}

