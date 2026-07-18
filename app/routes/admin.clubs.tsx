import { Form, Link, useNavigation } from "react-router";
import { ShieldCheck } from "lucide-react";
import type { Route } from "./+types/admin.clubs";
import { cloudflareContext } from "~/lib/context";
import { requireSuperAdmin } from "~/lib/auth.server";
import {
  listPlatformClubs,
  setClubModelPolicy,
  setClubSpendingLimit,
} from "~/lib/clubs.server";
import { recordAuditEvent, restoreClub } from "~/lib/memberships.server";
import {
  rotateClubCredential,
  setClubCredentialDisabled,
  syncClubPolicy,
} from "~/lib/club-ai.server";
import { PageHeader } from "~/components/shell/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";

function invalidAction() {
  return new Response("Invalid platform club action", { status: 400 });
}

function clubId(form: FormData) {
  const value = String(form.get("clubId") ?? "");
  if (!value) throw invalidAction();
  return value;
}

function audit(env: Env, actorUserId: string, id: string, action: string) {
  return env.DB.batch([
    recordAuditEvent(env, {
      actorUserId,
      clubId: id,
      action,
      targetType: "club",
      targetId: id,
      createdAt: Date.now(),
    }),
  ]);
}

async function markCredentialPending(env: Env, id: string) {
  const result = await env.DB
    .prepare(
      "UPDATE club_ai_credentials SET provisioning_state = 'pending', synced_policy = NULL, provisioning_lease_token = NULL, provisioning_lease_heartbeat_at = NULL WHERE club_id = ? AND provisioning_state != 'disabled'",
    )
    .bind(id)
    .run();
  if (result.meta.changes !== 1) throw new Response("Conflict", { status: 409 });
}

async function markCredentialDisabled(env: Env, id: string) {
  const result = await env.DB
    .prepare(
      "UPDATE club_ai_credentials SET provisioning_state = 'disabled', synced_policy = NULL, provisioning_lease_token = NULL, provisioning_lease_heartbeat_at = NULL WHERE club_id = ?",
    )
    .bind(id)
    .run();
  if (result.meta.changes !== 1) throw new Response("Not found", { status: 404 });
}

function inBackground(ctx: ExecutionContext, operation: Promise<unknown>, label: string) {
  ctx.waitUntil(operation.catch((error) => console.error(`platform club ${label} failed`, error)));
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  await requireSuperAdmin(env, request);
  return { clubs: await listPlatformClubs(env) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.get(cloudflareContext);
  const superAdmin = await requireSuperAdmin(env, request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = clubId(form);

  if (intent === "policy") {
    const policy = String(form.get("policy") ?? "");
    if (policy !== "free_only" && policy !== "all_models") throw invalidAction();
    await setClubModelPolicy(env, superAdmin, id, policy);
    inBackground(ctx, syncClubPolicy(env, id), "policy sync");
  } else if (intent === "spending") {
    const raw = String(form.get("spendingLimitUsd") ?? "").trim();
    const spendingLimitUsd = raw === "" ? null : Number(raw);
    if (spendingLimitUsd !== null && (!Number.isSafeInteger(spendingLimitUsd) || spendingLimitUsd < 0)) {
      throw invalidAction();
    }
    await setClubSpendingLimit(env, superAdmin, id, spendingLimitUsd);
    inBackground(ctx, syncClubPolicy(env, id), "spending sync");
  } else if (intent === "retry") {
    await markCredentialPending(env, id);
    await audit(env, superAdmin.id, id, "club.ai_retry_requested");
    inBackground(ctx, syncClubPolicy(env, id), "retry");
  } else if (intent === "rotate") {
    await markCredentialPending(env, id);
    await audit(env, superAdmin.id, id, "club.credential_rotation_requested");
    inBackground(ctx, rotateClubCredential(env, id), "rotation");
  } else if (intent === "disable") {
    // Persist this revocation before scheduling remote work so chat fails closed.
    await markCredentialDisabled(env, id);
    await audit(env, superAdmin.id, id, "club.ai_disabled");
    inBackground(ctx, setClubCredentialDisabled(env, id, true), "disable");
  } else if (intent === "restore") {
    await restoreClub(env, superAdmin, id);
    inBackground(ctx, syncClubPolicy(env, id), "restoration");
  } else {
    throw invalidAction();
  }
  return { ok: true, intent };
}

function policyLabel(policy: "free_only" | "all_models" | null) {
  return policy?.replace("_", " ") ?? "not configured";
}

export default function AdminClubs({ loaderData }: Route.ComponentProps) {
  const busy = useNavigation().state === "submitting";
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader icon={ShieldCheck} title="Platform clubs" description="Platform-funded model access and club AI lifecycle controls." />
      <div className="space-y-4">
        {loaderData.clubs.map((club) => (
          <Card key={club.id}>
            <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div><CardTitle className="font-serif text-lg font-normal">{club.name}</CardTitle><CardDescription>{club.slug} · {club.owner?.name ?? club.owner?.email ?? "No owner"} · {club.memberCount} {club.memberCount === 1 ? "member" : "members"}</CardDescription></div>
              <div className="flex flex-wrap items-center gap-2"><Badge variant={club.status === "active" ? "secondary" : "outline"}>{club.status}</Badge><Badge variant={club.credentialState === "ready" ? "secondary" : "outline"}>{club.credentialState ?? "not configured"}</Badge>{club.status === "active" && <Button asChild size="sm" variant="outline"><Link to={`/clubs/${club.slug}`}>Open club</Link></Button>}</div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">Policy: {policyLabel(club.modelPolicy)} · synced: {policyLabel(club.syncedPolicy)}{club.hasSyncDrift && <span> · drift: {policyLabel(club.syncedPolicy)}</span>} · {club.spendingLimitUsd === null ? "no spending cap" : `$${club.spendingLimitUsd} cap`}</p>
              {club.status === "active" ? <div className="flex flex-wrap gap-2">
                <Form method="post" className="flex gap-2"><input type="hidden" name="intent" value="policy" /><input type="hidden" name="clubId" value={club.id} /><select aria-label={`Model policy for ${club.name}`} name="policy" defaultValue={club.modelPolicy} className="h-9 rounded-md border bg-background px-2 text-sm"><option value="free_only">Free only</option><option value="all_models">All models</option></select><Button type="submit" size="sm" disabled={busy}>Save policy</Button></Form>
                <Form method="post" className="flex gap-2"><input type="hidden" name="intent" value="spending" /><input type="hidden" name="clubId" value={club.id} /><Input aria-label={`Spending cap for ${club.name}`} name="spendingLimitUsd" type="number" min="0" step="1" defaultValue={club.spendingLimitUsd ?? ""} placeholder="No cap" className="h-9 w-28" /><Button type="submit" size="sm" disabled={busy}>Save cap</Button></Form>
                <Form method="post"><input type="hidden" name="intent" value="retry" /><input type="hidden" name="clubId" value={club.id} /><Button type="submit" size="sm" variant="outline" disabled={busy || club.credentialState === "disabled"}>Retry sync</Button></Form>
                <Form method="post"><input type="hidden" name="intent" value="rotate" /><input type="hidden" name="clubId" value={club.id} /><Button type="submit" size="sm" variant="outline" disabled={busy || club.credentialState === "disabled"}>Rotate credential</Button></Form>
                <Form method="post"><input type="hidden" name="intent" value="disable" /><input type="hidden" name="clubId" value={club.id} /><Button type="submit" size="sm" variant="destructive" disabled={busy || club.credentialState === "disabled"}>Disable AI</Button></Form>
              </div> : <Form method="post"><input type="hidden" name="intent" value="restore" /><input type="hidden" name="clubId" value={club.id} /><Button type="submit" size="sm" disabled={busy}>Restore club</Button></Form>}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
