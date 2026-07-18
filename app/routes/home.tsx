import { redirect } from "react-router";
import type { Route } from "./+types/home";
import { requireUser } from "~/lib/auth.server";
import { clubPath } from "~/lib/club-path";
import { listUserClubs } from "~/lib/clubs.server";
import { cloudflareContext } from "~/lib/context";

/** Sends a signed-in user to a club they can still access. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const memberships = await listUserClubs(env, user.id);
  const accessible = memberships.filter((entry) => entry.club.status === "active");
  const current = accessible.find((entry) => entry.club.id === user.lastClubId);
  const fallback = accessible[0];
  const club = current?.club ?? fallback?.club;

  // The club list/settings destination is added in Task 8. Do not reveal
  // whether an arbitrary club exists while that global outcome is pending.
  if (!club) throw new Response("Not found", { status: 404 });
  throw redirect(clubPath(club.slug));
}
