import type { Route } from "./+types/api.feedback";
import { cloudflareContext } from "~/lib/context";
import { requireUser } from "~/lib/auth.server";
import { requireClubContext } from "~/lib/clubs.server";
import type { ClubContext } from "~/lib/clubs.server";
import type { User } from "~/db/schema";
import { apiAuthorizationError } from "~/lib/api-errors";
import { submitFeedback } from "~/lib/feedback.server";

/** POST a feedback note to the admin. Works from any page. */
export async function action({ request, context, params }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  let user: User;
  let club: ClubContext;
  try {
    user = await requireUser(env, request);
    club = await requireClubContext(env, request, params.clubSlug ?? "");
  } catch (error) {
    return apiAuthorizationError(error);
  }
  const form = await request.formData();
  const saved = await submitFeedback(env, { clubId: club.club.id, userId: user.id }, {
    page: form.get("page") ? String(form.get("page")) : null,
    body: String(form.get("body") ?? ""),
  });
  return { ok: !!saved };
}
