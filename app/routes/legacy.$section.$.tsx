import { redirect } from "react-router";
import type { Route } from "./+types/legacy.$section.$";
import { legacyClubPath } from "~/lib/club-path";

export async function loader({ request, params }: Route.LoaderArgs) {
  const destination = legacyClubPath(
    request.url,
    params.section ?? "",
    params["*"] ?? "",
  );
  if (!destination) throw new Response("Not found", { status: 404 });
  throw redirect(destination);
}
