import { Form, Link, useNavigation, useParams } from "react-router";
import { Check, MessageCircle, Settings, UserCog, Users } from "lucide-react";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/admin";
import { cloudflareContext } from "~/lib/context";
import { PageHeader } from "~/components/shell/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { requireClubPermission } from "~/lib/club-permissions";
import { requireClubContext } from "~/lib/clubs.server";
import { clubPath } from "~/lib/club-path";
import { getDb } from "~/lib/db.server";
import { isFeedbackStatus } from "~/lib/feedback";
import { listFeedback, setFeedbackStatus } from "~/lib/feedback.server";
import { listAdminThreads } from "~/lib/threads.server";
import { clubAiCredentials } from "~/db/schema";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Admin · Vibe Garden" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const club = await requireClubContext(env, request, params.clubSlug ?? "");
  requireClubPermission(club, "moderate");
  const db = getDb(env);
  const [feedback, conversations, credential] = await Promise.all([
    listFeedback(env, club.club.id),
    listAdminThreads(env, club.club.id),
    db.select({ provisioningState: clubAiCredentials.provisioningState, syncedPolicy: clubAiCredentials.syncedPolicy })
      .from(clubAiCredentials)
      .where(eq(clubAiCredentials.clubId, club.club.id))
      .limit(1),
  ]);
  return {
    club: { name: club.club.name, slug: club.club.slug },
    feedback,
    conversations,
    ai: credential[0] ?? null,
    isOwner: club.effectiveRole === "owner",
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const club = await requireClubContext(env, request, params.clubSlug ?? "");
  requireClubPermission(club, "moderate");
  const form = await request.formData();
  if (form.get("intent") === "feedback-status") {
    const id = String(form.get("id") ?? "");
    const status = form.get("status");
    if (id && isFeedbackStatus(status)) {
      await setFeedbackStatus(env, club.club.id, id, status);
    }
    return { ok: true };
  }
  throw new Response("Invalid admin action", { status: 400 });
}

const feedbackStatusVariant: Record<string, "default" | "secondary" | "outline"> = {
  new: "default",
  read: "secondary",
  resolved: "outline",
};

export default function Admin({ loaderData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const { clubSlug } = useParams();
  const busy = navigation.state === "submitting";
  const path = (suffix: string) => clubPath(clubSlug ?? loaderData.club.slug, suffix);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader icon={UserCog} title="Admin" description={`Manage ${loaderData.club.name} and review club activity.`} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardHeader><CardTitle className="font-serif text-lg font-normal">Members</CardTitle><CardDescription>Roles and club access.</CardDescription></CardHeader><CardContent><Button asChild variant="outline"><Link to={path("admin/members")}>Members</Link></Button></CardContent></Card>
        <Card><CardHeader><CardTitle className="font-serif text-lg font-normal">Invitations</CardTitle><CardDescription>Email invites and reusable links.</CardDescription></CardHeader><CardContent><Button asChild variant="outline"><Link to={path("admin/invitations")}>Invitations</Link></Button></CardContent></Card>
        <Card><CardHeader><CardTitle className="font-serif text-lg font-normal">Settings</CardTitle><CardDescription>{loaderData.isOwner ? "Club identity and archive controls." : "Owner-only identity controls."}</CardDescription></CardHeader><CardContent>{loaderData.isOwner ? <Button asChild variant="outline"><Link to={path("admin/settings")}>Settings</Link></Button> : <p className="text-sm text-muted-foreground">Available to the club owner.</p>}</CardContent></Card>
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle className="font-serif text-lg font-normal">AI availability</CardTitle><CardDescription>Current club service status; secrets are never shown here.</CardDescription></CardHeader>
        <CardContent><Badge variant={loaderData.ai?.provisioningState === "ready" ? "secondary" : "outline"}>{loaderData.ai?.provisioningState ?? "not configured"}</Badge>{loaderData.ai?.syncedPolicy && <span className="ml-2 text-sm text-muted-foreground">{loaderData.ai.syncedPolicy.replace("_", " ")}</span>}</CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader><CardTitle className="font-serif text-lg font-normal">Gardener conversations</CardTitle><CardDescription>Read-only participant transcripts for this club.</CardDescription></CardHeader>
        <CardContent>{loaderData.conversations.length === 0 ? <p className="py-4 text-sm text-muted-foreground">No Gardener conversations to review yet.</p> : <ul className="divide-y">{loaderData.conversations.map((conversation) => <li key={conversation.id}><Link to={path(`admin/conversations/${conversation.id}`)} className="block py-3 transition-colors hover:text-primary"><div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"><span className="font-medium">{conversation.title ?? "Untitled conversation"}</span><span className="text-xs text-muted-foreground">{new Date(conversation.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></div><p className="mt-0.5 text-sm text-muted-foreground">{conversation.participant.name ?? conversation.participant.email} · {conversation.messageCount} {conversation.messageCount === 1 ? "message" : "messages"}</p></Link></li>)}</ul>}</CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader><CardTitle className="font-serif text-lg font-normal">Feedback</CardTitle><CardDescription>Private notes sent by members of this club.</CardDescription></CardHeader>
        <CardContent>{loaderData.feedback.length === 0 ? <p className="py-4 text-sm text-muted-foreground">No feedback yet.</p> : <ul className="divide-y">{loaderData.feedback.map((feedback) => <li key={feedback.id} className="py-3"><div className="flex flex-wrap items-center gap-2"><Badge variant={feedbackStatusVariant[feedback.status] ?? "default"}>{feedback.status}</Badge><span className="text-xs text-muted-foreground">{feedback.authorName ?? feedback.authorEmail}</span>{feedback.page && <span className="text-xs text-muted-foreground">· {feedback.page}</span>}</div><p className="mt-1.5 text-sm whitespace-pre-wrap">{feedback.body}</p><div className="mt-2 flex gap-1.5">{feedback.status !== "read" && <Form method="post"><input type="hidden" name="intent" value="feedback-status" /><input type="hidden" name="id" value={feedback.id} /><input type="hidden" name="status" value="read" /><Button type="submit" variant="ghost" size="xs" disabled={busy}>Mark read</Button></Form>}{feedback.status !== "resolved" && <Form method="post"><input type="hidden" name="intent" value="feedback-status" /><input type="hidden" name="id" value={feedback.id} /><input type="hidden" name="status" value="resolved" /><Button type="submit" variant="ghost" size="xs" disabled={busy} className="gap-1"><Check className="size-3.5" />Resolve</Button></Form>}</div></li>)}</ul>}</CardContent>
      </Card>
    </div>
  );
}
