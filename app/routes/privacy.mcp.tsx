export function meta() {
  return [{ title: "MCP privacy · Vibe Garden" }];
}

export default function McpPrivacy() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="font-serif text-4xl font-normal">MCP privacy</h1>
      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-medium">Data returned to a connected app</h2>
        <p>
          With your approved scopes, Vibe Garden can return your projects and conversations, plus learning articles,
          modules, and curated reads. Returned project fields include titles, summaries, status, selected modules,
          and timestamps; conversation fields include titles, messages, and timestamps. Articles, modules, and
          curated reads include their titles, summaries, URLs or slugs, and published content.
        </p>
        <p>
          Tool arguments are explicit. Vibe Garden does not receive your surrounding Claude or ChatGPT conversation.
        </p>
      </section>
      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-medium">Operational logs and retention</h2>
        <p>
          We log only content-free operational fields: tool name, outcome, latency, request ID, and a short HMAC hash
          of your user ID. Cloudflare Workers Logs retains these logs for 3 days on the Free plan or 7 days on the Paid
          plan. Vibe Garden does not export them, and platform retention never exceeds 7 days in this design.
        </p>
      </section>
      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-medium">Storage and subprocessors</h2>
        <p>
          OAuth tokens and grants live in OAuth KV, app data remains in D1, and learning content ships with the Worker.
          Cloudflare processes the Worker, D1, KV, and operational logs. MotherDuck is used only by the optional
          <code> fresh_reads </code> feature.
        </p>
      </section>
      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-medium">Revoke access</h2>
        <p>
          Revoke access from <a className="underline" href="/settings/connections">Connected apps</a>; this revokes
          the grant and its tokens. For privacy questions, contact <a className="underline" href="mailto:dumky@motherduck.com">dumky@motherduck.com</a>.
        </p>
      </section>
    </main>
  );
}
