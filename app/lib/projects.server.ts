import { and, desc, eq, like, lt, or, sql } from "drizzle-orm";
import { getDb } from "./db.server";
import { isModuleName } from "./modules";
import { PROJECT_LIMITS } from "./project-limits";
import { chatThreads, projects, type Project } from "~/db/schema";

export type ClubUserScope = { clubId: string; userId: string };

export class ProjectDeleteConflictError extends Error {
  readonly code = "artifact_conflict";
  readonly status = 409;

  constructor() {
    super("Projects with retained artifacts cannot be removed.");
    this.name = "ProjectDeleteConflictError";
    Object.setPrototypeOf(this, ProjectDeleteConflictError.prototype);
  }
}

export function parseModules(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isModuleName) : [];
  } catch {
    return [];
  }
}

export type DescPosition = { updatedAt: number; id: string };
export type ProjectPageInput = {
  status?: "seed" | "growing" | "bloomed";
  position?: DescPosition;
  limit: number;
};

function ownedLike(column: typeof projects.title, term: string) {
  return sql`${like(sql`lower(${column})`, term)} escape '\\'`;
}

function escapedLikeTerm(query: string) {
  return `%${query.trim().toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
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

export async function listProjectsPage(
  env: Env,
  scope: ClubUserScope,
  input: ProjectPageInput,
) {
  const filters = [
    eq(projects.clubId, scope.clubId),
    eq(projects.userId, scope.userId),
  ];
  if (input.status) filters.push(eq(projects.status, input.status));
  if (input.position) {
    filters.push(
      or(
        lt(projects.updatedAt, input.position.updatedAt),
        and(
          eq(projects.updatedAt, input.position.updatedAt),
          lt(projects.id, input.position.id),
        ),
      )!,
    );
  }
  const rows = await getDb(env)
    .select()
    .from(projects)
    .where(and(...filters))
    .orderBy(desc(projects.updatedAt), desc(projects.id))
    .limit(input.limit + 1);
  const hasMore = rows.length > input.limit;
  const items = rows.slice(0, input.limit).map((project) => ({
    ...project,
    moduleList: parseModules(project.modules),
  }));
  const last = items.at(-1);
  return {
    items,
    nextPosition:
      hasMore && last
        ? { updatedAt: last.updatedAt, id: last.id }
        : undefined,
  };
}

export async function searchOwnedProjects(
  env: Env,
  scope: ClubUserScope,
  query: string,
  limit: number,
) {
  const term = escapedLikeTerm(query);
  return getDb(env)
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.clubId, scope.clubId),
        eq(projects.userId, scope.userId),
        or(
          ownedLike(projects.title, term),
          ownedLike(projects.oneLiner, term),
          ownedLike(projects.notes, term),
        ),
      ),
    )
    .orderBy(desc(projects.updatedAt), desc(projects.id))
    .limit(Math.min(Math.max(Math.trunc(limit), 0), 20));
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

export type OwnedProject = Project & { moduleList: string[] };

function withModuleList(project: Project): OwnedProject {
  return { ...project, moduleList: parseModules(project.modules) };
}

async function projectByIdempotencyKey(
  env: Env,
  scope: ClubUserScope,
  key: string,
) {
  const rows = await getDb(env)
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.clubId, scope.clubId),
        eq(projects.userId, scope.userId),
        eq(projects.mcpIdempotencyKey, key),
      ),
    )
    .limit(1);
  return rows[0] ? withModuleList(rows[0]) : null;
}

export async function createProject(
  env: Env,
  scope: ClubUserScope,
  input: {
    title: string;
    oneLiner?: string;
    notes?: string;
    modules?: string[];
    threadId?: string;
    /** Set by MCP only: replays the first create instead of duplicating it. */
    idempotencyKey?: string;
  },
): Promise<OwnedProject> {
  const now = Date.now();
  const db = getDb(env);
  if (input.idempotencyKey) {
    const replay = await projectByIdempotencyKey(env, scope, input.idempotencyKey);
    if (replay) return replay;
  }
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
    title: input.title.trim().slice(0, PROJECT_LIMITS.titleChars) || "Untitled idea",
    oneLiner: input.oneLiner?.trim().slice(0, PROJECT_LIMITS.oneLinerChars) || null,
    notes: input.notes?.trim().slice(0, PROJECT_LIMITS.notesChars) || null,
    modules: JSON.stringify((input.modules ?? []).filter(isModuleName)),
    status: "seed",
    threadId,
    mcpIdempotencyKey: input.idempotencyKey ?? null,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await db.insert(projects).values(project);
  } catch (error) {
    // A concurrent identical create won the unique index: replay its project.
    const replay = input.idempotencyKey
      ? await projectByIdempotencyKey(env, scope, input.idempotencyKey)
      : null;
    if (!replay) throw error;
    return replay;
  }
  return withModuleList(project);
}

export async function updateProject(
  env: Env,
  scope: ClubUserScope,
  id: string,
  input: {
    title?: string;
    oneLiner?: string;
    notes?: string;
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
        ? {
            title: input.title.trim().slice(0, PROJECT_LIMITS.titleChars)
              || "Untitled idea",
          }
        : {}),
      ...(input.oneLiner !== undefined
        ? { oneLiner: input.oneLiner.trim().slice(0, PROJECT_LIMITS.oneLinerChars) || null }
        : {}),
      ...(input.notes !== undefined
        ? { notes: input.notes.trim().slice(0, PROJECT_LIMITS.notesChars) || null }
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
  const deleted = await env.DB.prepare(
    `DELETE FROM projects
     WHERE id = ? AND club_id = ? AND user_id = ?
       AND NOT EXISTS (SELECT 1 FROM artifacts WHERE project_id = projects.id)
       AND NOT EXISTS (SELECT 1 FROM artifact_uploads WHERE project_id = projects.id)`,
  ).bind(id, scope.clubId, scope.userId).run();
  if (deleted.meta.changes === 1) return;
  const project = await env.DB.prepare(
    "SELECT id FROM projects WHERE id = ? AND club_id = ? AND user_id = ? LIMIT 1",
  ).bind(id, scope.clubId, scope.userId).first();
  if (project) throw new ProjectDeleteConflictError();
}
