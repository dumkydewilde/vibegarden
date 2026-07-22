export function meta() {
  return [{ title: "Connect Vibe Garden to MCP" }];
}

export default function Connect() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="font-serif text-4xl font-normal">Connect Vibe Garden</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Let Claude or ChatGPT use the Vibe Garden projects, learning material, and artifact tools you choose to approve.
      </p>
      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-medium">MCP server URL</h2>
        <code className="block rounded-md bg-muted p-3">https://vibegarden.club/mcp</code>
        <p>Supported surfaces: Claude and ChatGPT connectors that support remote MCP with OAuth.</p>
      </section>
      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-medium">What an app can do</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li><code>projects:read</code> — your projects and their linked conversations.</li>
          <li><code>content:read</code> — Vibe Garden learning material, modules, and curated reads.</li>
          <li><code>artifacts:write</code> — create private HTML artifacts and retained versions, up to 100 files and 2 MiB (2,097,152 bytes) per package.</li>
          <li><code>artifacts:publish</code> — share a selected artifact version to the gallery only after your explicit confirmation.</li>
        </ul>
        <p>MCP accepts text-only packages. Binary and file-picker import is deferred and unsupported.</p>
        <p>Write and publish are separate scopes. Existing connections must reauthorize to add either scope.</p>
      </section>
      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-medium">Connect in three steps</h2>
        <ol className="list-decimal space-y-2 pl-5">
          <li>Add the MCP server URL in Claude or ChatGPT.</li>
          <li>Sign in to Vibe Garden and approve only the scopes you want; reauthorize later to add a new scope.</li>
          <li>Ask the host assistant to use Vibe Garden when it would help.</li>
        </ol>
        <p>
          You can <a className="underline" href="/settings">choose a club and manage or revoke connected apps</a> at any time.
        </p>
      </section>
      <p className="mt-8 text-sm text-muted-foreground">
        Vibe Garden adds your selected garden context; it does not replace the host assistant. Need help? Contact <a className="underline" href="mailto:dumky@motherduck.com">dumky@motherduck.com</a>.
      </p>
    </main>
  );
}
