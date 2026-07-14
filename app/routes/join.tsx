import { Sprout } from "lucide-react";
import type { Route } from "./+types/join";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Join · Vibe Garden" }];
}

const questions = [
  "Do you already have an AI subscription you can use, like ChatGPT or Claude?",
  "If not, what would you be comfortable spending per month: 0, 5, or 20 euros?",
  "Will you mostly work on a laptop, a phone, or a tablet?",
  "What are you hoping to build or figure out? Anything goes.",
] as const;

export default function Join() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-16">
      <div className="flex items-center gap-2 font-serif text-lg">
        <Sprout className="size-5 text-primary" />
        Vibe Garden
      </div>

      <h1 className="mt-8 text-3xl leading-snug">
        Before the workshop, a few quick questions
      </h1>
      <p className="mt-3 text-muted-foreground">
        Your answers help shape the workshop around what you actually want to
        do. It takes about two minutes and there are no wrong answers.
      </p>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="font-serif text-base font-normal">
            What we will ask
          </CardTitle>
          <CardDescription>
            A preview. The interactive version opens with your invite.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            {questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Button className="mt-8" size="lg" disabled>
        Opens with your invite
      </Button>
    </main>
  );
}
