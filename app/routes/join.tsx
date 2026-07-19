import { Form, redirect } from "react-router";
import { Sprout } from "lucide-react";
import type { Route } from "./+types/join";
import { cloudflareContext } from "~/lib/context";
import { getUser } from "~/lib/auth.server";
import { getInvitePreview, joinWithInviteLink } from "~/lib/invites.server";
import { clubPath } from "~/lib/club-path";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Join · Vibe Garden" }];
}

const unavailableMessage =
  "This invitation is no longer available. Ask a club administrator for a new one.";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await getUser(env, request);
  const preview = await getInvitePreview(env, params.token ?? "", user);
  return preview.available && preview.memberClubSlug
    ? redirect(clubPath(preview.memberClubSlug))
    : preview;
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const token = params.token ?? "";
  const user = await getUser(env, request);
  if (!user) {
    throw redirect(`/login?next=${encodeURIComponent(`/join/${token}`)}`);
  }

  const result = await joinWithInviteLink(env, user, token);
  return result.ok
    ? redirect(clubPath(result.clubSlug))
    : { unavailable: true };
}

export default function Join({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const unavailable = !loaderData.available || actionData?.unavailable;

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-16">
      <div className="flex items-center gap-2 font-serif text-lg">
        <Sprout className="size-5 text-primary" />
        Vibe Garden
      </div>

      {unavailable ? (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="font-serif text-2xl font-normal">
              Invitation unavailable
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">{unavailableMessage}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <h1 className="mt-8 text-3xl leading-snug">
            Join {loaderData.clubName}
          </h1>
          <p className="mt-3 text-muted-foreground">
            This invitation will add you to the club. Please confirm to join.
          </p>
          <Form method="post" className="mt-8">
            <Button type="submit" size="lg">
              Join {loaderData.clubName}
            </Button>
          </Form>
        </>
      )}
    </main>
  );
}
