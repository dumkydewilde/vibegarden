import {
  OAuthProvider,
  type ClientRegistrationCallbackOptions,
  type OAuthProviderOptions,
} from "@cloudflare/workers-oauth-provider";
import { hashMcpUser } from "../app/lib/mcp/auth.server";
import { MCP_SCOPES } from "../app/lib/mcp/contracts";
import { mcpHandler } from "./mcp";

const redirectError = {
  code: "invalid_redirect_uri",
  description: "This MCP client redirect URI is not supported.",
};
const protectedResourceMetadataPath = "/.well-known/oauth-protected-resource";

export function isOAuthProviderPath(pathname: string, env: Env) {
  return pathname === new URL(env.MCP_RESOURCE_URL).pathname
    || pathname === "/authorize"
    || pathname === "/token"
    || pathname === "/register"
    || pathname === protectedResourceMetadataPath
    || pathname.startsWith(`${protectedResourceMetadataPath}/`)
    || pathname === "/.well-known/oauth-authorization-server";
}

function supportedRedirectUri(value: unknown): boolean {
  if (typeof value !== "string") return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.href === "https://claude.ai/api/mcp/auth_callback") return true;
  if (url.href.startsWith("https://chatgpt.com/connector/oauth/")) return true;
  return url.protocol === "http:"
    && (url.hostname === "127.0.0.1" || url.hostname === "localhost")
    && /^:\d+$/.test(`:${url.port}`);
}

export function validateMcpClientRegistration({ clientMetadata }: ClientRegistrationCallbackOptions) {
  const redirects = clientMetadata.redirect_uris;
  if (!Array.isArray(redirects) || redirects.length === 0 || !redirects.every(supportedRedirectUri)) {
    return redirectError;
  }
}

type TestOverrides = Partial<Pick<OAuthProviderOptions<Env>,
  "accessTokenTTL" | "refreshTokenTTL" | "clientRegistrationTTL" | "clientRegistrationCallback"
>>;

export function createOAuthProvider(
  env: Env,
  defaultHandler: ExportedHandler<Env>,
  testOverrides?: TestOverrides,
) {
  return new OAuthProvider<Env>({
    apiRoute: new URL(env.MCP_RESOURCE_URL).pathname,
    apiHandler: mcpHandler,
    defaultHandler,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    scopesSupported: MCP_SCOPES,
    allowImplicitFlow: false,
    allowPlainPKCE: false,
    disallowPublicClientRegistration: false,
    allowTokenExchangeGrant: false,
    accessTokenTTL: testOverrides?.accessTokenTTL ?? 3_600,
    refreshTokenTTL: testOverrides?.refreshTokenTTL ?? 2_592_000,
    clientRegistrationTTL: testOverrides?.clientRegistrationTTL ?? 7_776_000,
    resourceMetadata: {
      resource: env.MCP_RESOURCE_URL,
      authorization_servers: [new URL(env.MCP_RESOURCE_URL).origin],
      scopes_supported: MCP_SCOPES,
      bearer_methods_supported: ["header"],
      resource_name: "Vibe Garden",
    },
    clientRegistrationCallback: testOverrides?.clientRegistrationCallback ?? validateMcpClientRegistration,
    tokenExchangeCallback: async ({ grantType, userId }) => {
      console.info(JSON.stringify({
        event: "mcp_oauth_token",
        grantType,
        userHash: await hashMcpUser(env, userId),
      }));
    },
    onError({ status, code }) {
      console.info(JSON.stringify({ event: "mcp_oauth_error", status, code }));
    },
  });
}
