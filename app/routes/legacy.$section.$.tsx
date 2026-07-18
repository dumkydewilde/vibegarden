import type { Route } from "./+types/legacy.$section.$";
import { LegacyClubRedirect } from "~/components/legacy-club-redirect";
import { legacyClubPath } from "~/lib/club-path";

export async function loader({ request, params }: Route.LoaderArgs) {
  const destination = legacyClubPath(
    request.url,
    params.section ?? "",
    params["*"] ?? "",
  );
  if (!destination) throw new Response("Not found", { status: 404 });
  return { destination };
}

export default function LegacySectionPath({ loaderData }: Route.ComponentProps) {
  return <LegacyClubRedirect destination={loaderData.destination} />;
}
