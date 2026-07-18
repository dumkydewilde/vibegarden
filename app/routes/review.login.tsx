import { Form, redirect } from "react-router";
import type { Route } from "./+types/review.login";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { createSessionCookie } from "~/lib/auth.server";
import { cloudflareContext } from "~/lib/context";
import { normalizeEmail, upsertUser } from "~/lib/otp.server";

const encoder = new TextEncoder();

async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

function equalDigest(left: Uint8Array, right: Uint8Array) {
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

export async function loader({}: Route.LoaderArgs) {
  return {};
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const limited = await env.MCP_GENERAL_LIMITER?.limit({ key: "review-login" });
  if (limited && !limited.success) return { error: "Invalid reviewer credentials" };

  const form = await request.formData();
  const email = normalizeEmail(String(form.get("email") ?? ""));
  const password = String(form.get("password") ?? "");
  const configuredEmail = normalizeEmail(env.MCP_REVIEW_EMAIL ?? "");
  const configuredPassword = env.MCP_REVIEW_PASSWORD ?? "";
  const [emailDigest, configuredEmailDigest, passwordDigest, configuredPasswordDigest] = await Promise.all([
    sha256(email),
    sha256(configuredEmail),
    sha256(password),
    sha256(configuredPassword),
  ]);
  const configured = Boolean(env.MCP_REVIEW_EMAIL && env.MCP_REVIEW_PASSWORD);
  if (!configured
    || !equalDigest(emailDigest, configuredEmailDigest)
    || !equalDigest(passwordDigest, configuredPasswordDigest)) {
    return { error: "Invalid reviewer credentials" };
  }

  const user = await upsertUser(env, configuredEmail, "user");
  const cookie = await createSessionCookie(env, request, user.id);
  return redirect("/", { headers: { "Set-Cookie": cookie } });
}

export default function ReviewLogin({ actionData }: Route.ComponentProps) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-16">
      <h1 className="font-serif text-3xl font-normal">Reviewer sign in</h1>
      <Form method="post" className="mt-6 space-y-4 rounded-lg border p-6">
        <label className="block space-y-2 text-sm font-medium">
          Email
          <Input name="email" type="email" autoComplete="username" required />
        </label>
        <label className="block space-y-2 text-sm font-medium">
          Password
          <Input name="password" type="password" autoComplete="current-password" required />
        </label>
        {actionData?.error && <p className="text-sm text-destructive">{actionData.error}</p>}
        <Button type="submit" className="w-full">Sign in</Button>
      </Form>
    </main>
  );
}
