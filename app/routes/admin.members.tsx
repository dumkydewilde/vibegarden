import { Form, Link, useNavigation, useParams } from "react-router";
import { Shield, UserMinus, Users } from "lucide-react";
import { asc, eq } from "drizzle-orm";
import type { Route } from "./+types/admin.members";
import { cloudflareContext } from "~/lib/context";
import { PageHeader } from "~/components/shell/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { requireClubPermission } from "~/lib/club-permissions";
import { requireClubContext } from "~/lib/clubs.server";
import { clubPath } from "~/lib/club-path";
import { getDb } from "~/lib/db.server";
import { changeMemberRole, removeMember, transferOwnership } from "~/lib/memberships.server";
import { clubMemberships, users } from "~/db/schema";

const label: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const club = await requireClubContext(env, request, params.clubSlug ?? "");
  requireClubPermission(club, "manage_member");
  const members = await getDb(env).select({ membership: clubMemberships, user: users })
    .from(clubMemberships)
    .innerJoin(users, eq(clubMemberships.userId, users.id))
    .where(eq(clubMemberships.clubId, club.club.id))
    .orderBy(asc(clubMemberships.role), asc(users.email));
  return { club: { name: club.club.name, slug: club.club.slug }, members, isOwner: club.effectiveRole === "owner" };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const club = await requireClubContext(env, request, params.clubSlug ?? "");
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const userId = String(form.get("userId") ?? "");
  if (!userId) throw new Response("Missing member", { status: 400 });

  if (intent === "remove") {
    requireClubPermission(club, "manage_member");
    await removeMember(env, club, userId);
    return { ok: true, intent };
  }
  if (intent === "set-role") {
    requireClubPermission(club, "manage_admin");
    const role = String(form.get("role") ?? "");
    if (role !== "admin" && role !== "member") throw new Response("Invalid role", { status: 400 });
    await changeMemberRole(env, club, userId, role);
    return { ok: true, intent };
  }
  if (intent === "transfer") {
    requireClubPermission(club, "transfer_ownership");
    if (String(form.get("confirm") ?? "") !== "TRANSFER") {
      return { error: "Type TRANSFER to confirm ownership transfer.", intent };
    }
    await transferOwnership(env, club, userId);
    return { ok: true, intent };
  }
  throw new Response("Invalid member action", { status: 400 });
}

export default function AdminMembers({ loaderData, actionData }: Route.ComponentProps) {
  const { clubSlug } = useParams();
  const busy = useNavigation().state === "submitting";
  return <div className="mx-auto max-w-4xl">
    <Link to={clubPath(clubSlug ?? loaderData.club.slug, "admin")} className="text-sm text-muted-foreground hover:text-foreground">← Admin overview</Link>
    <PageHeader icon={Users} title="Members" description="Manage access and roles for this club." />
    {actionData?.error && <p role="alert" className="mb-4 text-sm text-destructive">{actionData.error}</p>}
    <Card><CardHeader><CardTitle className="font-serif text-lg font-normal">Club members</CardTitle><CardDescription>Admins can remove members. Only the owner can manage administrator roles or transfer ownership.</CardDescription></CardHeader><CardContent><ul className="divide-y">{loaderData.members.map(({ membership, user }) => <li key={membership.userId} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-medium">{user.name ?? user.email}</p>{user.name && <p className="text-sm text-muted-foreground">{user.email}</p>}</div><div className="flex flex-wrap items-center gap-2"><Badge variant={membership.role === "owner" ? "default" : "secondary"}>{label[membership.role]}</Badge>{membership.role === "member" && <Form method="post"><input type="hidden" name="intent" value="remove" /><input type="hidden" name="userId" value={membership.userId} /><Button variant="ghost" size="sm" disabled={busy} className="gap-1"><UserMinus className="size-3.5" />Remove</Button></Form>}{loaderData.isOwner && membership.role !== "owner" && <><Form method="post"><input type="hidden" name="intent" value="set-role" /><input type="hidden" name="userId" value={membership.userId} /><input type="hidden" name="role" value={membership.role === "admin" ? "member" : "admin"} /><Button variant="ghost" size="sm" disabled={busy}>{membership.role === "admin" ? "Make member" : "Make admin"}</Button></Form><Form method="post" className="flex items-center gap-1"><input type="hidden" name="intent" value="transfer" /><input type="hidden" name="userId" value={membership.userId} /><input name="confirm" aria-label={`Confirm transfer to ${user.email}`} placeholder="TRANSFER" className="h-8 w-24 rounded border px-2 text-xs" /><Button variant="ghost" size="sm" disabled={busy} className="gap-1"><Shield className="size-3.5" />Transfer ownership</Button></Form></>}</div></li>)}</ul></CardContent></Card>
  </div>;
}
