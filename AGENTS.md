# Artifact security boundaries

- Keep the application origin at `https://vibegarden.club` and the renderer origin at `https://usercontent.vibegarden.club`. Local origins must be explicit, never wildcard origins.
- Session and OAuth cookies are host-only. Do not set a `Domain` attribute that shares them with the renderer host.
- The renderer is an isolated capability consumer. It receives no session, OAuth, mail, or D1 binding. `RENDERER_SIGNING_SECRET` is dedicated and must differ from `SESSION_SECRET`.
- Embed previews only from the renderer origin. Iframes must use the narrowest sandbox and permissions policy required for the preview, and must not grant same-origin access, top navigation, popups, forms, or downloads unless a reviewed feature requires them.
- Keep CSP, CORS, frame-ancestor, and fetch-metadata policies explicit for the application and renderer origins. Never use wildcard origins or source expressions for artifact routes.
- `vibe-garden-artifacts` is private R2 storage bound only to the website and renderer Workers. Never add a public R2 development URL, public bucket domain, or direct public object URL.
- Public sharing is capability-based and expires. Do not expose artifact IDs, object keys, source paths, tokens, or session credentials as a public-sharing substitute.

Before changing an artifact security boundary, run:

- `npm test -- app/lib/artifacts app/routes/__tests__/artifact-origin.test.ts`
- `npm run test:worker`
- `npm run test:security`
- `npm run typecheck`

The negative fixtures in `test/security/fixtures/forbidden.html` are mandatory. A CSP, sandbox, CORS, capability, cookie, or renderer-host change must add or update a negative assertion before it lands.
