import { issueCapability, type RendererCapability } from "../../app/lib/artifacts/capability";
import renderer, { type RendererEnv } from "../../workers/renderer";
import forbidden from "./fixtures/forbidden.html";
import forbiddenScript from "./fixtures/forbidden.js";
import positive from "./fixtures/positive.html";

type SecurityFixtureEnv = {
  ARTIFACTS: R2Bucket;
  PARENT_ORIGIN: string;
  RENDERER_ORIGIN: string;
  RENDERER_SIGNING_SECRET: string;
  SESSION_SECRET: string;
};

const prefix = "artifacts/security-artifact/versions/security-version";
const html = (body: string) => new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

function fixtureKind(url: URL): "forbidden" | "positive" | null {
  const value = url.searchParams.get("fixture");
  return value === "forbidden" || value === "positive" ? value : null;
}

function fixtureRendererEnv(env: SecurityFixtureEnv): RendererEnv {
  return {
    ARTIFACTS: env.ARTIFACTS,
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } as Fetcher,
    ARTIFACT_METRICS: {} as AnalyticsEngineDataset,
    RENDERER_SIGNING_SECRET: env.RENDERER_SIGNING_SECRET,
    PARENT_ORIGIN: env.PARENT_ORIGIN,
  };
}

async function putFixture(env: SecurityFixtureEnv, fixture: "forbidden" | "positive"): Promise<void> {
  const put = (path: string, body: BodyInit, contentType: string) => env.ARTIFACTS.put(`${prefix}/${path}`, body, { httpMetadata: { contentType } });
  await put("index.html", fixture === "forbidden" ? forbidden : positive, "text/html");
  if (fixture === "forbidden") await put("assets/security-probe.js", forbiddenScript, "text/javascript");
  if (fixture === "positive") {
    await Promise.all([
      put("assets/site.css", "@font-face{font-family:Fixture;src:url(test-font.woff2)} body{color:rgb(0, 128, 0);font-family:Fixture,sans-serif}", "text/css"),
      put("assets/test-font.woff2", new Uint8Array([0, 1, 0, 0]), "font/woff2"),
      put("assets/pixel.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="green"/></svg>', "image/svg+xml"),
      put("data/fixture.csv", "animal,count\nduck,1\n", "text/csv"),
      put("data/fixture.parquet", "PAR1fixturePAR1", "application/vnd.apache.parquet"),
      put("assets/app.js", positiveScript("https://data.example.test"), "text/javascript"),
    ]);
  }
}

function positiveScript(remoteOrigin: string): string {
  return `
    async function text(path) { const response = await fetch(path); if (!response.ok) throw new Error(path); return response.text(); }
    Promise.all([text('data/fixture.csv'), text('data/fixture.parquet'), text('${remoteOrigin}/data/remote.csv')])
      .then(([csv, parquet]) => {
        document.querySelector('#csv-result').textContent = csv.trim().split('\\n').slice(1).join('');
        document.querySelector('#parquet-result').textContent = parquet.slice(0, 4);
        document.querySelector('#remote-result').textContent = 'remote csv loaded';
        document.querySelector('#positive-result').textContent = 'relative assets and packaged data loaded';
      })
      .catch(() => { document.querySelector('#positive-result').textContent = 'failed'; });
    fetch('http://127.0.0.1:8788/data/undeclared.csv').then(() => {
      document.querySelector('#undeclared-result').textContent = 'unexpected';
    }).catch(() => { document.querySelector('#undeclared-result').textContent = 'undeclared blocked'; });
  `;
}

async function token(env: SecurityFixtureEnv, fixture: "forbidden" | "positive", expiresAt: number): Promise<string> {
  const claims: RendererCapability = {
    tokenVersion: 1,
    policyVersion: 1,
    mode: "preview",
    versionId: "security-version",
    prefix,
    entryPath: "index.html",
    allowedDataOrigins: fixture === "positive" ? ["https://data.example.test"] : [],
    exp: expiresAt,
  };
  return issueCapability(claims, { rendererSigningSecret: env.RENDERER_SIGNING_SECRET, sessionSecret: env.SESSION_SECRET }, { now: expiresAt - 300 });
}

async function seed(env: SecurityFixtureEnv, fixture: "forbidden" | "positive"): Promise<Response> {
  await putFixture(env, fixture);
  const now = Math.floor(Date.now() / 1000);
  const current = await token(env, fixture, now + 300);
  const expired = await token(env, fixture, now - 1);
  const tampered = `${current.slice(0, -1)}${current.endsWith("A") ? "B" : "A"}`;
  const path = (value: string) => `${env.RENDERER_ORIGIN}/v1/${value}/index.html`;
  return Response.json({ previewUrl: path(current), expiredUrl: path(expired), tamperedUrl: path(tampered) }, { headers: { "Cache-Control": "no-store" } });
}

function wrapper(url: URL, env: SecurityFixtureEnv): Response {
  const src = url.searchParams.get("src");
  if (!src || new URL(src).origin !== env.RENDERER_ORIGIN) return new Response("Not Found", { status: 404 });
  return html(`<!doctype html><html><body><p id="parent-marker">parent intact</p><iframe title="Artifact preview" sandbox="allow-scripts" src="${src.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"></iframe><script>window.artifactAttempts = null; addEventListener('message', (event) => { if (event.source === document.querySelector('iframe').contentWindow && event.data && event.data.type === 'artifact-security-attempts') window.artifactAttempts = event.data.attempts; });</script></body></html>`);
}

export default {
  async fetch(request: Request, env: SecurityFixtureEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/__fixture/health") return new Response("ok");
    if (url.hostname === "usercontent.vibegarden.test") return renderer.fetch(request, fixtureRendererEnv(env), ctx);
    if (url.hostname !== "vibegarden.test") return new Response("Not Found", { status: 404 });
    if (url.pathname === "/__fixture/seed" && request.method === "GET") {
      const fixture = fixtureKind(url);
      return fixture ? seed(env, fixture) : new Response("Bad Request", { status: 400 });
    }
    if (url.pathname === "/__fixture/wrapper" && request.method === "GET") return wrapper(url, env);
    if (url.pathname === "/__fixture/write") return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
    if (url.pathname === "/data/undeclared.csv") return new Response("animal,count\nblocked,0\n", { headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "text/csv" } });
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<SecurityFixtureEnv>;
