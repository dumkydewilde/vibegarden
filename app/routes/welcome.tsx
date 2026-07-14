import { Form, redirect, useNavigation } from "react-router";
import { ArrowLeft, Sprout } from "lucide-react";
import { useState } from "react";
import type { Route } from "./+types/welcome";
import { cloudflareContext } from "~/lib/context";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { requireUser } from "~/lib/auth.server";
import { getDb } from "~/lib/db.server";
import { parseAnswers } from "~/lib/questionnaire";
import { questionnaireResponses, users } from "~/db/schema";
import { eq } from "drizzle-orm";
import { cn } from "~/lib/utils";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Welcome · Vibe Garden" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  if (user.stage !== "invited") throw redirect("/");
  return { name: user.name };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await requireUser(env, request);
  const form = await request.formData();

  const answers = parseAnswers({
    subscription: String(form.get("subscription") ?? ""),
    subscriptionOther: String(form.get("subscriptionOther") ?? ""),
    budget: String(form.get("budget") ?? ""),
    devices: form.getAll("devices").map(String),
    expectations: String(form.get("expectations") ?? ""),
  });
  if (!answers) {
    return { error: "A couple of answers are missing. Scroll back up?" };
  }

  const db = getDb(env);
  await db
    .insert(questionnaireResponses)
    .values({
      userId: user.id,
      answers: JSON.stringify(answers),
      createdAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: questionnaireResponses.userId,
      set: { answers: JSON.stringify(answers), createdAt: Date.now() },
    });
  await db
    .update(users)
    .set({ stage: "exploring" })
    .where(eq(users.id, user.id));
  return redirect("/");
}

type Subscription = "chatgpt" | "claude" | "other" | "none";
type Device = "laptop" | "phone" | "tablet";

function OptionCard({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "w-full rounded-lg border px-4 py-3 text-left text-sm transition-colors",
        selected
          ? "border-primary bg-accent text-accent-foreground"
          : "hover:border-primary/40",
      )}
    >
      {children}
    </button>
  );
}

export default function Welcome({ actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const [step, setStep] = useState(0);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [subscriptionOther, setSubscriptionOther] = useState("");
  const [budget, setBudget] = useState<0 | 5 | 20 | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [expectations, setExpectations] = useState("");

  // Budget only matters without a subscription; skip that step otherwise.
  const steps = subscription === "none" || subscription === null
    ? (["subscription", "budget", "devices", "expectations"] as const)
    : (["subscription", "devices", "expectations"] as const);
  const current = steps[Math.min(step, steps.length - 1)];
  const isLast = step >= steps.length - 1;

  const canContinue =
    current === "subscription"
      ? subscription !== null
      : current === "budget"
        ? budget !== null
        : current === "devices"
          ? devices.length > 0
          : true;

  const toggleDevice = (d: Device) =>
    setDevices((ds) =>
      ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d],
    );

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-16">
      <div className="flex items-center gap-2 font-serif text-lg">
        <Sprout className="size-5 text-primary" />
        Vibe Garden
      </div>

      <h1 className="mt-8 text-3xl leading-snug">
        Before you wander in, four quick questions
      </h1>
      <p className="mt-3 text-muted-foreground">
        They shape the workshop around what you actually want. No wrong
        answers, takes two minutes.
      </p>

      <div className="mt-6 flex gap-1.5" aria-hidden>
        {steps.map((s, i) => (
          <div
            key={s}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              i <= step ? "bg-primary" : "bg-border",
            )}
          />
        ))}
      </div>

      <Card className="mt-6">
        <CardContent className="pt-6">
          {current === "subscription" && (
            <fieldset className="space-y-2">
              <legend className="mb-3 font-serif text-lg">
                Do you already have an AI subscription you can use?
              </legend>
              {(
                [
                  ["chatgpt", "Yes, ChatGPT"],
                  ["claude", "Yes, Claude"],
                  ["other", "Yes, something else"],
                  ["none", "Not yet"],
                ] as const
              ).map(([value, label]) => (
                <OptionCard
                  key={value}
                  selected={subscription === value}
                  onClick={() => setSubscription(value)}
                >
                  {label}
                </OptionCard>
              ))}
              {subscription === "other" && (
                <Input
                  autoFocus
                  value={subscriptionOther}
                  onChange={(e) => setSubscriptionOther(e.target.value)}
                  placeholder="Which one? Gemini, Mistral, ..."
                  aria-label="Which AI subscription do you have?"
                  className="mt-1"
                />
              )}
            </fieldset>
          )}

          {current === "budget" && (
            <fieldset className="space-y-2">
              <legend className="mb-3 font-serif text-lg">
                What would you be comfortable spending on AI per month?
              </legend>
              <p className="mb-3 text-sm text-muted-foreground">
                There are good free options, this just helps me point you to
                the right ones.
              </p>
              {(
                [
                  [0, "Nothing for now"],
                  [5, "Around 5 euros"],
                  [20, "Around 20 euros"],
                ] as const
              ).map(([value, label]) => (
                <OptionCard
                  key={value}
                  selected={budget === value}
                  onClick={() => setBudget(value)}
                >
                  {label}
                </OptionCard>
              ))}
            </fieldset>
          )}

          {current === "devices" && (
            <fieldset className="space-y-2">
              <legend className="mb-3 font-serif text-lg">
                What will you mostly work on?
              </legend>
              <p className="mb-3 text-sm text-muted-foreground">
                Pick all that apply.
              </p>
              {(
                [
                  ["laptop", "A laptop or desktop"],
                  ["phone", "My phone"],
                  ["tablet", "A tablet"],
                ] as const
              ).map(([value, label]) => (
                <OptionCard
                  key={value}
                  selected={devices.includes(value)}
                  onClick={() => toggleDevice(value)}
                >
                  {label}
                </OptionCard>
              ))}
            </fieldset>
          )}

          {current === "expectations" && (
            <div>
              <label
                htmlFor="expectations"
                className="mb-3 block font-serif text-lg"
              >
                What are you hoping to build or figure out?
              </label>
              <p className="mb-3 text-sm text-muted-foreground">
                Anything goes: a vague itch, a concrete idea, or "no clue,
                surprise me".
              </p>
              <Textarea
                id="expectations"
                value={expectations}
                onChange={(e) => setExpectations(e.target.value)}
                rows={4}
                placeholder="I keep typing our club's scores into a spreadsheet by hand and..."
              />
            </div>
          )}

          {actionData?.error && (
            <p className="mt-3 text-sm text-destructive">{actionData.error}</p>
          )}

          <div className="mt-6 flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              className={cn("gap-1.5", step === 0 && "invisible")}
            >
              <ArrowLeft className="size-4" />
              Back
            </Button>

            {isLast ? (
              <Form method="post">
                <input type="hidden" name="subscription" value={subscription ?? ""} />
                <input
                  type="hidden"
                  name="subscriptionOther"
                  value={subscriptionOther}
                />
                <input type="hidden" name="budget" value={budget ?? ""} />
                {devices.map((d) => (
                  <input key={d} type="hidden" name="devices" value={d} />
                ))}
                <input type="hidden" name="expectations" value={expectations} />
                <Button
                  type="submit"
                  disabled={navigation.state === "submitting"}
                >
                  {navigation.state === "submitting"
                    ? "Opening the gate..."
                    : "Into the garden"}
                </Button>
              </Form>
            ) : (
              <Button
                type="button"
                disabled={!canContinue}
                onClick={() => setStep((s) => s + 1)}
              >
                Next
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
