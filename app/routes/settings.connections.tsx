import { Form, redirect } from "react-router";
import type { Route } from "./+types/settings.connections";
import { Button } from "~/components/ui/button";
import { cloudflareContext } from "~/lib/context";
import { requireUser } from "~/lib/auth.server";
import { clubPath } from "~/lib/club-path";
import { requireClubContext } from "~/lib/clubs.server";
import { hashMcpUser } from "~/lib/mcp/auth.server";

function requireSameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new Response("Invalid origin", { status: 403 });
  }
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const clubContext = await requireClubContext(env, request, params.clubSlug);
  const { items } = await env.OAUTH_PROVIDER.listUserGrants(user.id, { limit: 100 });
  return {
    club: clubContext.club,
    grants: items
      .filter((grant) => grant.metadata?.clubId === clubContext.club.id)
      .map((grant) => ({
      id: grant.id,
      clientLabel: typeof grant.metadata?.clientName === "string"
        ? grant.metadata.clientName
        : "MCP client",
      scopes: Array.isArray(grant.metadata?.grantedScopes)
        ? grant.metadata.grantedScopes.filter((scope: unknown): scope is string => typeof scope === "string")
        : grant.scope,
      createdAt: grant.createdAt,
      expiresAt: grant.expiresAt,
      clubName: typeof grant.metadata?.clubName === "string"
        ? grant.metadata.clubName
        : clubContext.club.name,
    })),
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    throw new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  }
  requireSameOrigin(request);
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const clubContext = await requireClubContext(env, request, params.clubSlug);
  const grantId = String((await request.formData()).get("grant_id") ?? "").trim();
  if (!grantId) throw new Response("Grant is required", { status: 400 });

  const { items } = await env.OAUTH_PROVIDER.listUserGrants(user.id, { limit: 100 });
  const grant = items.find(
    (candidate) => candidate.id === grantId
      && candidate.metadata?.clubId === clubContext.club.id,
  );
  if (!grant) throw new Response("Not found", { status: 404 });

  await env.OAUTH_PROVIDER.revokeGrant(grantId, user.id);
  console.info(JSON.stringify({
    event: "mcp_oauth_revocation",
    userHash: await hashMcpUser(env, user.id),
    grantIdHash: await hashMcpUser(env, grantId),
  }));
  return redirect(clubPath(clubContext.club.slug, "settings/connections"));
}

function formatTime(timestamp: number | undefined) {
  return timestamp ? new Date(timestamp).toLocaleString() : "No expiry";
}

export default function SettingsConnections({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-serif text-3xl font-normal">Connected apps</h1>
      <p className="mt-2 text-muted-foreground">
        Manage MCP apps that can read data in {loaderData.club.name}.
      </p>
      <div className="mt-8 space-y-4">
        {loaderData.grants.length === 0 ? (
          <p className="rounded-lg border p-4 text-sm text-muted-foreground">
            No apps are connected.
          </p>
        ) : loaderData.grants.map((grant) => (
          <section key={grant.id} className="rounded-lg border p-4">
            <h2 className="font-medium">{grant.clientLabel}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Club: {grant.clubName}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Access: {grant.scopes.join(", ") || "No scopes"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Connected {formatTime(grant.createdAt)} · {formatTime(grant.expiresAt)}
            </p>
            <Form method="post" className="mt-4">
              <input type="hidden" name="grant_id" value={grant.id} />
              <Button type="submit" variant="destructive">Revoke access</Button>
            </Form>
          </section>
        ))}
      </div>
    </main>
  );
}
