import { useRouteLoaderData } from "react-router";
import type { AppClub } from "~/routes/app-layout";
import type { ClubRole } from "~/db/schema";

export type ClubContextView = {
  club: AppClub;
  explicitRole: ClubRole | null;
  effectiveRole: ClubRole;
  clubs: { name: string; slug: string; role: ClubRole }[];
  allowedModels: string[];
};

/** The current club and its club-scoped shell data. */
export function useClub(): ClubContextView | undefined {
  const data = useRouteLoaderData("routes/app-layout") as
    | ClubContextView
    | undefined;
  return data;
}
