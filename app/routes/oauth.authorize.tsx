import { Form, redirect } from "react-router";
import type { Route } from "./+types/oauth.authorize";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { getUser } from "~/lib/auth.server";
import { cloudflareContext } from "~/lib/context";
import { hashMcpUser } from "~/lib/mcp/auth.server";
import { MCP_SCOPES, type McpScope } from "~/lib/mcp/contracts";

const scopeDescriptions: Record<McpScope, string> = {
  "projects:read": "View your garden projects",
  "content:read": "Read your learning content",
};

function isMcpScope(scope: string): scope is McpScope {
  return (MCP_SCOPES as readonly string[]).includes(scope);
}

function requireSameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new Response("Invalid origin", { status: 403 });
  }
}

/** OAuth grants are valid only for this Worker’s protected MCP resource. */
function requireMcpResource(env: Env, resource: string | string[] | undefined) {
  if (resource !== env.MCP_RESOURCE_URL) {
    throw new Response("Invalid OAuth resource", { status: 400 });
  }
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  requireMcpResource(env, oauthRequest.resource);
  const user = await getUser(env, request);
  if (!user) {
    const current = new URL(request.url);
    throw redirect(
      `/login?next=${encodeURIComponent(current.pathname + current.search)}`,
    );
  }
  const client = await env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId);
  if (!client) throw new Response("Invalid OAuth client", { status: 400 });
  const requestedScopes = oauthRequest.scope.filter(isMcpScope);
  if (requestedScopes.length === 0) {
    throw new Response("No supported scope requested", { status: 400 });
  }
  return {
    clientName: client.clientName ?? "An MCP client",
    redirectUri: oauthRequest.redirectUri,
    requestedScopes,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  requireSameOrigin(request);
  const { env } = context.get(cloudflareContext);
  const user = await getUser(env, request);
  if (!user) {
    const current = new URL(request.url);
    throw redirect(
      `/login?next=${encodeURIComponent(current.pathname + current.search)}`,
    );
  }

  const oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  requireMcpResource(env, oauthRequest.resource);
  const client = await env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId);
  if (!client) throw new Response("Invalid OAuth client", { status: 400 });

  const submittedScopes = new Set(
    (await request.formData()).getAll("scope").map(String),
  );
  const grantedScopes = oauthRequest.scope.filter(
    (scope): scope is McpScope =>
      isMcpScope(scope) && submittedScopes.has(scope),
  );
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthRequest,
    userId: user.id,
    metadata: {
      clientName: client.clientName ?? "MCP client",
      grantedScopes,
    },
    scope: grantedScopes,
    props: { userId: user.id, scopes: grantedScopes },
  });
  console.info(
    JSON.stringify({
      event: "mcp_oauth_consent",
      userHash: await hashMcpUser(env, user.id),
      scopes: grantedScopes,
    }),
  );
  return redirect(redirectTo);
}

export default function OAuthAuthorize({ loaderData }: Route.ComponentProps) {
  const redirectHost = new URL(loaderData.redirectUri).hostname;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-2xl font-normal">
            Connect {loaderData.clientName}
          </CardTitle>
          <CardDescription>
            This will let {loaderData.clientName} access Vibe Garden on your behalf.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            You will return to <span className="font-medium text-foreground">{redirectHost}</span>.
          </p>
          <Form method="post" className="space-y-3">
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Permissions</legend>
              {loaderData.requestedScopes.map((scope) => (
                <label key={scope} className="flex items-start gap-3 text-sm">
                  <input name="scope" type="checkbox" value={scope} defaultChecked />
                  <span>{scopeDescriptions[scope]}</span>
                </label>
              ))}
            </fieldset>
            <Button type="submit" className="w-full">Connect</Button>
            <Button asChild variant="ghost" className="w-full">
              <a href="/">Cancel</a>
            </Button>
          </Form>
        </CardContent>
      </Card>
    </main>
  );
}
