import type { Route } from "./+types/api.feedback";
import { cloudflareContext } from "~/lib/context";
import { requireUser } from "~/lib/auth.server";
import { requireClubContext } from "~/lib/clubs.server";
import { submitFeedback } from "~/lib/feedback.server";

/** POST a feedback note to the admin. Works from any page. */
export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const club = await requireClubContext(env, request, "wotf");
  const form = await request.formData();
  const saved = await submitFeedback(env, { clubId: club.club.id, userId: user.id }, {
    page: form.get("page") ? String(form.get("page")) : null,
    body: String(form.get("body") ?? ""),
  });
  return { ok: !!saved };
}
