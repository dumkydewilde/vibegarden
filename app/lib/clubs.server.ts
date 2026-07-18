import { and, eq } from "drizzle-orm";
import type { Club, ClubMembership, ClubRole } from "~/db/schema";
import { clubMemberships, clubs, clubSlugAliases } from "~/db/schema";
import { requireUser } from "~/lib/auth.server";
import { getDb } from "~/lib/db.server";

export type ClubContext = {
  club: Club;
  membership: ClubMembership | null;
  effectiveRole: ClubRole;
  isSuperAdmin: boolean;
};

function notFound() {
  return new Response("Not found", { status: 404 });
}

export async function requireClubContext(
  env: Env,
  request: Request,
  slug: string,
): Promise<ClubContext> {
  const user = await requireUser(env, request);
  const db = getDb(env);

  const [directClub] = await db
    .select()
    .from(clubs)
    .where(eq(clubs.slug, slug))
    .limit(1);

  const [aliasedClub] = directClub
    ? []
    : await db
        .select({ club: clubs })
        .from(clubSlugAliases)
        .innerJoin(clubs, eq(clubSlugAliases.clubId, clubs.id))
        .where(eq(clubSlugAliases.slug, slug))
        .limit(1);

  const club = directClub ?? aliasedClub?.club;
  if (!club || club.status === "archived") {
    throw notFound();
  }

  const [membership] = await db
    .select()
    .from(clubMemberships)
    .where(
      and(
        eq(clubMemberships.clubId, club.id),
        eq(clubMemberships.userId, user.id),
      ),
    )
    .limit(1);

  const isSuperAdmin = user.platformRole === "super_admin";
  if (!membership && !isSuperAdmin) {
    throw notFound();
  }

  if (aliasedClub) {
    const canonicalUrl = request.url.replace(
      `/clubs/${encodeURIComponent(slug)}`,
      `/clubs/${encodeURIComponent(club.slug)}`,
    );
    throw new Response(null, {
      status: 302,
      headers: { Location: canonicalUrl },
    });
  }

  return {
    club,
    membership: membership ?? null,
    effectiveRole: membership?.role ?? "admin",
    isSuperAdmin,
  };
}
