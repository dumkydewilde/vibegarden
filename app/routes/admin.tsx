import type { Route } from "./+types/admin";
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

export function meta({}: Route.MetaArgs) {
  return [{ title: "Admin · Vibe Garden" }];
}

// Mock data until auth and D1 land in phase 2.
const mockInvites = [
  { email: "sam@example.com", stage: "exploring" },
  { email: "kim@example.com", stage: "questionnaire" },
  { email: "alex@example.com", stage: "invited" },
] as const;

const stageLabel: Record<string, string> = {
  invited: "Invited",
  questionnaire: "Filling questionnaire",
  exploring: "Exploring",
};

export default function Admin() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Admin"
        description="Invite people and follow how everyone is doing. Only you can see this."
      >
        <Button disabled>Invite someone (phase 2)</Button>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg font-normal">
            Participants
          </CardTitle>
          <CardDescription>
            Sample data. Real invites arrive with auth in phase 2.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {mockInvites.map((invite) => (
              <li
                key={invite.email}
                className="flex items-center justify-between py-3"
              >
                <span className="text-sm">{invite.email}</span>
                <Badge
                  variant={invite.stage === "exploring" ? "default" : "secondary"}
                >
                  {stageLabel[invite.stage]}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
