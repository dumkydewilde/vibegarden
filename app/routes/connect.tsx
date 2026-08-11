export function meta() {
  return [{ title: "Connect Vibe Garden to MCP" }];
}

export default function Connect() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="font-serif text-4xl font-normal">Connect Vibe Garden</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Let Claude, Gemini, or ChatGPT use the Vibe Garden projects, learning material, and artifact tools you choose to approve.
      </p>
      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-medium">MCP server URL</h2>
        <code className="block rounded-md bg-muted p-3">https://vibegarden.club/mcp</code>
        <p>
          This is a remote MCP server: your chat host discovers Vibe Garden&apos;s tools, then sends you to Vibe Garden
          to sign in and approve the access you choose. Vibe Garden supplies context and tools; your chosen host remains
          the assistant you are talking to.
        </p>
      </section>
      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-medium">What an app can do</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li><code>projects:read</code> — your projects and their linked conversations.</li>
          <li><code>projects:write</code> — plant a new project and update an existing one: name, one-liner, notes, building blocks, and stage. Never delete one.</li>
          <li><code>content:read</code> — Vibe Garden learning material, modules, and curated reads, including build guidance that answers a how-to question from the library and the library overview itself.</li>
          <li><code>artifacts:write</code> — create private HTML artifacts and retained versions, up to 100 files and 2 MiB (2,097,152 bytes) per package.</li>
          <li><code>artifacts:publish</code> — share a selected artifact version to the gallery only after your explicit confirmation.</li>
        </ul>
        <p>MCP accepts text-only packages. Binary and file-picker import is deferred and unsupported.</p>
        <p>Write and publish are separate scopes. Existing connections must reauthorize to add either scope.</p>
      </section>
      <section className="mt-8 space-y-5">
        <h2 className="text-xl font-medium">Connect your chat host</h2>
        <div className="space-y-2">
          <h3 className="font-medium">Claude</h3>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Open <strong>Settings → Connectors</strong>, then choose <strong>Add custom connector</strong>.</li>
            <li>Paste <code>https://vibegarden.club/mcp</code>, add it, and complete the Vibe Garden sign-in and consent screen.</li>
            <li>Enable Vibe Garden for a chat from the <strong>+</strong> menu&apos;s Connectors list when you want Claude to use it.</li>
          </ol>
        </div>
        <div className="space-y-2">
          <h3 className="font-medium">Gemini</h3>
          <p>
            Gemini custom MCP apps are currently available only in <strong>Gemini Spark</strong>, not ordinary Gemini chats.
            On <code>gemini.google.com</code>, open <strong>Settings &amp; help → Connected Apps</strong>, choose
            <strong> Add a custom app</strong>, paste the server URL, and complete Vibe Garden sign-in. In a Spark task,
            type <strong>@</strong> and select Vibe Garden to use it.
          </p>
          <p className="text-sm text-muted-foreground">
            Gemini Spark availability is limited: it currently requires an eligible personal account (US, age 18+, English,
            and Keep Activity on). It is not available for work or school accounts.
          </p>
        </div>
        <div className="space-y-2">
          <h3 className="font-medium">ChatGPT</h3>
          <ol className="list-decimal space-y-1 pl-5">
            <li>On ChatGPT web, open <strong>Settings → Apps → Advanced Settings</strong> and turn on <strong>Developer Mode</strong>.</li>
            <li>Go to <strong>Apps → Create</strong>, enter <code>https://vibegarden.club/mcp</code>, and let ChatGPT scan the tools.</li>
            <li>Complete Vibe Garden sign-in and select the app from the chat&apos;s tools menu.</li>
          </ol>
          <p className="text-sm text-muted-foreground">
            Developer Mode and full MCP access depend on your ChatGPT plan and workspace. If the option is missing, ask
            your workspace administrator.
          </p>
        </div>
        <p>Approve only the scopes you need. You can reauthorize later to add a new scope.</p>
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
