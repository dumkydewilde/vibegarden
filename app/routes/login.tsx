import { Form, redirect, useNavigation, useSearchParams } from "react-router";
import { useState } from "react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { Sprout } from "lucide-react";
import type { Route } from "./+types/login";
import { GoogleIcon } from "~/components/icons/google-icon";
import { cloudflareContext } from "~/lib/context";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "~/components/ui/input-otp";
import { createSessionCookie, getUser } from "~/lib/auth.server";
import { googleEnabled } from "~/lib/google.server";
import { requestLoginCode, verifyLoginCode } from "~/lib/otp.server";
import { safeInternalPath } from "~/lib/return-path";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Sign in · Vibe Garden" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await getUser(env, request);
  if (user) throw redirect("/");
  return {
    google: googleEnabled(env),
    next: safeInternalPath(
      request,
      new URL(request.url).searchParams.get("next"),
    ),
  };
}

type ActionData =
  | { step: "code"; email: string; devCode?: string }
  | { step: "email"; error: string }
  | { step: "code"; email: string; error: string };

export async function action({
  request,
  context,
}: Route.ActionArgs): Promise<ActionData | Response> {
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const intent = form.get("intent");
  const email = String(form.get("email") ?? "");

  if (intent === "request") {
    const result = await requestLoginCode(env, email);
    if (!result.ok) {
      const error =
        result.error === "invalid-email"
          ? "That does not look like an email address."
          : "This email is not on the invite list. Ask your host for an invite.";
      return { step: "email", error };
    }
    return { step: "code", email, devCode: result.devCode };
  }

  if (intent === "verify") {
    const code = String(form.get("code") ?? "");
    const result = await verifyLoginCode(env, email, code);
    if (!result.ok) {
      const error =
        result.error === "expired"
          ? "That code has expired. Request a new one."
          : result.error === "too-many-attempts"
            ? "Too many tries. Request a new code."
            : "That code is not right. Check your email and try again.";
      return { step: "code", email, error };
    }
    const cookie = await createSessionCookie(env, request, result.user.id);
    const next = safeInternalPath(
      request,
      new URL(request.url).searchParams.get("next"),
    );
    return redirect(next, {
      headers: { "Set-Cookie": cookie },
    });
  }

  return { step: "email", error: "Something went wrong. Try again." };
}

const oauthErrors: Record<string, string> = {
  "not-invited":
    "That Google account is not on the invite list. Ask your host for an invite.",
};

export default function Login({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const [code, setCode] = useState("");
  const busy = navigation.state === "submitting";
  const oauthError = searchParams.get("error");

  const step = actionData?.step ?? "email";
  const error = actionData && "error" in actionData ? actionData.error : null;
  const devCode =
    actionData && "devCode" in actionData ? actionData.devCode : undefined;
  const email = actionData && "email" in actionData ? actionData.email : "";
  const formAction = searchParams.size ? `/login?${searchParams}` : "/login";

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-16">
      <div className="flex items-center gap-2 font-serif text-lg">
        <Sprout className="size-5 text-primary" />
        Vibe Garden
      </div>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="font-serif text-2xl font-normal">
            {step === "email" ? "Welcome back" : "Check your email"}
          </CardTitle>
          <CardDescription>
            {step === "email"
              ? "The garden is invite-only. Sign in with the email your invite was sent to."
              : `We sent a 6-digit code to ${email}. It works for 10 minutes.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === "email" ? (
            <Form method="post" action={formAction} className="space-y-3">
              <input type="hidden" name="intent" value="request" />
              <Input
                type="email"
                name="email"
                required
                autoFocus
                placeholder="you@example.com"
                autoComplete="email"
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              {oauthError && (
                <p className="text-sm text-destructive">
                  {oauthErrors[oauthError] ??
                    "Google sign-in did not work. Try the email code instead."}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Sending code..." : "Email me a code"}
              </Button>
            </Form>
          ) : (
            <Form method="post" action={formAction} className="space-y-3">
              <input type="hidden" name="email" value={email} />
              <div className="space-y-2">
                <label htmlFor="login-code" className="text-sm font-medium">
                  Verification code
                </label>
                <InputOTP
                  id="login-code"
                  name="code"
                  value={code}
                  onChange={setCode}
                  maxLength={6}
                  pattern={REGEXP_ONLY_DIGITS}
                  required
                  autoFocus
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  aria-invalid={error ? true : undefined}
                  aria-label="Verification code"
                  containerClassName="justify-center"
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                  </InputOTPGroup>
                  <InputOTPSeparator />
                  <InputOTPGroup>
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>
              {devCode && (
                <p className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
                  Email sending is not configured yet, so here is your code:{" "}
                  <strong className="font-mono">{devCode}</strong>
                </p>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                type="submit"
                name="intent"
                value="verify"
                className="w-full"
                disabled={busy}
              >
                {busy ? "Checking..." : "Sign in"}
              </Button>
              <Button
                type="submit"
                name="intent"
                value="request"
                variant="ghost"
                className="w-full text-muted-foreground"
                disabled={busy}
              >
                Send a new code
              </Button>
            </Form>
          )}

          {loaderData.google && step === "email" && (
            <>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                or
                <span className="h-px flex-1 bg-border" />
              </div>
              <Button asChild variant="outline" className="w-full">
                <a href={`/auth/google?next=${encodeURIComponent(loaderData.next)}`}>
                  <GoogleIcon className="size-4" />
                  Continue with Google
                </a>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
