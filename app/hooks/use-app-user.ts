import { useRouteLoaderData } from "react-router";
import type { AppUser } from "~/routes/app-layout";

/** The signed-in user, available anywhere under the app layout. */
export function useAppUser(): AppUser | undefined {
  const data = useRouteLoaderData("routes/app-layout") as
    | { user: AppUser }
    | undefined;
  return data?.user;
}
