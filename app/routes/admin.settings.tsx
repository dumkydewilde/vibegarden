import { Form, Link, redirect, useNavigation, useParams } from "react-router";
import { Archive, Settings } from "lucide-react";
import type { Route } from "./+types/admin.settings";
import { cloudflareContext } from "~/lib/context";
import { PageHeader } from "~/components/shell/page-header";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { requireClubPermission } from "~/lib/club-permissions";
import { renameClub, renameClubDisplayName, requireClubContext } from "~/lib/clubs.server";
import { clubPath } from "~/lib/club-path";
import { archiveClub } from "~/lib/memberships.server";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const club = await requireClubContext(env, request, params.clubSlug ?? "");
  requireClubPermission(club, "manage_identity");
  return { club: { name: club.club.name, slug: club.club.slug } };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const club = await requireClubContext(env, request, params.clubSlug ?? "");
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "name") {
    requireClubPermission(club, "manage_identity");
    try {
      await renameClubDisplayName(env, club, String(form.get("name") ?? ""));
      return { ok: true, intent };
    } catch (error) {
      if (error instanceof Response && error.status === 400) {
        return { error: "Enter a club name.", intent };
      }
      throw error;
    }
  }
  if (intent === "slug") {
    requireClubPermission(club, "manage_identity");
    try {
      const slug = await renameClub(env, club, String(form.get("slug") ?? ""));
      return redirect(clubPath(slug, "admin/settings"));
    } catch (error) {
      if (error instanceof Response && error.status === 400) {
        return { error: "Choose a valid club URL.", intent };
      }
      if (error instanceof Response && error.status === 409) {
        return { error: "That club URL is already in use.", intent };
      }
      throw error;
    }
  }
  if (intent === "archive") {
    requireClubPermission(club, "archive");
    if (String(form.get("confirm") ?? "") !== club.club.name) {
      return { error: "Type the club name exactly to archive it.", intent };
    }
    await archiveClub(env, club);
    return redirect("/settings");
  }
  throw new Response("Invalid club settings action", { status: 400 });
}

export default function AdminSettings({ loaderData, actionData }: Route.ComponentProps) {
  const { clubSlug } = useParams();
  const busy = useNavigation().state === "submitting";
  return <div className="mx-auto max-w-3xl">
    <Link to={clubPath(clubSlug ?? loaderData.club.slug, "admin")} className="text-sm text-muted-foreground hover:text-foreground">← Admin overview</Link>
    <PageHeader icon={Settings} title="Club settings" description="Owner-only club identity and lifecycle controls." />
    {actionData?.error && <p role="alert" className="mb-4 text-sm text-destructive">{actionData.error}</p>}
    <Card><CardHeader><CardTitle className="font-serif text-lg font-normal">Club name</CardTitle></CardHeader><CardContent><Form method="post" className="flex flex-wrap gap-2"><input type="hidden" name="intent" value="name" /><Input name="name" required defaultValue={loaderData.club.name} className="max-w-sm" /><Button type="submit" disabled={busy}>Save name</Button></Form></CardContent></Card>
    <Card className="mt-6"><CardHeader><CardTitle className="font-serif text-lg font-normal">Club URL</CardTitle><CardDescription>Changing this keeps the old URL as a redirect alias.</CardDescription></CardHeader><CardContent><Form method="post" className="flex flex-wrap gap-2"><input type="hidden" name="intent" value="slug" /><Input name="slug" required defaultValue={loaderData.club.slug} className="max-w-sm" /><Button type="submit" disabled={busy}>Save URL</Button></Form></CardContent></Card>
    <Card className="mt-6 border-destructive/50"><CardHeader><CardTitle className="font-serif text-lg font-normal">Archive club</CardTitle><CardDescription>Archiving disables access. Type <strong>{loaderData.club.name}</strong> exactly to confirm.</CardDescription></CardHeader><CardContent><Form method="post" className="flex flex-wrap gap-2"><input type="hidden" name="intent" value="archive" /><Input name="confirm" aria-label="Confirm club name" required placeholder={loaderData.club.name} className="max-w-sm" /><Button type="submit" variant="destructive" disabled={busy} className="gap-1"><Archive className="size-4" />Archive club</Button></Form></CardContent></Card>
  </div>;
}
