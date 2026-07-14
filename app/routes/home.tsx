import { Link } from "react-router";
import { ArrowRight, BookOpen, Lightbulb, Sprout } from "lucide-react";
import type { Route } from "./+types/home";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Vibe Garden" },
    {
      name: "description",
      content: "A friendly place to learn and build with AI, together.",
    },
  ];
}

const starterPaths = [
  {
    to: "/learning",
    icon: BookOpen,
    title: "Start with the basics",
    description:
      "Short reads on LLMs, agents, and how digital products come together. Pick what sounds interesting, skip what does not.",
  },
  {
    to: "/garden",
    icon: Sprout,
    title: "Plant your first idea",
    description:
      "Brainstorm a project with The Gardener. It asks questions, suggests building blocks, and helps you find something worth making.",
  },
  {
    to: "/inspiration",
    icon: Lightbulb,
    title: "Browse inspiration",
    description:
      "Public datasets to play with, problems that could use a tool, and stories of what others have built with AI.",
  },
] as const;

export default function Home() {
  return (
    <div className="mx-auto max-w-3xl">
      <section className="pt-6 md:pt-16">
        <h1 className="text-4xl leading-tight md:text-5xl">
          Welcome to the Vibe Garden
        </h1>
        <p className="mt-5 max-w-xl text-lg text-muted-foreground">
          A friendly place to learn what AI can do and build something real
          with it. There is no fixed path here: read a little, try a little,
          and ask The Gardener whenever you get stuck.
        </p>
      </section>

      <section className="mt-12 grid gap-4 sm:grid-cols-1">
        {starterPaths.map((path) => (
          <Link key={path.to} to={path.to} className="group">
            <Card className="transition-colors group-hover:border-primary/40">
              <CardHeader>
                <div className="flex items-start gap-4">
                  <path.icon className="mt-1 size-5 shrink-0 text-primary" />
                  <div className="flex-1">
                    <CardTitle className="flex items-center gap-2 font-serif text-lg font-normal">
                      {path.title}
                      <ArrowRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" />
                    </CardTitle>
                    <CardDescription className="mt-1.5 leading-relaxed">
                      {path.description}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </section>

      <p className="mt-12 border-t pt-6 text-sm text-muted-foreground">
        The Gardener lives in the panel on the right and knows everything in
        the learning section. Whatever page you are on, you can bring what you
        are reading into the conversation.
      </p>
    </div>
  );
}
