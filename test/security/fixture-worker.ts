import { issueCapability, type RendererCapability } from "../../app/lib/artifacts/capability";
import renderer, { type RendererEnv } from "../../workers/renderer";
import { assertWebsiteWriteOrigin } from "../../app/lib/request-security.server";
import {
  createLinkArtifact,
  createUploadSession,
  deleteArtifact,
  finalizeUpload,
  getGalleryArtifact,
  getOwnedArtifact,
  getOwnedRecoverableArtifact,
  listOwnedArtifactVersions,
  putUploadFile,
  recoverArtifact,
  restoreArtifactVersion,
  shareArtifactVersion,
  unshareArtifact,
  updateArtifactMetadata,
} from "../../app/lib/artifacts/service.server";
import { issueRendererCapability, resolveVisibleArtifact } from "../../app/lib/artifacts/renderer.server";
import forbidden from "./fixtures/forbidden.html";
import forbiddenScript from "./fixtures/forbidden.js";
import positive from "./fixtures/positive.html";

type SecurityFixtureEnv = {
  ARTIFACTS: R2Bucket;
  DB: D1Database;
  PARENT_ORIGIN: string;
  RENDERER_ORIGIN: string;
  RENDERER_SIGNING_SECRET: string;
  SESSION_SECRET: string;
  WEB_ALLOWED_ORIGINS: string;
};

const prefix = "artifacts/security-artifact/versions/security-version";
const runtimePrefix = "/runtime/duckdb/1.33.1-dev57.0";
const runtimeObjectPrefix = "runtime/duckdb/1.33.1-dev57.0";
const runtimeFixtureOrigin = "http://127.0.0.1:8789";
const fontUrl = "https://cdn.jsdelivr.net/npm/@fontsource/roboto@5.2.10/files/roboto-greek-ext-100-normal.woff2";
const html = (body: string) => new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
let writeAttempts = { requests: 0, cookies: [] as string[], mutations: 0, rejectedByOriginGuard: 0, formRequests: 0 };

function fixtureKind(url: URL): "forbidden" | "positive" | null {
  const value = url.searchParams.get("fixture");
  return value === "forbidden" || value === "positive" ? value : null;
}

function fixtureRendererEnv(env: SecurityFixtureEnv): RendererEnv {
  return {
    ARTIFACTS: env.ARTIFACTS,
    ARTIFACT_METRICS: {} as AnalyticsEngineDataset,
    RENDERER_SIGNING_SECRET: env.RENDERER_SIGNING_SECRET,
    PARENT_ORIGIN: env.PARENT_ORIGIN,
  };
}

async function ensureRuntime(env: SecurityFixtureEnv): Promise<void> {
  const files = [
    ["duckdb-browser-eh.worker.js", "text/javascript"],
    ["duckdb-eh.wasm", "application/wasm"],
  ] as const;
  for (const [file, contentType] of files) {
    if (await env.ARTIFACTS.head(`${runtimeObjectPrefix}/${file}`)) continue;
    const response = await fetch(`${runtimeFixtureOrigin}/duckdb/1.33.1-dev57.0/${file}`);
    if (!response.ok || !response.body) throw new Error(`Could not load local renderer runtime ${file}.`);
    await env.ARTIFACTS.put(`${runtimeObjectPrefix}/${file}`, response.body, {
      httpMetadata: { contentType },
    });
  }
}

function bytesFromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

const parquetFixture = bytesFromBase64("UEFSMRUAFRwVICwVAhUAFQYVBgAADjQCAAAAAgEEAAAAZHVjaxUAFRQVGCwVAhUAFQYVBgAACiQCAAAAAgEBAAAAFQIZPDUAGA1kdWNrZGJfc2NoZW1hFQQAFQwlAhgGYW5pbWFsJQAAFQIlAhgFY291bnQlIgAWAhkcGSwmABwVDBkVABkYBmFuaW1hbBUCFgIWPhZCJgg8GARkdWNrGARkdWNrFgAoBGR1Y2sYBGR1Y2sREQAAACYAHBUCGRUAGRgFY291bnQVAhYCFjYWOiZKPBgEAQAAABgEAQAAABYAKAQBAAAAGAQBAAAAEREAAAAWdBYCJggWfAAoKER1Y2tEQiB2ZXJzaW9uIHYxLjUuMiAoYnVpbGQgOGE1ODUxOTcxZikZLBwAABwAAADsAAAAUEFSMQ==");

async function putFixture(env: SecurityFixtureEnv, fixture: "forbidden" | "positive"): Promise<void> {
  const put = (path: string, body: BodyInit, contentType: string) => env.ARTIFACTS.put(`${prefix}/${path}`, body, { httpMetadata: { contentType } });
  await put("index.html", fixture === "forbidden" ? forbidden : positive, "text/html");
  if (fixture === "forbidden") await put("assets/security-probe.js", forbiddenScript, "text/javascript");
  if (fixture === "positive") {
    const font = await fetch(fontUrl);
    if (!font.ok) throw new Error("Pinned font fixture could not be fetched.");
    await Promise.all([
      put("assets/site.css", "@font-face{font-family:Fixture;src:url(test-font.woff2) format('woff2')} body{color:rgb(0, 128, 0);font-family:Fixture,sans-serif}", "text/css"),
      put("assets/test-font.woff2", await font.arrayBuffer(), "font/woff2"),
      put("assets/pixel.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="green"/></svg>', "image/svg+xml"),
      put("data/fixture.csv", "animal,count\nduck,1\n", "text/csv"),
      put("data/fixture.parquet", parquetFixture, "application/vnd.apache.parquet"),
      put("assets/app.js", positiveScript("https://data.example.test"), "text/javascript"),
    ]);
  }
}

function positiveScript(remoteOrigin: string): string {
  return `
    async function bytes(path) { const response = await fetch(path); if (!response.ok) throw new Error(path); return new Uint8Array(await response.arrayBuffer()); }
    async function text(path) { return new TextDecoder().decode(await bytes(path)); }
    async function queryPackagedData(csv, parquet) {
      const duckdb = await import("https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.33.1-dev57.0/+esm");
      const runtime = new URL("${runtimePrefix}/", window.location.href);
      const bundle = {
        mainWorker: new URL("duckdb-browser-eh.worker.js", runtime).href,
        mainModule: new URL("duckdb-eh.wasm", runtime).href,
      };
      const worker = await duckdb.createWorker(bundle.mainWorker);
      const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      const connection = await db.connect();
      await db.registerFileBuffer("fixture.csv", csv);
      await db.registerFileBuffer("fixture.parquet", parquet);
      const csvRow = await connection.query("SELECT animal, 1 AS total FROM read_csv_auto('fixture.csv')");
      const parquetRow = await connection.query("SELECT animal, 1 AS total FROM read_parquet('fixture.parquet')");
      await connection.close(); await db.terminate();
      return { csv: csvRow.toArray()[0], parquet: parquetRow.toArray()[0], bundle };
    }
    text('${remoteOrigin}/data/remote.csv').then(() => { document.querySelector('#remote-result').textContent = 'remote csv loaded'; });
    Promise.all([bytes('data/fixture.csv'), bytes('data/fixture.parquet')])
      .then(async ([csv, parquet]) => {
        const rows = await queryPackagedData(csv, parquet);
        document.querySelector('#csv-result').textContent = rows.csv.animal + ',' + rows.csv.total;
        document.querySelector('#parquet-result').textContent = rows.parquet.animal + ',' + rows.parquet.total;
        document.querySelector('#duckdb-result').textContent = 'duckdb read csv and parquet';
        document.querySelector('#duckdb-result').dataset.workerUrl = rows.bundle.mainWorker;
        document.querySelector('#duckdb-result').dataset.wasmUrl = rows.bundle.mainModule;
        await document.fonts.load('16px Fixture', 'α');
        document.querySelector('#font-result').textContent = document.fonts.check('16px Fixture', 'α') ? 'font loaded' : 'font unavailable';
        document.querySelector('#font-result').dataset.loaded = String(document.fonts.check('16px Fixture', 'α'));
        document.querySelector('#positive-result').textContent = 'relative assets and packaged data loaded';
      })
      .catch((error) => { document.querySelector('#positive-result').textContent = 'failed: ' + error.message; });
    fetch('http://127.0.0.1:8788/data/undeclared.csv').then(() => {
      document.querySelector('#undeclared-result').textContent = 'unexpected';
    }).catch(() => { document.querySelector('#undeclared-result').textContent = 'undeclared blocked'; });
  `;
}

async function token(env: SecurityFixtureEnv, fixture: "forbidden" | "positive", expiresAt: number): Promise<string> {
  return issueCapability({ tokenVersion: 1, policyVersion: 1, mode: "preview", versionId: "security-version", prefix, entryPath: "index.html", allowedDataOrigins: fixture === "positive" ? ["https://cdn.jsdelivr.net", "https://data.example.test", "https://extensions.duckdb.org"] : [env.PARENT_ORIGIN], exp: expiresAt }, { rendererSigningSecret: env.RENDERER_SIGNING_SECRET, sessionSecret: env.SESSION_SECRET }, { now: expiresAt - 300 });
}

async function seed(env: SecurityFixtureEnv, fixture: "forbidden" | "positive"): Promise<Response> {
  writeAttempts = { requests: 0, cookies: [], mutations: 0, rejectedByOriginGuard: 0, formRequests: 0 };
  await ensureRuntime(env);
  await putFixture(env, fixture);
  const now = Math.floor(Date.now() / 1000);
  const current = await token(env, fixture, now + 300);
  const expired = await token(env, fixture, now - 1);
  const tampered = `${current.slice(0, -1)}${current.endsWith("A") ? "B" : "A"}`;
  const path = (value: string) => `${env.RENDERER_ORIGIN}/v1/${value}/index.html`;
  return Response.json({ previewUrl: path(current), expiredUrl: path(expired), tamperedUrl: path(tampered) }, { headers: { "Cache-Control": "no-store" } });
}

function wrapper(src: string, env: SecurityFixtureEnv, state = "") : Response {
  if (new URL(src).origin !== env.RENDERER_ORIGIN) return new Response("Not Found", { status: 404 });
  return html(`<!doctype html><html><body><p id="parent-marker">parent intact</p><p data-wrapper-state="${state}"></p><iframe title="Artifact preview" sandbox="allow-scripts" src="${src.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"></iframe><script>window.artifactAttempts=null;addEventListener('message',(event)=>{if(event.source===document.querySelector('iframe').contentWindow&&event.data&&event.data.type==='artifact-security-attempts')window.artifactAttempts=event.data.attempts;});</script></body></html>`);
}

type FlowRequest = { action?: string; artifactId?: string; actor?: string; source?: string; projectId?: string; title?: string; versionId?: string };

const fixtureUser = "user-a";

async function checksum(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function clearFixtureState(env: SecurityFixtureEnv): Promise<void> {
  const keys = (await env.ARTIFACTS.list({ prefix: "artifacts/" })).objects.map((object) => object.key);
  if (keys.length) await env.ARTIFACTS.delete(keys);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM artifact_idempotency"), env.DB.prepare("DELETE FROM artifact_object_leases"),
    env.DB.prepare("DELETE FROM artifact_upload_files"), env.DB.prepare("DELETE FROM artifact_uploads"),
    env.DB.prepare("DELETE FROM artifact_files"), env.DB.prepare("DELETE FROM artifact_versions"),
    env.DB.prepare("DELETE FROM artifacts"), env.DB.prepare("DELETE FROM projects"), env.DB.prepare("DELETE FROM users"),
    env.DB.prepare("INSERT INTO users (id, email, name, created_at) VALUES ('user-a', 'a@example.test', 'Fixture owner', ?)").bind(Date.now()),
    env.DB.prepare("INSERT INTO users (id, email, name, created_at) VALUES ('user-b', 'b@example.test', 'Fixture reader', ?)").bind(Date.now()),
    env.DB.prepare("INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES ('existing-project', 'user-a', 'Existing project', 'seed', ?, ?)").bind(Date.now(), Date.now()),
    env.DB.prepare("INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES ('seed-project', 'user-a', 'Seed project', 'seed', ?, ?)").bind(Date.now(), Date.now()),
  ]);
}

async function uploadTextVersion(env: Env, userId: string, input: { artifactId?: string; projectId: string; type: "html" | "file"; title: string; key: string; content: string }): Promise<{ artifactId: string; versionId: string }> {
  const path = input.type === "html" ? "index.html" : "download.txt";
  const mimeType = input.type === "html" ? "text/html" : "text/plain";
  const body = new TextEncoder().encode(input.content);
  const session = await createUploadSession(env, userId, {
    project: { projectId: input.projectId }, type: input.type, title: input.title, idempotencyKey: input.key,
    ...(input.artifactId ? { artifactId: input.artifactId } : {}),
  });
  await putUploadFile(env, userId, session.uploadId, { path, mimeType, byteSize: body.byteLength, sha256: await checksum(input.content) }, body.buffer);
  return finalizeUpload(env, userId, session.uploadId);
}

async function flow(request: Request, env: SecurityFixtureEnv): Promise<Response> {
  const body = await request.json<FlowRequest>();
  const actor = body.actor ?? fixtureUser;
  const appEnv = env as unknown as Env;
  if (body.action === "reset") { await clearFixtureState(env); return Response.json({ ok: true, backend: "artifact-service" }); }
  if (body.action === "create") {
    let mutation: { artifactId: string; versionId: string };
    if (body.source === "https_link") mutation = await createLinkArtifact(appEnv, actor, { project: { projectId: body.projectId ?? "seed-project" }, title: body.title ?? "HTTPS link", url: "https://example.test/reference", idempotencyKey: crypto.randomUUID() });
    else if (body.source === "inline_seed") {
      const content = "<!doctype html><title>inline seed</title><p>inline seed</p>";
      const bytes = new TextEncoder().encode(content);
      const session = await createUploadSession(appEnv, actor, { project: { projectDraft: { title: "Inline fixture project" } }, type: "html", title: "Inline seed", idempotencyKey: crypto.randomUUID() });
      await putUploadFile(appEnv, actor, session.uploadId, { path: "index.html", mimeType: "text/html", byteSize: bytes.byteLength, sha256: await checksum(content) }, bytes.buffer);
      mutation = await finalizeUpload(appEnv, actor, session.uploadId);
    } else mutation = await uploadTextVersion(appEnv, actor, { projectId: body.projectId ?? "seed-project", type: body.source === "safe_file" ? "file" : "html", title: body.title ?? body.source ?? "Artifact", key: crypto.randomUUID(), content: body.source === "safe_file" ? "safe attachment" : "<!doctype html><title>artifact</title><p>artifact</p>" });
    const artifact = await getOwnedArtifact(appEnv, actor, mutation.artifactId);
    return Response.json({ artifact });
  }
  if (!body.artifactId) return Response.json({ error: "not_found" }, { status: 404 });
  if (body.action === "get") {
    const artifact = await getOwnedArtifact(appEnv, actor, body.artifactId);
    return artifact ? Response.json({ artifact }) : Response.json({ error: "not_found" }, { status: 404 });
  }
  const owned = body.action === "recover"
    ? await getOwnedRecoverableArtifact(appEnv, actor, body.artifactId)
    : await getOwnedArtifact(appEnv, actor, body.artifactId);
  if (!owned) return Response.json({ error: "not_found" }, { status: 404 });
  if (body.action === "metadata") await updateArtifactMetadata(appEnv, actor, owned.id, { title: body.title ?? owned.title });
  if (body.action === "version") await uploadTextVersion(appEnv, actor, { artifactId: owned.id, projectId: owned.projectId, type: owned.type === "file" ? "file" : "html", title: owned.title, key: crypto.randomUUID(), content: owned.type === "file" ? "safe attachment version" : `<!doctype html><title>${body.source ?? "version"}</title>` });
  if (body.action === "restore" && body.versionId) await restoreArtifactVersion(appEnv, actor, owned.id, body.versionId);
  if (body.action === "gallery") await shareArtifactVersion(appEnv, actor, owned.id, owned.version.id);
  if (body.action === "unshare") await unshareArtifact(appEnv, actor, owned.id);
  if (body.action === "delete") await deleteArtifact(appEnv, actor, owned.id);
  if (body.action === "recover") await recoverArtifact(appEnv, actor, owned.id);
  if (body.action === "download") {
    const visible = await resolveVisibleArtifact(appEnv, actor, owned.id);
    if (!visible || visible.type !== "file") return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json(await issueRendererCapability(appEnv, visible, "download", visible.version.files[0]!.path));
  }
  if (body.action === "versions") return Response.json({ versions: await listOwnedArtifactVersions(appEnv, actor, owned.id) });
  if (body.action === "refresh-capability" || body.action === "wrappers") {
    const visible = await resolveVisibleArtifact(appEnv, actor, owned.id);
    if (!visible || visible.type !== "html" || !visible.version.entryPath) return Response.json({ error: "not_found" }, { status: 404 });
    const capability = await issueRendererCapability(appEnv, visible, "preview", visible.version.entryPath);
    if (body.action === "refresh-capability") return Response.json({ state: "preserved", url: capability.url });
    const query = encodeURIComponent(capability.url);
    return Response.json({ detailUrl: `/__fixture/flow/detail/${owned.id}?src=${query}`, fullscreenUrl: `/__fixture/flow/fullscreen/${owned.id}?src=${query}` });
  }
  const artifact = body.action === "recover" ? await getOwnedRecoverableArtifact(appEnv, actor, owned.id) : await getOwnedArtifact(appEnv, actor, owned.id);
  const gallery = body.action === "gallery" ? await getGalleryArtifact(appEnv, owned.id) : null;
  return Response.json({ artifact, gallery });
}

function protectedWrite(request: Request, env: SecurityFixtureEnv): Response {
  writeAttempts.requests++;
  const cookie = request.headers.get("Cookie");
  if (cookie) writeAttempts.cookies.push(cookie);
  try { assertWebsiteWriteOrigin(request, env as unknown as Env); } catch (error) {
    if (error instanceof Response) { writeAttempts.rejectedByOriginGuard++; return error; }
    throw error;
  }
  writeAttempts.mutations++;
  return Response.json({ ok: true });
}

export default {
  async fetch(request: Request, env: SecurityFixtureEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/__fixture/health") return new Response("ok");
    if (url.hostname === "usercontent.vibegarden.test") return renderer.fetch(request, fixtureRendererEnv(env), ctx);
    if (url.hostname !== "vibegarden.test") return new Response("Not Found", { status: 404 });
    if (url.pathname === "/__fixture/seed" && request.method === "GET") { const fixture = fixtureKind(url); return fixture ? seed(env, fixture) : new Response("Bad Request", { status: 400 }); }
    if (url.pathname === "/__fixture/wrapper" && request.method === "GET") { const src = url.searchParams.get("src"); return src ? wrapper(src, env) : new Response("Not Found", { status: 404 }); }
    if (url.pathname === "/__fixture/write" && request.method === "POST") return protectedWrite(request, env);
    if (url.pathname === "/__fixture/write-attempts" && request.method === "GET") return Response.json(writeAttempts);
    if (url.pathname === "/__fixture/flow" && request.method === "POST") return flow(request, env).catch((error) => Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }));
    if (url.pathname === "/__fixture/flow-page" && request.method === "GET") return html("<!doctype html><title>fixture flow page</title><main>fixture flow page</main>");
    if (url.pathname.startsWith("/__fixture/flow/") && request.method === "GET") { const src = url.searchParams.get("src"); return src ? wrapper(src, env, "preserved") : new Response("Not Found", { status: 404 }); }
    if (url.pathname === "/__fixture/form") { writeAttempts.formRequests++; return new Response("unexpected form submission"); }
    if (url.pathname === "/data/undeclared.csv") return new Response("animal,count\nblocked,0\n", { headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "text/csv" } });
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<SecurityFixtureEnv>;
