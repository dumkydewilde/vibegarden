import { useState } from "react";
import { Form, Link, redirect, useActionData, useLoaderData, useSearchParams } from "react-router";
import { useTheme } from "next-themes";
import type { Route } from "./+types/settings";
import type { ClubRole } from "~/db/schema";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { GlobalPageShell } from "~/components/shell/global-page-shell";
import { requireUser } from "~/lib/auth.server";
import { clubPath, normalizeClubSlug } from "~/lib/club-path";
import { createClub, listUserClubs } from "~/lib/clubs.server";
import { cloudflareContext } from "~/lib/context";
import { leaveClub } from "~/lib/memberships.server";

const themes = ["system", "light", "dark"] as const;
type Theme = (typeof themes)[number];

function titleCaseRole(role: ClubRole) {
  return role.slice(0, 1).toUpperCase() + role.slice(1);
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const clubs = await listUserClubs(env, user.id);
  return {
    user: { name: user.name, email: user.email, themePref: user.themePref ?? "system" },
    clubs,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "profile") {
    const name = String(formData.get("name") ?? "").trim() || null;
    await env.DB.prepare("UPDATE users SET name = ? WHERE id = ?")
      .bind(name, user.id)
      .run();
    return { ok: true, intent };
  }

  if (intent === "theme") {
    const theme = String(formData.get("theme") ?? "");
    if (!themes.includes(theme as Theme)) {
      return { error: "Choose a valid theme.", intent };
    }
    await env.DB.prepare("UPDATE users SET theme_pref = ? WHERE id = ?")
      .bind(theme, user.id)
      .run();
    return { ok: true, intent, theme };
  }

  if (intent === "create-club") {
    try {
      const club = await createClub(env, user, {
        name: String(formData.get("name") ?? "").trim(),
        slug: String(formData.get("slug") ?? ""),
      });
      return redirect(clubPath(club.slug));
    } catch (error) {
      if (error instanceof Response && error.status === 400) {
        return { error: "Choose a valid club URL.", intent };
      }
      return {
        error: "The club could not be created. Your other clubs were not changed.",
        intent,
      };
    }
  }

  if (intent === "leave-club") {
    const clubId = String(formData.get("clubId") ?? "");
    const memberships = await listUserClubs(env, user.id);
    const match = memberships.find((entry) => entry.club.id === clubId);
    if (!match) throw new Response("Not found", { status: 404 });
    await leaveClub(env, {
      club: match.club,
      membership: match.membership,
      effectiveRole: match.membership.role,
      isSuperAdmin: user.platformRole === "super_admin",
    });
    await env.DB.prepare("UPDATE users SET last_club_id = NULL WHERE id = ? AND last_club_id = ?")
      .bind(user.id, clubId)
      .run();
    return { ok: true, intent, clubId };
  }

  throw new Response("Invalid settings action", { status: 400 });
}

export default function Settings() {
  const { user, clubs } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(searchParams.get("create") === "1");
  const [clubName, setClubName] = useState("");
  const [clubSlug, setClubSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const { setTheme } = useTheme();

  return (
    <GlobalPageShell>
      <div className="space-y-10">
        <div>
          <h1 className="font-serif text-3xl">Settings</h1>
          <p className="mt-2 text-muted-foreground">Manage your profile, appearance, and clubs.</p>
        </div>

        <section aria-labelledby="profile-heading" className="space-y-4 rounded-lg border p-5">
          <h2 id="profile-heading" className="text-xl font-semibold">Profile</h2>
          <Form method="post" className="flex max-w-md flex-col gap-3">
            <input type="hidden" name="intent" value="profile" />
            <label className="space-y-1" htmlFor="display-name">
              <span className="text-sm font-medium">Display name</span>
              <Input id="display-name" name="name" defaultValue={user.name ?? ""} />
            </label>
            <p className="text-sm text-muted-foreground">{user.email}</p>
            <Button className="w-fit" type="submit">Save profile</Button>
          </Form>
        </section>

        <section aria-labelledby="appearance-heading" className="space-y-4 rounded-lg border p-5">
          <h2 id="appearance-heading" className="text-xl font-semibold">Appearance</h2>
          <Form method="post" className="flex flex-wrap gap-4">
            <input type="hidden" name="intent" value="theme" />
            {themes.map((theme) => (
              <label key={theme} className="flex items-center gap-2 text-sm capitalize">
                <input
                  type="radio"
                  name="theme"
                  value={theme}
                  defaultChecked={user.themePref === theme}
                  onChange={() => setTheme(theme)}
                />
                {theme}
              </label>
            ))}
            <Button type="submit" variant="outline">Save appearance</Button>
          </Form>
        </section>

        <section aria-labelledby="clubs-heading" className="space-y-4 rounded-lg border p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 id="clubs-heading" className="text-xl font-semibold">Your clubs</h2>
              <p className="text-sm text-muted-foreground">Club settings are managed from each club.</p>
            </div>
            <Button type="button" onClick={() => setCreateOpen((open) => !open)}>
              Create club
            </Button>
          </div>

          {createOpen && (
            <Form method="post" className="grid max-w-xl gap-3 border-t pt-4 sm:grid-cols-2">
              <input type="hidden" name="intent" value="create-club" />
              <label className="space-y-1">
                <span className="text-sm font-medium">Club name</span>
                <Input
                  name="name"
                  value={clubName}
                  onChange={(event) => {
                    const name = event.target.value;
                    setClubName(name);
                    if (!slugEdited) setClubSlug(normalizeClubSlug(name));
                  }}
                  required
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium">Club URL</span>
                <Input
                  name="slug"
                  value={clubSlug}
                  onChange={(event) => {
                    setSlugEdited(true);
                    setClubSlug(normalizeClubSlug(event.target.value));
                  }}
                  required
                />
              </label>
              <Button className="w-fit" type="submit">Create club</Button>
            </Form>
          )}

          {actionData?.intent === "create-club" && actionData.error && (
            <p role="alert" className="text-sm text-destructive">{actionData.error}</p>
          )}

          <ul className="divide-y rounded-md border">
            {clubs.map(({ club, membership }) => (
              <li key={club.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  {club.status === "active" ? (
                    <Link to={clubPath(club.slug)} className="font-medium underline-offset-4 hover:underline">{club.name}</Link>
                  ) : (
                    <span className="font-medium">{club.name}</span>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {titleCaseRole(membership.role)}{club.status === "archived" ? " · Archived" : ""}
                  </p>
                </div>
                {club.status === "active" && membership.role === "owner" ? (
                  <p className="text-sm text-muted-foreground">Transfer ownership before leaving this club.</p>
                ) : club.status === "active" ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="leave-club" />
                    <input type="hidden" name="clubId" value={club.id} />
                    <Button variant="outline" type="submit">Leave club</Button>
                  </Form>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </GlobalPageShell>
  );
}
