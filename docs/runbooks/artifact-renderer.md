# Artifact renderer runbook

The artifact feature has two Workers with exact, separate origins:

- Website: `https://vibegarden.club`
- Renderer: `https://usercontent.vibegarden.club`

Both bind the private `vibe-garden-artifacts` bucket. The website owns D1,
sessions, OAuth, email, artifact metadata, and capability issuance. The
renderer owns only R2 reads, static renderer assets, metrics, and
`RENDERER_SIGNING_SECRET`; it must never receive D1, session, OAuth, mail, or
website bindings. Cookies are host-only; never configure a shared `Domain`.

## Local checks

Run `npm run copy:renderer-runtime` after dependency changes. It copies the
pinned single-thread DuckDB-Wasm `1.33.1-dev57.0` runtime into
the gitignored `.renderer-runtime` staging directory; do not switch to a CDN
or an unpinned URL. `npm run deploy:renderer` uploads those two pinned files
to the existing private R2 bucket before deploying the renderer. The renderer
serves only those allowlisted R2 objects, so the bucket remains private and no
static Workers asset exceeds its size limit.

`npm run test:security` starts `wrangler.security.jsonc`. Chromium resolves
`vibegarden.test` and `usercontent.vibegarden.test` to `127.0.0.1`; the fixture
Worker dispatches by hostname and calls the real renderer handler against local
R2. It uses separate explicit local parent/renderer origins and a dedicated
test signing secret. Artifact MCP create/version/retry/share and
insufficient-scope coverage runs separately with:

```sh
npm run test:mcp
```

Before a CSP, CORS, sandbox, capability, cookie, or renderer-host change run:

```sh
npm test -- app/lib/artifacts app/routes/__tests__/artifact-origin.test.ts
npm run test:worker
npm run test:security
npm run typecheck
```

Update the mandatory negative fixture and assertion in
`test/security/fixtures/forbidden.html` for every such boundary change. Review
the static dependency host allowlists and CSP source directives explicitly;
never use wildcard origins or sources. Previews may use only
`<iframe sandbox="allow-scripts">`; do not add same-origin, forms, popups,
downloads, or top-navigation permissions without a reviewed feature.

## Content-author guidance

Use pinned dependency URLs and integrity metadata whenever the provider
supports it. Declare every remote data origin at upload time. If browser CORS
prevents a remote fetch, package bounded CSV, Parquet, JSON, images, and other
data with the artifact instead of broadening CSP or CORS.

Downloads are attachment-only. Do not make the bucket public, expose object
keys, or link directly to R2. Capabilities are short lived and may only be
refreshed by the authenticated website wrapper.

## Production order and gate

For the first deployment, create the private bucket, apply migrations, then
set the same new dedicated `RENDERER_SIGNING_SECRET` value in both Workers.
Confirm without printing secrets that it differs from `SESSION_SECRET`.

```sh
npx wrangler r2 bucket create vibe-garden-artifacts
npx wrangler d1 migrations apply DB --remote
npx wrangler secret put RENDERER_SIGNING_SECRET
npx wrangler secret put RENDERER_SIGNING_SECRET --config wrangler.renderer.jsonc
npm run deploy:renderer
npm run deploy
```

Then verify exact production origins, private bucket status, security headers,
OTP delivery, upload/share/refresh/download, cleanup telemetry, and cross-user
isolation. Keep the email-sender caveat: Resend's onboarding sender delivers
only to the account owner until a sending domain is verified.

MCP create/version/retry/share and insufficient-scope coverage is complete
locally only when `npm run test:mcp` passes. Remote provisioning and deployment
remain separate release gates. Connector consent requests only
`artifacts:write` for create/version and `artifacts:publish` for gallery
sharing; the token user identity remains authoritative.

## Rollback and incident response

If a renderer release weakens an origin, CSP, CORS, sandbox, capability, or
cookie boundary, stop new renderer deployment, roll back both Workers to their
last known-good versions, and rotate `RENDERER_SIGNING_SECRET` in both Workers.
Do not rotate or copy `SESSION_SECRET` as part of renderer rollback. Confirm
the bucket is still private, invalidate affected wrapper sessions by normal
session controls when required, and re-run the local security gate before a
new deploy. Preserve only redacted operation IDs and metrics in incident notes;
never paste capability URLs, object keys, source paths, or secrets.
