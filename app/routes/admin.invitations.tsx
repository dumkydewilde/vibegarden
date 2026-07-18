import { Form, Link, useNavigation, useParams } from "react-router";
import { Link2, Mail, X } from "lucide-react";
import { desc, eq } from "drizzle-orm";
import type { Route } from "./+types/admin.invitations";
import { cloudflareContext } from "~/lib/context";
import { PageHeader } from "~/components/shell/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { requireClubPermission } from "~/lib/club-permissions";
import { requireClubContext } from "~/lib/clubs.server";
import { clubPath } from "~/lib/club-path";
import { getDb } from "~/lib/db.server";
import { createEmailInvitation, createInviteLink, revokeEmailInvitation, revokeInviteLink, type InviteLinkExpiry } from "~/lib/invites.server";
import { clubInviteLinks, clubInvitations } from "~/db/schema";

const expiries: InviteLinkExpiry[] = ["1h", "24h", "7d", "30d"];

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const club = await requireClubContext(env, request, params.clubSlug ?? "");
  requireClubPermission(club, "manage_invites");
  const db = getDb(env);
  const [emailInvitations, links] = await Promise.all([
    db.select().from(clubInvitations).where(eq(clubInvitations.clubId, club.club.id)).orderBy(desc(clubInvitations.createdAt)),
    db.select().from(clubInviteLinks).where(eq(clubInviteLinks.clubId, club.club.id)).orderBy(desc(clubInviteLinks.createdAt)),
  ]);
  return { club: { name: club.club.name, slug: club.club.slug }, emailInvitations, links };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const club = await requireClubContext(env, request, params.clubSlug ?? "");
  requireClubPermission(club, "manage_invites");
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "email") {
    const invitation = await createEmailInvitation(env, club, String(form.get("email") ?? ""));
    return { ok: true, intent, email: invitation.email };
  }
  if (intent === "link") {
    const expiresIn = String(form.get("expiresIn") ?? "") || null;
    const rawMaxJoins = String(form.get("maxJoins") ?? "").trim();
    const maxJoins = rawMaxJoins ? Number(rawMaxJoins) : null;
    const created = await createInviteLink(env, club, {
      expiresIn: expiries.includes(expiresIn as InviteLinkExpiry) ? (expiresIn as InviteLinkExpiry) : null,
      maxJoins,
    });
    return { ok: true, intent, inviteUrl: new URL(`/join/${created.urlToken}`, request.url).toString() };
  }
  if (intent === "revoke-email") {
    await revokeEmailInvitation(env, club, String(form.get("id") ?? ""));
    return { ok: true, intent };
  }
  if (intent === "revoke-link") {
    await revokeInviteLink(env, club, String(form.get("id") ?? ""));
    return { ok: true, intent };
  }
  throw new Response("Invalid invitation action", { status: 400 });
}

export default function AdminInvitations({ loaderData, actionData }: Route.ComponentProps) {
  const { clubSlug } = useParams();
  const busy = useNavigation().state === "submitting";
  return <div className="mx-auto max-w-4xl">
    <Link to={clubPath(clubSlug ?? loaderData.club.slug, "admin")} className="text-sm text-muted-foreground hover:text-foreground">← Admin overview</Link>
    <PageHeader icon={Mail} title="Invitations" description="Invite people to this club by email or reusable link." />
    {actionData?.inviteUrl && <p role="status" className="mb-4 rounded border bg-muted p-3 text-sm break-all">Share this link now: <code>{actionData.inviteUrl}</code></p>}
    <div className="grid gap-6 lg:grid-cols-2"><Card><CardHeader><CardTitle className="font-serif text-lg font-normal">Email invitation</CardTitle><CardDescription>Existing accounts join immediately; new accounts join after email verification.</CardDescription></CardHeader><CardContent><Form method="post" className="flex flex-wrap gap-2"><input type="hidden" name="intent" value="email" /><Input name="email" type="email" required placeholder="friend@example.com" className="max-w-xs" /><Button type="submit" disabled={busy}>Invite</Button></Form></CardContent></Card><Card><CardHeader><CardTitle className="font-serif text-lg font-normal">Reusable link</CardTitle><CardDescription>The raw URL is only displayed immediately after creation.</CardDescription></CardHeader><CardContent><Form method="post" className="grid gap-3"><input type="hidden" name="intent" value="link" /><label className="grid gap-1 text-sm">Expires<select name="expiresIn" defaultValue="" className="h-9 rounded border bg-background px-2"><option value="">Never</option>{expiries.map((expiry) => <option value={expiry} key={expiry}>{expiry}</option>)}</select></label><label className="grid gap-1 text-sm">Maximum joins <Input name="maxJoins" type="number" min="1" inputMode="numeric" /></label><Button type="submit" disabled={busy} className="w-fit gap-1"><Link2 className="size-4" />Create link</Button></Form></CardContent></Card></div>
    <Card className="mt-6"><CardHeader><CardTitle className="font-serif text-lg font-normal">Email invitations</CardTitle></CardHeader><CardContent>{loaderData.emailInvitations.length === 0 ? <p className="text-sm text-muted-foreground">No email invitations yet.</p> : <ul className="divide-y">{loaderData.emailInvitations.map((invitation) => <li className="flex flex-wrap items-center justify-between gap-2 py-3" key={invitation.id}><span>{invitation.email}</span><div className="flex items-center gap-2"><Badge variant={invitation.status === "pending" ? "secondary" : "outline"}>{invitation.status}</Badge>{invitation.status === "pending" && <Form method="post"><input type="hidden" name="intent" value="revoke-email" /><input type="hidden" name="id" value={invitation.id} /><Button type="submit" variant="ghost" size="sm" disabled={busy} className="gap-1"><X className="size-3.5" />Revoke</Button></Form>}</div></li>)}</ul>}</CardContent></Card>
    <Card className="mt-6"><CardHeader><CardTitle className="font-serif text-lg font-normal">Reusable links</CardTitle></CardHeader><CardContent>{loaderData.links.length === 0 ? <p className="text-sm text-muted-foreground">No reusable links yet.</p> : <ul className="divide-y">{loaderData.links.map((link) => <li className="flex flex-wrap items-center justify-between gap-2 py-3" key={link.id}><div className="text-sm"><p>{link.maxJoins === null ? `${link.currentJoins} joins · unlimited` : `${link.currentJoins} of ${link.maxJoins} joins`}</p><p className="text-muted-foreground">{link.expiresAt ? `Expires ${new Date(link.expiresAt).toLocaleString()}` : "Never expires"}</p></div><div className="flex items-center gap-2"><Badge variant={link.revokedAt ? "outline" : "secondary"}>{link.revokedAt ? "revoked" : "active"}</Badge>{!link.revokedAt && <Form method="post"><input type="hidden" name="intent" value="revoke-link" /><input type="hidden" name="id" value={link.id} /><Button type="submit" variant="ghost" size="sm" disabled={busy} className="gap-1"><X className="size-3.5" />Revoke</Button></Form>}</div></li>)}</ul>}</CardContent></Card>
  </div>;
}
