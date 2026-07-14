import { Form, useNavigation } from "react-router";
import { Mail, UserX } from "lucide-react";
import { desc, eq } from "drizzle-orm";
import type { Route } from "./+types/admin";
import { cloudflareContext } from "~/lib/context";
import { PageHeader } from "~/components/shell/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { requireAdmin } from "~/lib/auth.server";
import { getDb } from "~/lib/db.server";
import { isValidEmail, normalizeEmail } from "~/lib/otp.server";
import { summarizeAnswers } from "~/lib/questionnaire";
import { invites, questionnaireResponses, users } from "~/db/schema";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Admin · Vibe Garden" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  await requireAdmin(env, request);
  const db = getDb(env);
  const [allUsers, allInvites, responses] = await Promise.all([
    db.select().from(users).orderBy(desc(users.createdAt)),
    db.select().from(invites).orderBy(desc(invites.createdAt)),
    db.select().from(questionnaireResponses),
  ]);
  const summaries = new Map(
    responses.map((r) => {
      try {
        return [r.userId, summarizeAnswers(JSON.parse(r.answers))] as const;
      } catch {
        return [r.userId, undefined] as const;
      }
    }),
  );
  return {
    users: allUsers.map((u) => ({
      ...u,
      questionnaire: summaries.get(u.id),
    })),
    invites: allInvites,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const admin = await requireAdmin(env, request);
  const db = getDb(env);
  const form = await request.formData();
  const intent = form.get("intent");
  const email = normalizeEmail(String(form.get("email") ?? ""));

  if (intent === "invite") {
    if (!isValidEmail(email)) {
      return { error: "That does not look like an email address." };
    }
    await db
      .insert(invites)
      .values({
        email,
        invitedBy: admin.email,
        status: "pending",
        createdAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: invites.email,
        set: { status: "pending", invitedBy: admin.email },
      });
    return { ok: true };
  }

  if (intent === "revoke") {
    await db
      .update(invites)
      .set({ status: "revoked" })
      .where(eq(invites.email, email));
    return { ok: true };
  }

  return { error: "Unknown action." };
}

const stageLabel: Record<string, string> = {
  invited: "Just arrived",
  questionnaire: "Filling questionnaire",
  exploring: "Exploring",
};

export default function Admin({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  const pending = loaderData.invites.filter((i) => i.status === "pending");
  const revoked = loaderData.invites.filter((i) => i.status === "revoked");

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Admin"
        description="Invite people and follow how everyone is doing. Only you can see this."
      />

      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg font-normal">
            Invite someone
          </CardTitle>
          <CardDescription>
            They sign in at /login with this email. No password needed, they
            get a code by email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="flex flex-wrap items-start gap-2">
            <input type="hidden" name="intent" value="invite" />
            <Input
              type="email"
              name="email"
              required
              placeholder="friend@example.com"
              className="max-w-xs"
            />
            <Button type="submit" disabled={busy} className="gap-1.5">
              <Mail className="size-4" />
              Invite
            </Button>
          </Form>
          {actionData && "error" in actionData && actionData.error && (
            <p className="mt-2 text-sm text-destructive">{actionData.error}</p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="font-serif text-lg font-normal">
            Participants
          </CardTitle>
          <CardDescription>
            {loaderData.users.length} joined, {pending.length} invited and not
            yet here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loaderData.users.length + pending.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              Nobody here yet. Send the first invite above.
            </p>
          ) : (
            <ul className="divide-y">
              {loaderData.users.map((u) => (
                <li
                  key={u.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">{u.name ?? u.email}</p>
                    {u.name && (
                      <p className="truncate text-xs text-muted-foreground">
                        {u.email}
                      </p>
                    )}
                    {u.questionnaire && (
                      <p
                        className="mt-0.5 truncate text-xs text-muted-foreground"
                        title={u.questionnaire}
                      >
                        {u.questionnaire}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {u.role === "admin" && <Badge>admin</Badge>}
                    <Badge variant="secondary">
                      {stageLabel[u.stage] ?? u.stage}
                    </Badge>
                  </div>
                </li>
              ))}
              {pending.map((invite) => (
                <li
                  key={invite.email}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <p className="truncate text-sm text-muted-foreground">
                    {invite.email}
                  </p>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">invited</Badge>
                    <Form method="post">
                      <input type="hidden" name="intent" value="revoke" />
                      <input type="hidden" name="email" value={invite.email} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        className="gap-1 text-muted-foreground"
                      >
                        <UserX className="size-3.5" />
                        Revoke
                      </Button>
                    </Form>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {revoked.length > 0 && (
            <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
              Revoked: {revoked.map((r) => r.email).join(", ")}. Re-invite
              above to restore access.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
