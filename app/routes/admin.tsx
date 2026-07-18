import { Form, Link, useNavigation } from "react-router";
import { Check, Mail, Upload, UserCog, UserX } from "lucide-react";
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
import { Textarea } from "~/components/ui/textarea";
import { requireAdmin } from "~/lib/auth.server";
import { requireClubContext } from "~/lib/clubs.server";
import { getDb } from "~/lib/db.server";
import { isFeedbackStatus } from "~/lib/feedback";
import { listFeedback, setFeedbackStatus } from "~/lib/feedback.server";
import { importBulkInvites } from "~/lib/invites.server";
import { isValidEmail, normalizeEmail } from "~/lib/otp.server";
import { summarizeAnswers } from "~/lib/questionnaire";
import { listAdminThreads } from "~/lib/threads.server";
import { invites, questionnaireResponses, users } from "~/db/schema";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Admin · Vibe Garden" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  await requireAdmin(env, request);
  const club = await requireClubContext(env, request, "wotf");
  const db = getDb(env);
  const [allUsers, allInvites, responses, feedback, conversations] = await Promise.all([
    db.select().from(users).orderBy(desc(users.createdAt)),
    db.select().from(invites).orderBy(desc(invites.createdAt)),
    db
      .select()
      .from(questionnaireResponses)
      .where(eq(questionnaireResponses.clubId, club.club.id)),
    listFeedback(env, club.club.id),
    listAdminThreads(env, club.club.id),
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
    feedback,
    conversations,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const admin = await requireAdmin(env, request);
  const club = await requireClubContext(env, request, "wotf");
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
    return { ok: true, invitedEmail: email };
  }

  if (intent === "bulk-invite") {
    try {
      return { bulk: await importBulkInvites(env.DB, form, admin.email) };
    } catch (error) {
      console.error("Bulk invite import failed", error);
      return {
        bulkError:
          "No addresses were imported because the database write failed. Try again.",
      };
    }
  }

  if (intent === "revoke") {
    await db
      .update(invites)
      .set({ status: "revoked" })
      .where(eq(invites.email, email));
    return { ok: true };
  }

  if (intent === "feedback-status") {
    const id = String(form.get("id") ?? "");
    const status = form.get("status");
    if (id && isFeedbackStatus(status)) {
      await setFeedbackStatus(env, club.club.id, id, status);
    }
    return { ok: true };
  }

  return { error: "Unknown action." };
}

const feedbackStatusVariant: Record<
  string,
  "default" | "secondary" | "outline"
> = {
  new: "default",
  read: "secondary",
  resolved: "outline",
};

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
        icon={UserCog}
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
          {actionData &&
            "invitedEmail" in actionData &&
            actionData.invitedEmail && (
              <p
                className="mt-2 flex items-center gap-1.5 text-sm text-primary"
                role="status"
              >
                <Check className="size-4" aria-hidden="true" />
                Invite sent for {actionData.invitedEmail}
              </p>
            )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="font-serif text-lg font-normal">
            Bulk invite
          </CardTitle>
          <CardDescription>
            Paste one email per line, separate addresses with commas or
            semicolons, or upload a single-column CSV. This grants access but
            does not send an email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form
            method="post"
            encType="multipart/form-data"
            className="space-y-4"
          >
            <input type="hidden" name="intent" value="bulk-invite" />
            <div className="space-y-1.5">
              <label htmlFor="bulk-emails" className="text-sm font-medium">
                Email addresses
              </label>
              <Textarea
                id="bulk-emails"
                name="emails"
                rows={6}
                placeholder={"alice@example.com\nbob@example.com"}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="invite-file" className="text-sm font-medium">
                CSV file <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="invite-file"
                name="inviteFile"
                type="file"
                accept=".csv,text/csv,text/plain"
                className="max-w-md"
              />
            </div>
            <Button type="submit" disabled={busy} className="gap-1.5">
              <Upload className="size-4" />
              {busy ? "Importing..." : "Invite everyone"}
            </Button>
          </Form>

          {actionData && "bulkError" in actionData && actionData.bulkError && (
            <p className="mt-4 text-sm text-destructive" role="alert">
              {actionData.bulkError}
            </p>
          )}

          {actionData && "bulk" in actionData && actionData.bulk && (
            <div
              className="mt-4 rounded-md border bg-muted/40 p-3 text-sm"
              aria-live="polite"
            >
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span>
                  {actionData.bulk.imported}{" "}
                  {actionData.bulk.imported === 1
                    ? "address invited"
                    : "addresses invited"}
                </span>
                <span className="text-muted-foreground">
                  {actionData.bulk.duplicates.length}{" "}
                  {actionData.bulk.duplicates.length === 1
                    ? "duplicate skipped"
                    : "duplicates skipped"}
                </span>
                <span className="text-muted-foreground">
                  {actionData.bulk.rejected.length}{" "}
                  {actionData.bulk.rejected.length === 1
                    ? "address rejected"
                    : "addresses rejected"}
                </span>
              </div>
              {actionData.bulk.rejected.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-destructive">
                  {actionData.bulk.rejected.map((item) => (
                    <li key={`${item.value}-${item.reason}`}>
                      {item.value}: {item.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <h2 className="font-serif text-lg font-normal">
            Gardener conversations
          </h2>
          <CardDescription>
            Read-only transcripts to help you spot where workshop participants
            need more support.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loaderData.conversations.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No Gardener conversations to review yet.
            </p>
          ) : (
            <ul className="divide-y">
              {loaderData.conversations.map((conversation) => (
                <li key={conversation.id}>
                  <Link
                    to={`/admin/conversations/${conversation.id}`}
                    className="block py-3 transition-colors hover:text-primary"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="font-medium">
                        {conversation.title ?? "Untitled conversation"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(conversation.updatedAt).toLocaleDateString(
                          "en-US",
                          { month: "short", day: "numeric" },
                        )}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      <span>
                        {conversation.participant.name ??
                          conversation.participant.email}
                      </span>
                      {conversation.participant.name && (
                        <span> · {conversation.participant.email}</span>
                      )}
                      <span>
                        {` · ${conversation.messageCount} ${
                          conversation.messageCount === 1
                            ? "message"
                            : "messages"
                        }`}
                      </span>
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
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

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="font-serif text-lg font-normal">
            Feedback
          </CardTitle>
          <CardDescription>
            Private notes people sent from the "Feedback" button. Only you see
            these.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loaderData.feedback.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No feedback yet.
            </p>
          ) : (
            <ul className="divide-y">
              {loaderData.feedback.map((f) => (
                <li key={f.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={feedbackStatusVariant[f.status] ?? "default"}>
                      {f.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {f.authorName ?? f.authorEmail}
                    </span>
                    {f.page && (
                      <span className="text-xs text-muted-foreground">
                        · {f.page}
                      </span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {new Date(f.createdAt).toISOString().slice(0, 10)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm whitespace-pre-wrap">{f.body}</p>
                  <div className="mt-2 flex gap-1.5">
                    {f.status !== "read" && (
                      <Form method="post">
                        <input type="hidden" name="intent" value="feedback-status" />
                        <input type="hidden" name="id" value={f.id} />
                        <input type="hidden" name="status" value="read" />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="xs"
                          disabled={busy}
                          className="text-muted-foreground"
                        >
                          Mark read
                        </Button>
                      </Form>
                    )}
                    {f.status !== "resolved" && (
                      <Form method="post">
                        <input type="hidden" name="intent" value="feedback-status" />
                        <input type="hidden" name="id" value={f.id} />
                        <input type="hidden" name="status" value="resolved" />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="xs"
                          disabled={busy}
                          className="gap-1 text-muted-foreground"
                        >
                          <Check className="size-3.5" />
                          Resolve
                        </Button>
                      </Form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
