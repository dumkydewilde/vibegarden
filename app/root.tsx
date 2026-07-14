import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

export function loader({ request }: Route.LoaderArgs) {
  const cookie = request.headers.get("Cookie") ?? "";
  const theme = /vg-theme=dark/.test(cookie)
    ? "dark"
    : /vg-theme=light/.test(cookie)
      ? "light"
      : null;
  return { theme };
}

// Applies the stored or system theme before hydration so there is no flash
// of the wrong theme. Runs once, inline, in <head>.
const themeScript = `
(function () {
  var m = document.cookie.match(/vg-theme=(dark|light)/);
  var dark = m ? m[1] === "dark"
    : window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (dark) document.documentElement.classList.add("dark");
})();
`;

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
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
  return <Outlet />;
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
