import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "react-router";
import { ThemeProvider } from "next-themes";

import type { Route } from "./+types/root";
import "./app.css";
import { cloudflareContext } from "~/lib/context";
import { getUser } from "~/lib/auth.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const user = await getUser(env, request);
  const theme = user?.themePref;
  return { theme: theme === "light" || theme === "dark" ? theme : "system" };
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const { theme } = useLoaderData<typeof loader>();
  return (
    <ThemeProvider attribute="class" defaultTheme={theme} enableSystem>
      <Outlet />
    </ThemeProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "This path leads nowhere in the garden."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="mx-auto max-w-xl px-4 pt-24 text-center">
      <h1 className="text-4xl">{message}</h1>
      <p className="mt-4 text-muted-foreground">{details}</p>
      <a href="/" className="mt-6 inline-block text-primary underline">
        Back to the garden
      </a>
      {stack && (
        <pre className="mt-8 w-full overflow-x-auto p-4 text-left text-xs">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
