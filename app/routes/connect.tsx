export function meta() {
  return [{ title: "Connect Vibe Garden to MCP" }];
}

export default function Connect() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="font-serif text-4xl font-normal">Connect Vibe Garden</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Let Claude or ChatGPT read the Vibe Garden projects and learning material you choose to share.
      </p>
      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-medium">MCP server URL</h2>
        <code className="block rounded-md bg-muted p-3">https://vibegarden.club/mcp</code>
        <p>Supported surfaces: Claude and ChatGPT connectors that support remote MCP with OAuth.</p>
      </section>
      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-medium">What an app can read</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li><code>projects:read</code> — your projects and their linked conversations.</li>
          <li><code>content:read</code> — Vibe Garden learning material, modules, and curated reads.</li>
        </ul>
      </section>
      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-medium">Connect in three steps</h2>
        <ol className="list-decimal space-y-2 pl-5">
          <li>Add the MCP server URL in Claude or ChatGPT.</li>
          <li>Sign in to Vibe Garden and approve only the scopes you want.</li>
          <li>Ask the host assistant to use Vibe Garden when it would help.</li>
        </ol>
        <p>
          You can <a className="underline" href="/settings/connections">manage or revoke connected apps</a> at any time.
        </p>
      </section>
      <p className="mt-8 text-sm text-muted-foreground">
        Vibe Garden adds your selected garden context; it does not replace the host assistant. Need help? Contact <a className="underline" href="mailto:dumky@motherduck.com">dumky@motherduck.com</a>.
      </p>
    </main>
  );
}
